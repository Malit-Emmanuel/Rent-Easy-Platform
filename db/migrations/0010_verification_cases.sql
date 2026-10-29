-- B3 slice S4: review cases for the T1 "documented" badge.
-- A case is one request to verify one property. People decide it; the rules below keep the process honest even if the API had a bug.

INSERT INTO verification.reason_codes VALUES
  ('doc_unreadable','Document cannot be read'),
  ('doc_owner_mismatch','Owner on the document does not match the claim'),
  ('doc_expired','Lease or authorisation has expired'),
  ('authorisation_missing','Manager has no letter of authority'),
  ('property_mismatch','Document is for a different property or address'),
  ('suspected_forgery','Signs of tampering; flagged for follow-up'),
  ('other','Other reason (a written note is required)');

CREATE TABLE verification.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES identity.organizations(id),
  property_id uuid NOT NULL REFERENCES supply.properties(id),
  tier text NOT NULL DEFAULT 't1' CHECK (tier = 't1'),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','in_review','needs_changes','approved','rejected')),
  submitted_by uuid NOT NULL REFERENCES identity.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paused_at timestamptz,                                  -- set while the manager is asked for changes
  claimed_by uuid REFERENCES identity.users(id),
  claimed_at timestamptz,
  decided_by uuid REFERENCES identity.users(id),
  decided_at timestamptz,
  reason_code text REFERENCES verification.reason_codes(code),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  appeal_of uuid REFERENCES verification.cases(id),
  badge_id uuid REFERENCES verification.badges(id),
  risk_flags text[] NOT NULL DEFAULT '{}',
  CHECK ((status IN ('approved','rejected')) = (decided_at IS NOT NULL)),
  CHECK (decided_at IS NULL OR decided_by IS NOT NULL),
  CHECK (status NOT IN ('rejected','needs_changes') OR reason_code IS NOT NULL),               -- reasons are mandatory
  CHECK (reason_code IS DISTINCT FROM 'other' OR char_length(btrim(coalesce(note,''))) > 0),   -- "other" needs a written note
  CHECK (status <> 'approved' OR badge_id IS NOT NULL),
  CHECK (status <> 'in_review' OR claimed_by IS NOT NULL),
  CHECK (due_at > submitted_at)
);
-- One open case per property, and one appeal per rejected case.
CREATE UNIQUE INDEX cases_one_open_per_property ON verification.cases (property_id) WHERE status IN ('submitted','in_review','needs_changes');
CREATE UNIQUE INDEX cases_one_appeal ON verification.cases (appeal_of) WHERE appeal_of IS NOT NULL;
CREATE INDEX cases_queue_idx ON verification.cases (status, due_at);
CREATE INDEX cases_org_idx ON verification.cases (org_id, submitted_at DESC);

-- The documents attached to a case, fixed at the moment it was submitted.
CREATE TABLE verification.case_files (
  case_id uuid NOT NULL REFERENCES verification.cases(id),
  file_id uuid NOT NULL REFERENCES supply.files(id),
  PRIMARY KEY (case_id, file_id)
);

CREATE OR REPLACE FUNCTION verification.cases_guard() RETURNS trigger AS $$
DECLARE orig verification.cases%ROWTYPE; p_org uuid;
BEGIN
  SELECT org_id INTO p_org FROM supply.properties WHERE id = NEW.property_id;
  IF p_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'case organisation does not match the property organisation'; END IF;

  -- Reviewers must hold the reviewer role and must NOT belong to the organisation that owns the case.
  IF NEW.claimed_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.claimed_by IS DISTINCT FROM OLD.claimed_by) THEN
    IF NOT EXISTS (SELECT 1 FROM identity.platform_roles WHERE user_id = NEW.claimed_by AND role IN ('reviewer','super_admin')) THEN RAISE EXCEPTION 'claimant is not a reviewer'; END IF;
    IF EXISTS (SELECT 1 FROM identity.memberships WHERE user_id = NEW.claimed_by AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'reviewer belongs to the case organisation'; END IF;
  END IF;
  IF NEW.decided_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
    IF NOT EXISTS (SELECT 1 FROM identity.platform_roles WHERE user_id = NEW.decided_by AND role IN ('reviewer','super_admin')) THEN RAISE EXCEPTION 'decider is not a reviewer'; END IF;
    IF EXISTS (SELECT 1 FROM identity.memberships WHERE user_id = NEW.decided_by AND org_id = NEW.org_id) THEN RAISE EXCEPTION 'reviewer belongs to the case organisation'; END IF;
  END IF;

  -- An appeal answers one rejected case of the same property, is never itself appealed, and is decided by someone else.
  IF NEW.appeal_of IS NOT NULL THEN
    SELECT * INTO orig FROM verification.cases WHERE id = NEW.appeal_of;
    IF NOT FOUND OR orig.status <> 'rejected' OR orig.property_id <> NEW.property_id THEN RAISE EXCEPTION 'an appeal must answer a rejected case of the same property'; END IF;
    IF orig.appeal_of IS NOT NULL THEN RAISE EXCEPTION 'an appeal cannot itself be appealed'; END IF;
    IF NEW.decided_by IS NOT NULL AND NEW.decided_by = orig.decided_by THEN RAISE EXCEPTION 'an appeal must be decided by a different reviewer'; END IF;
  END IF;

  -- A decision is final.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved','rejected') THEN
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.reason_code IS DISTINCT FROM OLD.reason_code THEN
      RAISE EXCEPTION 'a decided case cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER cases_guard_trg BEFORE INSERT OR UPDATE ON verification.cases FOR EACH ROW EXECUTE FUNCTION verification.cases_guard();

-- Attached documents must belong to the case's property and be ready.
CREATE OR REPLACE FUNCTION verification.case_files_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM verification.cases c JOIN supply.files f ON f.property_id = c.property_id
                  WHERE c.id = NEW.case_id AND f.id = NEW.file_id AND f.kind = 'document' AND f.status = 'ready') THEN
    RAISE EXCEPTION 'only ready documents of the same property can be attached to a case';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER case_files_guard_trg BEFORE INSERT ON verification.case_files FOR EACH ROW EXECUTE FUNCTION verification.case_files_guard();

-- Evidence is frozen: a document used by an open or approved case cannot be deleted or replaced.
CREATE OR REPLACE FUNCTION supply.files_frozen_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('deleted','rejected') AND OLD.status NOT IN ('deleted','rejected') THEN
    IF EXISTS (SELECT 1 FROM verification.case_files cf JOIN verification.cases c ON c.id = cf.case_id
                WHERE cf.file_id = OLD.id AND c.status IN ('submitted','in_review','needs_changes','approved')) THEN
      RAISE EXCEPTION 'this document is evidence in a verification case and cannot be removed';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER files_frozen_guard_trg BEFORE UPDATE OF status ON supply.files FOR EACH ROW EXECUTE FUNCTION supply.files_frozen_guard();

-- A badge must expire after it is issued.
ALTER TABLE verification.badges ADD CONSTRAINT badges_expiry_after_issue CHECK (expires_at > issued_at);

-- Same lock-down as every other table: row security on, no policies, no access for Supabase's API roles.
ALTER TABLE verification.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.case_files ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON verification.cases, verification.case_files FROM anon, authenticated';
  END IF;
END $$;
