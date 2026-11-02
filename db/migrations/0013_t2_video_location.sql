-- B3 slice S5a: database rules for the T2 "video and location" badge.
-- People decide; these rules keep the process honest even if the API had a bug. See docs/S5_Design_Note.md.

-- 1. Cases can now be T2, and carry the reviewer's checklist.
ALTER TABLE verification.cases DROP CONSTRAINT cases_tier_check;
ALTER TABLE verification.cases ADD CONSTRAINT cases_tier_check CHECK (tier IN ('t1','t2'));
ALTER TABLE verification.cases ADD COLUMN t2_checklist jsonb;
ALTER TABLE verification.cases ADD CONSTRAINT cases_t2_checklist_shape CHECK (t2_checklist IS NULL OR (tier = 't2' AND jsonb_typeof(t2_checklist) = 'object'));

INSERT INTO verification.reason_codes VALUES
  ('t2_code_missing','The code or date is not spoken, or is wrong'),
  ('t2_location_mismatch','Location readings do not fit the property position'),
  ('t2_property_mismatch','The place shown is not the address or documents'),
  ('t2_unit_not_shown','The chosen unit(s) were not shown'),
  ('t2_video_unusable','Too dark, too short, no sound, or cannot be played'),
  ('t2_suspected_replay','Signs of reused, edited or screen-recorded footage');

-- A T2 badge never lives longer than about six months (the API sets exactly six).
ALTER TABLE verification.badges ADD CONSTRAINT badges_t2_lifetime CHECK (level <> 't2_video' OR expires_at <= issued_at + interval '186 days');

-- Raw videos may be deleted this long after the case is decided. One place to change it once counsel has advised.
CREATE OR REPLACE FUNCTION verification.t2_video_retention() RETURNS interval AS $$ SELECT interval '90 days' $$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog;

-- 2. One-time challenges: a spoken code, the units to show, and a 30-minute window.
CREATE TABLE verification.t2_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES identity.organizations(id),
  property_id uuid NOT NULL REFERENCES supply.properties(id),
  requested_by uuid NOT NULL REFERENCES identity.users(id),
  code text NOT NULL CHECK (code ~ '^[0-9]{4}$'),                    -- said aloud on the video; a freshness token, not a secret
  unit_ids uuid[] NOT NULL CHECK (cardinality(unit_ids) BETWEEN 1 AND 2),
  consent_at timestamptz NOT NULL,                                    -- the manager agreed to the video and location notice
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  takes smallint NOT NULL DEFAULT 0 CHECK (takes BETWEEN 0 AND 3),    -- at most three recordings per challenge
  used_at timestamptz,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '30 minutes'),
  CHECK (consent_at <= issued_at)
);
CREATE INDEX t2_challenges_property_idx ON verification.t2_challenges (property_id, issued_at DESC);

