-- Keep the audit hash chain in id order when events are written at the same time.
--
-- The id (bigserial) is taken from its sequence before the BEFORE INSERT trigger runs, but the
-- advisory lock that serialises the chain is taken inside the trigger. Two concurrent writers
-- could therefore take ids 10 and 11, with 11 winning the lock and linking first. Event 10 then
-- links to 11, and any check that walks the chain in id order reports a broken link.
--
-- Fix: once the lock is held, give the row a fresh id from the same sequence. Ids are now handed
-- out in lock order, so id order and chain order are the same. The ids drawn before the lock are
-- simply skipped (gaps in a bigserial are normal). Hashing is unchanged.
CREATE OR REPLACE FUNCTION governance.audit_chain() RETURNS trigger AS $$
DECLARE last bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(7001);
  NEW.id := nextval('governance.audit_events_id_seq'::regclass);
  SELECT hash INTO last FROM governance.audit_events ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := last;
  NEW.hash := extensions.digest(coalesce(last,'\x') || convert_to(
    NEW.occurred_at::text || coalesce(NEW.actor_id::text,'') || NEW.action ||
    NEW.subject_type || NEW.subject_id || NEW.metadata::text, 'UTF8'), 'sha256');
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
