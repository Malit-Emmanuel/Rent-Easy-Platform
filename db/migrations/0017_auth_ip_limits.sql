-- S7: per-address limits on sign-in. An address is stored only as a keyed hash (never the address itself), and rows are
-- deleted after one day by the existing purge-auth-data job. The table is only ever written and read by the API.
CREATE TABLE identity.auth_ip_events (
  id         bigserial PRIMARY KEY,
  ip_hash    bytea       NOT NULL,
  phone_hash bytea,
  kind       text        NOT NULL CHECK (kind IN ('otp_request', 'verify_fail')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_ip_events_lookup ON identity.auth_ip_events (ip_hash, kind, created_at DESC);
CREATE INDEX auth_ip_events_created ON identity.auth_ip_events (created_at);

ALTER TABLE identity.auth_ip_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON identity.auth_ip_events FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE identity.auth_ip_events_id_seq FROM anon, authenticated';
  END IF;
END $$;
