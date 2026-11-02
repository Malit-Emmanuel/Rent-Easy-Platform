-- S4.5: record how each sign-in code was sent (which channel, whether the provider accepted it).
-- No phone number and no code are stored here; the challenge row already links to the phone.
CREATE TABLE identity.otp_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id        uuid NOT NULL REFERENCES identity.otp_challenges(id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'dev')),
  status              text NOT NULL CHECK (status IN ('accepted', 'failed')),
  provider_message_id text,
  error_code          text CHECK (error_code IS NULL OR char_length(error_code) <= 80),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_deliveries_challenge_idx ON identity.otp_deliveries (challenge_id);
CREATE INDEX otp_deliveries_created_idx   ON identity.otp_deliveries (created_at DESC);
ALTER TABLE identity.otp_deliveries ENABLE ROW LEVEL SECURITY;   -- API connects as owner; no policies, like the other tables
