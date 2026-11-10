-- B3 slice S5e: the life of a T2 (video) badge.
--   1. T2 counts only while T1 is valid (a view the app and later search can share).
--   2. Moving the property pin after approval ends T2 (T1 stays). Each badge remembers the position it was approved at,
--      so a pin cannot be walked away in small steps.
--   3. Which videos are due for deletion: 90 days after the final decision (the retention setting from 0013), and recordings that were
--      never submitted. The API removes the stored bytes and then marks the file deleted; the evidence row and fingerprint stay.

INSERT INTO verification.reason_codes VALUES ('t2_position_moved','The property position was moved after the video check');

-- Distance in metres between two points (same formula and radius as the API).
CREATE OR REPLACE FUNCTION verification.distance_m(lat1 float8, lon1 float8, lat2 float8, lon2 float8) RETURNS float8 AS $$
  SELECT 2 * 6371000 * asin(sqrt(least(1, sin(radians(lat2 - lat1) / 2) ^ 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2)))
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog;

-- 1. The position a T2 badge was approved at. Filled in automatically; never changed afterwards.
ALTER TABLE verification.badges ADD COLUMN anchor_lat double precision, ADD COLUMN anchor_lon double precision;
ALTER TABLE verification.badges ADD CONSTRAINT badges_anchor_pair CHECK ((anchor_lat IS NULL) = (anchor_lon IS NULL));

CREATE OR REPLACE FUNCTION verification.badges_t2_anchor() RETURNS trigger AS $$
DECLARE p supply.properties%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.anchor_lat IS DISTINCT FROM OLD.anchor_lat OR NEW.anchor_lon IS DISTINCT FROM OLD.anchor_lon THEN RAISE EXCEPTION 'the approved position of a badge cannot change'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.level = 't2_video' AND NEW.subject_type = 'property' AND NEW.anchor_lat IS NULL THEN
    SELECT * INTO p FROM supply.properties WHERE id = NEW.subject_id;
    IF p.location IS NOT NULL THEN
      NEW.anchor_lat := extensions.st_y(p.location::extensions.geometry);
      NEW.anchor_lon := extensions.st_x(p.location::extensions.geometry);
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER badges_t2_anchor_trg BEFORE INSERT OR UPDATE ON verification.badges FOR EACH ROW EXECUTE FUNCTION verification.badges_t2_anchor();

-- 2. Moving the pin by more than 100 m (from where the badge was approved), or removing it, ends the T2 badge. T1 is untouched.
CREATE OR REPLACE FUNCTION supply.properties_position_moved() RETURNS trigger AS $$
DECLARE b record; moved float8; nlat float8; nlon float8; olat float8; olon float8;
BEGIN
  IF NEW.location IS NOT DISTINCT FROM OLD.location THEN RETURN NEW; END IF;
  IF NEW.location IS NOT NULL THEN nlat := extensions.st_y(NEW.location::extensions.geometry); nlon := extensions.st_x(NEW.location::extensions.geometry); END IF;
  IF OLD.location IS NOT NULL THEN olat := extensions.st_y(OLD.location::extensions.geometry); olon := extensions.st_x(OLD.location::extensions.geometry); END IF;
  FOR b IN SELECT id, anchor_lat, anchor_lon FROM verification.badges
            WHERE subject_type = 'property' AND subject_id = NEW.id AND level = 't2_video' AND revoked_at IS NULL AND expires_at > now() FOR UPDATE LOOP
    moved := CASE WHEN NEW.location IS NULL THEN NULL ELSE verification.distance_m(coalesce(b.anchor_lat, olat), coalesce(b.anchor_lon, olon), nlat, nlon) END;
    IF NEW.location IS NULL OR moved > 100 THEN
      UPDATE verification.badges SET revoked_at = now(), revoke_reason_code = 't2_position_moved' WHERE id = b.id;
      INSERT INTO governance.audit_events (action, subject_type, subject_id, metadata)
      VALUES ('verification.badge_revoked', 'badge', b.id::text,
              jsonb_build_object('propertyId', NEW.id, 'orgId', NEW.org_id, 'reasonCode', 't2_position_moved', 'movedM', round(moved), 'rule', 'position_moved'));
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER properties_position_moved_trg AFTER UPDATE OF location ON supply.properties FOR EACH ROW EXECUTE FUNCTION supply.properties_position_moved();

-- 3. What counts today. T2 is effective only while T1 is also valid, and only until the earlier of the two ends.
CREATE OR REPLACE VIEW verification.property_badge_status AS
SELECT p.id AS property_id, t.t1_valid_until, t.t2_valid_until,
       CASE WHEN t.t1_valid_until IS NOT NULL AND t.t2_valid_until IS NOT NULL THEN least(t.t1_valid_until, t.t2_valid_until) END AS t2_effective_until
  FROM supply.properties p
  CROSS JOIN LATERAL (
    SELECT (SELECT max(b.expires_at) FROM verification.badges b WHERE b.subject_type = 'property' AND b.subject_id = p.id AND b.level = 't1_documented' AND b.revoked_at IS NULL AND b.expires_at > now()) AS t1_valid_until,
           (SELECT max(b.expires_at) FROM verification.badges b WHERE b.subject_type = 'property' AND b.subject_id = p.id AND b.level = 't2_video' AND b.revoked_at IS NULL AND b.expires_at > now()) AS t2_valid_until
  ) t;

-- 4. Videos due for deletion. Two kinds:
--    retention:   the case was finally decided at least the retention period ago and no appeal of it is still open;
--    unsubmitted: a recording that was never sent for review, 24 hours after its challenge ended.
CREATE OR REPLACE FUNCTION verification.t2_purge_candidates(max_rows int DEFAULT 100) RETURNS TABLE (file_id uuid, storage_path text, why text) AS $$
  (SELECT f.id, f.storage_path, 'retention'::text
     FROM supply.files f
     JOIN verification.t2_evidence e ON e.video_file_id = f.id
     JOIN verification.cases c ON c.id = e.case_id
    WHERE f.status = 'ready' AND c.decided_at IS NOT NULL AND c.decided_at <= now() - verification.t2_video_retention()
      AND NOT EXISTS (SELECT 1 FROM verification.cases a WHERE a.appeal_of = c.id AND a.status IN ('submitted','in_review','needs_changes'))
    ORDER BY c.decided_at LIMIT max_rows)
  UNION ALL
  (SELECT f.id, f.storage_path, 'unsubmitted'::text
     FROM supply.files f
     JOIN verification.t2_takes t ON t.file_id = f.id
     JOIN verification.t2_challenges ch ON ch.id = t.challenge_id
    WHERE f.status IN ('ready','pending') AND ch.expires_at <= now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM verification.t2_evidence e WHERE e.video_file_id = f.id)
    ORDER BY ch.expires_at LIMIT max_rows)
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public;

-- Same lock-down as every other object: no access for Supabase's API roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON verification.property_badge_status FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION verification.t2_purge_candidates(int), verification.distance_m(float8,float8,float8,float8) FROM anon, authenticated, public';
  END IF;
END $$;