CREATE OR REPLACE FUNCTION verification.t2_has_valid_t1(p_property uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM verification.badges WHERE subject_type = 'property' AND subject_id = p_property
                   AND level = 't1_documented' AND revoked_at IS NULL AND expires_at > now())
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION verification.t2_challenges_guard() RETURNS trigger AS $$
DECLARE p supply.properties%ROWTYPE; active_units int; bad int; needed int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO p FROM supply.properties WHERE id = NEW.property_id;
    IF p.org_id IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'challenge organisation does not match the property organisation'; END IF;
    IF p.archived_at IS NOT NULL THEN RAISE EXCEPTION 'an archived property cannot be verified'; END IF;
    IF p.location IS NULL THEN RAISE EXCEPTION 'T2 needs a recorded property position'; END IF;
    IF NOT EXISTS (SELECT 1 FROM identity.memberships WHERE user_id = NEW.requested_by AND org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'only a member of the organisation can request a T2 challenge';
    END IF;
    IF NOT verification.t2_has_valid_t1(NEW.property_id) THEN RAISE EXCEPTION 'T2 needs a valid T1 badge'; END IF;
    IF EXISTS (SELECT 1 FROM verification.cases WHERE property_id = NEW.property_id
                AND (status IN ('submitted','in_review') OR (status = 'needs_changes' AND tier <> 't2'))) THEN
      RAISE EXCEPTION 'this property already has an open verification case';
    END IF;
    IF EXISTS (SELECT 1 FROM verification.t2_challenges WHERE property_id = NEW.property_id AND used_at IS NULL AND expires_at > now()) THEN
      RAISE EXCEPTION 'this property already has an active challenge';
    END IF;
    -- One unit to show up to 10 units, two above that; all must be active units of this property and listed once.
    SELECT count(*) INTO active_units FROM supply.units WHERE property_id = NEW.property_id AND archived_at IS NULL;
    needed := CASE WHEN active_units > 10 THEN 2 ELSE 1 END;
    IF cardinality(NEW.unit_ids) <> needed THEN RAISE EXCEPTION 'wrong number of units to show'; END IF;
    SELECT count(*) INTO bad FROM unnest(NEW.unit_ids) u(id)
      WHERE NOT EXISTS (SELECT 1 FROM supply.units s WHERE s.id = u.id AND s.property_id = NEW.property_id AND s.archived_at IS NULL);
    IF bad > 0 OR (SELECT count(DISTINCT x) FROM unnest(NEW.unit_ids) x) <> cardinality(NEW.unit_ids) THEN
      RAISE EXCEPTION 'units to show must be distinct, active units of this property';
    END IF;
  ELSE
    IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
       OR NEW.code IS DISTINCT FROM OLD.code OR NEW.unit_ids IS DISTINCT FROM OLD.unit_ids OR NEW.consent_at IS DISTINCT FROM OLD.consent_at
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN RAISE EXCEPTION 'a challenge cannot be edited'; END IF;
    IF NEW.expires_at > OLD.expires_at THEN RAISE EXCEPTION 'a challenge cannot be extended'; END IF;
    IF NEW.takes < OLD.takes THEN RAISE EXCEPTION 'recordings cannot be un-counted'; END IF;
    IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN RAISE EXCEPTION 'a used challenge cannot be changed'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER t2_challenges_guard_trg BEFORE INSERT OR UPDATE ON verification.t2_challenges FOR EACH ROW EXECUTE FUNCTION verification.t2_challenges_guard();

-- 3. Evidence: one row per submission (a first try, then one per "needs changes" round). Append-only.
CREATE TABLE verification.t2_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES verification.cases(id),
  attempt smallint NOT NULL CHECK (attempt >= 1),
  challenge_id uuid NOT NULL UNIQUE REFERENCES verification.t2_challenges(id),   -- a challenge can back one submission only
  video_file_id uuid NOT NULL UNIQUE REFERENCES supply.files(id),
  video_sha256 bytea NOT NULL CHECK (octet_length(video_sha256) = 32),            -- fingerprint to spot a video reused elsewhere
  submitted_at timestamptz NOT NULL DEFAULT now(),
  start_lat numeric(9,6) NOT NULL, start_lon numeric(9,6) NOT NULL, start_accuracy_m numeric(8,1) NOT NULL CHECK (start_accuracy_m BETWEEN 0 AND 100000), start_at timestamptz NOT NULL,
  end_lat   numeric(9,6) NOT NULL, end_lon   numeric(9,6) NOT NULL, end_accuracy_m   numeric(8,1) NOT NULL CHECK (end_accuracy_m   BETWEEN 0 AND 100000), end_at   timestamptz NOT NULL,
  hints jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(hints) = 'object'),        -- computed advice kept for the record; never a decision
  UNIQUE (case_id, attempt),
  CHECK (start_lat BETWEEN -5.1 AND 5.6 AND start_lon BETWEEN 33.5 AND 42.0),      -- same Kenya box as property positions
  CHECK (end_lat   BETWEEN -5.1 AND 5.6 AND end_lon   BETWEEN 33.5 AND 42.0),
  CHECK (end_at >= start_at AND end_at <= start_at + interval '3 minutes')
);
CREATE INDEX t2_evidence_sha_idx ON verification.t2_evidence (video_sha256);

CREATE OR REPLACE FUNCTION verification.t2_evidence_guard() RETURNS trigger AS $$
DECLARE c verification.cases%ROWTYPE; ch verification.t2_challenges%ROWTYPE; f supply.files%ROWTYPE; last_attempt int;
BEGIN
  SELECT * INTO c FROM verification.cases WHERE id = NEW.case_id;
  IF c.tier IS DISTINCT FROM 't2' OR c.appeal_of IS NOT NULL THEN RAISE EXCEPTION 'evidence belongs to an original T2 case'; END IF;   -- an appeal reads the original case''s evidence
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
  SELECT coalesce(max(attempt), 0) INTO last_attempt FROM verification.t2_evidence WHERE case_id = NEW.case_id;
  IF NEW.attempt <> last_attempt + 1 THEN RAISE EXCEPTION 'attempts must be numbered in order'; END IF;
  UPDATE verification.t2_challenges SET used_at = now() WHERE id = NEW.challenge_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER t2_evidence_guard_trg BEFORE INSERT ON verification.t2_evidence FOR EACH ROW EXECUTE FUNCTION verification.t2_evidence_guard();
