-- S5b: link every recording to the challenge it was made for.
-- Without this link, any video uploaded after a challenge was issued could be submitted against it.
-- Applied migrations are never edited, so the evidence guard from 0013 is replaced here.

CREATE TABLE verification.t2_takes (
  file_id uuid PRIMARY KEY REFERENCES supply.files(id),
  challenge_id uuid NOT NULL REFERENCES verification.t2_challenges(id),
  take_no smallint NOT NULL CHECK (take_no BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, take_no)
);

CREATE OR REPLACE FUNCTION verification.t2_takes_guard() RETURNS trigger AS $$
DECLARE ch verification.t2_challenges%ROWTYPE; f supply.files%ROWTYPE;
BEGIN
  SELECT * INTO ch FROM verification.t2_challenges WHERE id = NEW.challenge_id;
  SELECT * INTO f FROM supply.files WHERE id = NEW.file_id;
  IF ch.used_at IS NOT NULL THEN RAISE EXCEPTION 'this challenge has already been used'; END IF;   -- window and expiry are enforced again when the evidence is submitted
  IF f.kind IS DISTINCT FROM 'video' OR f.property_id IS DISTINCT FROM ch.property_id OR f.uploaded_by IS DISTINCT FROM ch.requested_by THEN
    RAISE EXCEPTION 'a take must be a video of this property uploaded by the person who received the challenge';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER t2_takes_guard_trg BEFORE INSERT ON verification.t2_takes FOR EACH ROW EXECUTE FUNCTION verification.t2_takes_guard();
CREATE TRIGGER t2_takes_no_mutation BEFORE UPDATE OR DELETE ON verification.t2_takes FOR EACH ROW EXECUTE FUNCTION governance.forbid_mutation();

-- Evidence guard: as in 0013, plus "the video was recorded for this challenge".
CREATE OR REPLACE FUNCTION verification.t2_evidence_guard() RETURNS trigger AS $$
DECLARE c verification.cases%ROWTYPE; ch verification.t2_challenges%ROWTYPE; f supply.files%ROWTYPE; last_attempt int;
BEGIN
  SELECT * INTO c FROM verification.cases WHERE id = NEW.case_id;
  IF c.tier IS DISTINCT FROM 't2' OR c.appeal_of IS NOT NULL THEN RAISE EXCEPTION 'evidence belongs to an original T2 case'; END IF;
  IF c.status NOT IN ('submitted','needs_changes') THEN RAISE EXCEPTION 'evidence can only be added while the case awaits review or changes'; END IF;
  SELECT * INTO ch FROM verification.t2_challenges WHERE id = NEW.challenge_id FOR UPDATE;
  IF ch.property_id IS DISTINCT FROM c.property_id THEN RAISE EXCEPTION 'challenge is for a different property'; END IF;
  IF ch.used_at IS NOT NULL THEN RAISE EXCEPTION 'this challenge has already been used'; END IF;
  IF NEW.start_at < ch.issued_at OR NEW.start_at > ch.expires_at THEN RAISE EXCEPTION 'recording did not start inside the challenge window'; END IF;
  IF now() > ch.expires_at + interval '15 minutes' THEN RAISE EXCEPTION 'upload came too long after the challenge expired'; END IF;
  SELECT * INTO f FROM supply.files WHERE id = NEW.video_file_id;
  IF f.kind IS DISTINCT FROM 'video' OR f.status IS DISTINCT FROM 'ready' OR f.property_id IS DISTINCT FROM c.property_id THEN
    RAISE EXCEPTION 'evidence must be a ready video of this property';
  END IF;
  IF f.uploaded_by IS DISTINCT FROM ch.requested_by THEN RAISE EXCEPTION 'the video must be uploaded by the person who received the challenge'; END IF;
  IF f.created_at < ch.issued_at THEN RAISE EXCEPTION 'the video was uploaded before the challenge was issued'; END IF;
  IF NOT EXISTS (SELECT 1 FROM verification.t2_takes WHERE file_id = NEW.video_file_id AND challenge_id = NEW.challenge_id) THEN
    RAISE EXCEPTION 'the video was not recorded for this challenge';
  END IF;
  SELECT coalesce(max(attempt), 0) INTO last_attempt FROM verification.t2_evidence WHERE case_id = NEW.case_id;
  IF NEW.attempt <> last_attempt + 1 THEN RAISE EXCEPTION 'attempts must be numbered in order'; END IF;
  UPDATE verification.t2_challenges SET used_at = now() WHERE id = NEW.challenge_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

ALTER TABLE verification.t2_takes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON verification.t2_takes FROM anon, authenticated';
  END IF;
END $$;
