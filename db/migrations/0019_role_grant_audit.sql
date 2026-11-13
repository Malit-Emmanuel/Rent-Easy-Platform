-- S10: every grant or removal of a privileged platform role is written to the audit trail, by the database itself.
-- This catches grants made by hand in SQL as well as by any future screen. The plain "tenant" role is given automatically
-- at sign-up and is not logged (it carries no powers).
-- Who did it: a person making a grant by hand should first run   SET LOCAL zuri.actor_id = '<their user id>';
-- Without it the event is still recorded, with no actor, and the database login that made the change.
CREATE OR REPLACE FUNCTION identity.audit_platform_role() RETURNS trigger AS $$
DECLARE actor uuid;
BEGIN
  BEGIN actor := nullif(current_setting('zuri.actor_id', true), '')::uuid; EXCEPTION WHEN others THEN actor := NULL; END;
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.role <> 'tenant' THEN
    INSERT INTO governance.audit_events(actor_id, action, subject_type, subject_id, metadata)
    VALUES (actor, 'identity.platform_role_revoked', 'user', OLD.user_id::text, jsonb_build_object('role', OLD.role, 'db_login', session_user));
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.role <> 'tenant' THEN
    INSERT INTO governance.audit_events(actor_id, action, subject_type, subject_id, metadata)
    VALUES (actor, 'identity.platform_role_granted', 'user', NEW.user_id::text, jsonb_build_object('role', NEW.role, 'db_login', session_user));
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TRIGGER platform_roles_audit AFTER INSERT OR UPDATE OR DELETE ON identity.platform_roles
  FOR EACH ROW EXECUTE FUNCTION identity.audit_platform_role();
