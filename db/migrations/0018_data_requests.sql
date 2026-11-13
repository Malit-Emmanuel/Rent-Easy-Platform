-- S8: people's requests about their own data (correction, deletion). A request is recorded and a human decides it.
-- Nothing in the system deletes or changes personal data because a request exists; deletion waits for counsel's advice.
CREATE TABLE governance.data_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES identity.users(id),
  kind            text        NOT NULL CHECK (kind IN ('correction', 'deletion')),
  details         text        NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
  status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'declined')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  handled_by      uuid REFERENCES identity.users(id),
  handled_at      timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  CONSTRAINT data_requests_correction_needs_details CHECK (kind <> 'correction' OR char_length(btrim(details)) >= 5),
  CONSTRAINT data_requests_state CHECK ((status = 'open') = (handled_at IS NULL)),
  CONSTRAINT data_requests_closed_needs_handler CHECK (status = 'open' OR (handled_by IS NOT NULL AND char_length(btrim(coalesce(resolution_note, ''))) >= 5))
);
-- One open request of each kind per person.
CREATE UNIQUE INDEX data_requests_one_open ON governance.data_requests (user_id, kind) WHERE status = 'open';
CREATE INDEX data_requests_status_idx ON governance.data_requests (status, created_at);

-- The database holds the line even if the API had a bug: only an open request can be closed, only by a super_admin who is not the requester,
-- and nothing else about the request can change. Requests cannot be deleted.
CREATE FUNCTION governance.data_requests_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status <> 'open' THEN RAISE EXCEPTION 'a closed request cannot change'; END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.kind <> OLD.kind OR NEW.details <> OLD.details OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'only the outcome of a request can be set';
  END IF;
  IF NEW.status = 'open' THEN RAISE EXCEPTION 'a request can only be closed'; END IF;
  IF NEW.handled_by = OLD.user_id THEN RAISE EXCEPTION 'a request about themselves cannot be handled by the same person'; END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.platform_roles WHERE user_id = NEW.handled_by AND role = 'super_admin') THEN
    RAISE EXCEPTION 'only an administrator can close a request';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_requests_guard BEFORE UPDATE ON governance.data_requests FOR EACH ROW EXECUTE FUNCTION governance.data_requests_guard();
CREATE TRIGGER data_requests_no_delete BEFORE DELETE ON governance.data_requests FOR EACH ROW EXECUTE FUNCTION governance.forbid_mutation();

ALTER TABLE governance.data_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON governance.data_requests FROM anon, authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION governance.data_requests_guard() FROM anon, authenticated, public';
  END IF;
END $$;
