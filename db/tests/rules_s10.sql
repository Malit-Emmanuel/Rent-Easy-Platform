-- S10 rule tests (role grants are audited). Everything rolls back.
-- Read the result in the final error message: "RULES S10: N passed, M failed [...]".
DO $$
DECLARE passed int := 0; failed text[] := '{}'; a uuid := 'e7a00000-0000-0000-0000-000000000001'; b uuid := 'e7a00000-0000-0000-0000-000000000002'; n int; ev record; bad int;
BEGIN
  INSERT INTO identity.users(id,phone) VALUES (a,'+254700000701'),(b,'+254700000702');

  -- 1. A grant without an actor is recorded, with no actor
  INSERT INTO identity.platform_roles(user_id,role) VALUES (a,'super_admin');
  SELECT * INTO ev FROM governance.audit_events WHERE action='identity.platform_role_granted' AND subject_id=a::text ORDER BY id DESC LIMIT 1;
  IF ev.id IS NOT NULL AND ev.metadata->>'role'='super_admin' AND ev.actor_id IS NULL THEN passed := passed+1; ELSE failed := failed || 'grant not recorded'; END IF;

  -- 2. With zuri.actor_id set, the actor is recorded
  PERFORM set_config('zuri.actor_id', b::text, true);
  INSERT INTO identity.platform_roles(user_id,role) VALUES (b,'reviewer');
  SELECT * INTO ev FROM governance.audit_events WHERE action='identity.platform_role_granted' AND subject_id=b::text ORDER BY id DESC LIMIT 1;
  IF ev.actor_id = b THEN passed := passed+1; ELSE failed := failed || 'actor not recorded'; END IF;

  -- 3. A removal is recorded
  DELETE FROM identity.platform_roles WHERE user_id=a AND role='super_admin';
  SELECT * INTO ev FROM governance.audit_events WHERE action='identity.platform_role_revoked' AND subject_id=a::text ORDER BY id DESC LIMIT 1;
  IF ev.id IS NOT NULL AND ev.metadata->>'role'='super_admin' AND ev.actor_id = b THEN passed := passed+1; ELSE failed := failed || 'revoke not recorded'; END IF;

  -- 4. The automatic tenant role is not logged
  SELECT count(*) INTO n FROM governance.audit_events;
  INSERT INTO identity.platform_roles(user_id,role) VALUES (a,'tenant');
  IF (SELECT count(*) FROM governance.audit_events) = n THEN passed := passed+1; ELSE failed := failed || 'tenant logged'; END IF;

  -- 5. A garbage actor setting does not block the grant
  PERFORM set_config('zuri.actor_id', 'not-a-uuid', true);
  INSERT INTO identity.platform_roles(user_id,role) VALUES (a,'support');
  SELECT * INTO ev FROM governance.audit_events WHERE action='identity.platform_role_granted' AND subject_id=a::text ORDER BY id DESC LIMIT 1;
  IF ev.metadata->>'role'='support' AND ev.actor_id IS NULL THEN passed := passed+1; ELSE failed := failed || 'bad actor setting broke grant'; END IF;

  -- 6. The audit chain still verifies
  SELECT count(*) INTO bad FROM (SELECT id, hash, extensions.digest(coalesce(lag(hash) OVER (ORDER BY id),'\x') || convert_to(occurred_at::text || coalesce(actor_id::text,'') || action || subject_type || subject_id || metadata::text,'UTF8'),'sha256') AS h FROM governance.audit_events) x WHERE x.hash IS DISTINCT FROM x.h;
  IF bad = 0 THEN passed := passed+1; ELSE failed := failed || ('chain broken ' || bad); END IF;

  RAISE EXCEPTION 'RULES S10: % passed, % failed %', passed, cardinality(failed), failed;
END $$;
