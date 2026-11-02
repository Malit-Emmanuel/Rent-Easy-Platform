-- S4 step 5: revoking a badge. A revoke needs a reason code (already enforced); "other" also needs a written note,
-- the note is kept, and a revoked badge can never be brought back or edited.
ALTER TABLE verification.badges ADD COLUMN revoke_note text CHECK (revoke_note IS NULL OR char_length(revoke_note) <= 500);
ALTER TABLE verification.badges ADD CONSTRAINT badges_revoke_other_needs_note
  CHECK (revoke_reason_code IS DISTINCT FROM 'other' OR char_length(btrim(coalesce(revoke_note, ''))) > 0);

CREATE OR REPLACE FUNCTION verification.badges_revoke_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoke_reason_code IS DISTINCT FROM OLD.revoke_reason_code
       OR NEW.revoke_note IS DISTINCT FROM OLD.revoke_note OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN
    RAISE EXCEPTION 'a revoked badge cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER badges_revoke_guard_trg BEFORE UPDATE ON verification.badges FOR EACH ROW EXECUTE FUNCTION verification.badges_revoke_guard();
