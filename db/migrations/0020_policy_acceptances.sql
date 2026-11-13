-- S11: a record of which version of the privacy notice or terms a person accepted, and when.
-- Append-only: an acceptance is never edited or deleted. A new version needs a new acceptance.
-- Nothing is required of anyone until the operator sets a current version (POLICY_PRIVACY_VERSION / POLICY_TERMS_VERSION) after the lawyer approves the text.
CREATE TABLE governance.policy_acceptances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES identity.users(id),
  doc         text        NOT NULL CHECK (doc IN ('privacy', 'terms')),
  version     text        NOT NULL CHECK (version ~ '^[A-Za-z0-9._-]{1,40}$'),
  lang        text        NOT NULL CHECK (lang IN ('en', 'sw')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, doc, version)
);
CREATE INDEX policy_acceptances_user_idx ON governance.policy_acceptances (user_id, doc);
CREATE TRIGGER policy_acceptances_no_change BEFORE UPDATE OR DELETE ON governance.policy_acceptances FOR EACH ROW EXECUTE FUNCTION governance.forbid_mutation();

ALTER TABLE governance.policy_acceptances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON governance.policy_acceptances FROM anon, authenticated';
  END IF;
END $$;