CREATE TRIGGER t2_evidence_no_mutation BEFORE UPDATE OR DELETE ON verification.t2_evidence FOR EACH ROW EXECUTE FUNCTION governance.forbid_mutation();

-- 4. Tier rules on cases. These sit beside S4's cases_guard.
CREATE OR REPLACE FUNCTION verification.cases_t2_guard() RETURNS trigger AS $$
DECLARE orig verification.cases%ROWTYPE; b verification.badges%ROWTYPE; k text; want text;
BEGIN
  IF NEW.reason_code LIKE 't2\_%' AND NEW.tier <> 't2' THEN RAISE EXCEPTION 'T2 reason codes apply to T2 cases only'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.tier IS DISTINCT FROM OLD.tier THEN RAISE EXCEPTION 'the tier of a case cannot change'; END IF;
  IF NEW.appeal_of IS NOT NULL THEN
    SELECT * INTO orig FROM verification.cases WHERE id = NEW.appeal_of;
    IF orig.tier IS DISTINCT FROM NEW.tier THEN RAISE EXCEPTION 'an appeal must be at the same tier as the case it answers'; END IF;
  END IF;
  IF NEW.badge_id IS NOT NULL THEN
    SELECT * INTO b FROM verification.badges WHERE id = NEW.badge_id;
    want := CASE NEW.tier WHEN 't2' THEN 't2_video' ELSE 't1_documented' END;
    IF b.subject_type <> 'property' OR b.subject_id <> NEW.property_id OR b.level <> want THEN
      RAISE EXCEPTION 'the badge does not match the case tier and property';
    END IF;
  END IF;
  IF NEW.tier = 't2' THEN
    -- A new original T2 case needs a valid T1 right now; any T2 approval needs one at the moment of approval.
    IF (TG_OP = 'INSERT' AND NEW.appeal_of IS NULL) OR (NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')) THEN
      IF NOT verification.t2_has_valid_t1(NEW.property_id) THEN RAISE EXCEPTION 'T2 needs a valid T1 badge'; END IF;
    END IF;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
      -- Approval needs evidence (an appeal uses the original case's) and every checklist item answered yes.
      IF NOT EXISTS (SELECT 1 FROM verification.t2_evidence WHERE case_id = COALESCE(NEW.appeal_of, NEW.id)) THEN RAISE EXCEPTION 'a T2 approval needs submitted evidence'; END IF;
      FOREACH k IN ARRAY ARRAY['code_heard','place_matches_address','units_shown','footage_continuous','location_close','matches_documents'] LOOP
        IF coalesce(NEW.t2_checklist ->> k, '') <> 'true' THEN RAISE EXCEPTION 'every checklist item must be answered yes before a T2 approval'; END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER cases_t2_guard_trg BEFORE INSERT OR UPDATE ON verification.cases FOR EACH ROW EXECUTE FUNCTION verification.cases_t2_guard();

-- 5. Evidence is frozen. Documents as before; a T2 video also while its case is open and for the retention period after the decision.
CREATE OR REPLACE FUNCTION supply.files_frozen_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('deleted','rejected') AND OLD.status NOT IN ('deleted','rejected') THEN
    IF EXISTS (SELECT 1 FROM verification.case_files cf JOIN verification.cases c ON c.id = cf.case_id
                WHERE cf.file_id = OLD.id AND c.status IN ('submitted','in_review','needs_changes','approved')) THEN
      RAISE EXCEPTION 'this document is evidence in a verification case and cannot be removed';
    END IF;
    IF EXISTS (SELECT 1 FROM verification.t2_evidence e JOIN verification.cases c ON c.id = e.case_id
                WHERE e.video_file_id = OLD.id AND (c.decided_at IS NULL OR c.decided_at > now() - verification.t2_video_retention())) THEN
      RAISE EXCEPTION 'this video is evidence in a verification case and cannot be removed yet';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

-- 6. The property position is frozen while a T2 case is open, so the pin cannot be moved to match the readings.
CREATE OR REPLACE FUNCTION supply.properties_position_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.location IS DISTINCT FROM OLD.location AND EXISTS (
       SELECT 1 FROM verification.cases WHERE property_id = OLD.id AND tier = 't2' AND status IN ('submitted','in_review','needs_changes')) THEN
    RAISE EXCEPTION 'the property position cannot change while a T2 case is open';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER properties_position_guard_trg BEFORE UPDATE OF location ON supply.properties FOR EACH ROW EXECUTE FUNCTION supply.properties_position_guard();

-- Same lock-down as every other table: row security on, no policies, no access for Supabase's API roles.
ALTER TABLE verification.t2_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.t2_evidence ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON verification.t2_challenges, verification.t2_evidence FROM anon, authenticated';
  END IF;
END $$;
