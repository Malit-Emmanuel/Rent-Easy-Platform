-- S6a: reviewer integrity and cost reporting (database layer).
-- Advisory only: nothing here blocks, suspends or changes a case. Measures only moments the system already knows.

-- ---------- Handling time ----------
CREATE OR REPLACE FUNCTION verification.handling_cap_seconds() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 1800 $$;

-- Sum of the gaps between claim, each evidence opening by this reviewer for this case, and the end; each gap capped.
CREATE OR REPLACE FUNCTION verification.capped_handling_seconds(p_case uuid, p_reviewer uuid, p_from timestamptz, p_to timestamptz)
RETURNS int LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  WITH pts AS (
    SELECT p_from AS t
    UNION ALL
    SELECT accessed_at FROM governance.data_access_log
      WHERE accessor_id = p_reviewer AND reason LIKE 'case ' || p_case::text || '%' AND accessed_at > p_from AND accessed_at < p_to
    UNION ALL
    SELECT p_to
  ), g AS (SELECT t, lead(t) OVER (ORDER BY t) AS nxt FROM pts)
  SELECT coalesce(sum(least(extract(epoch FROM (nxt - t)), verification.handling_cap_seconds())), 0)::int FROM g WHERE nxt IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION verification.require_reviewer_role() RETURNS trigger AS $$
DECLARE uid uuid;
BEGIN
  uid := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'review_sessions' THEN 'reviewer_id' ELSE 'second_reviewer_id' END)::uuid;
  IF NOT EXISTS (SELECT 1 FROM identity.platform_roles WHERE user_id = uid AND role IN ('reviewer','super_admin')) THEN
    RAISE EXCEPTION 'user % holds no reviewer role', uid;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;

CREATE TABLE verification.review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES verification.cases(id),
  reviewer_id uuid NOT NULL REFERENCES identity.users(id),
  claimed_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  end_reason text NOT NULL CHECK (end_reason IN ('decided','released','sent_back','admin_released')),
  elapsed_seconds int NOT NULL CHECK (elapsed_seconds >= 0),
  handling_seconds int NOT NULL CHECK (handling_seconds >= 0),
  opens int NOT NULL DEFAULT 0 CHECK (opens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_sessions_order CHECK (ended_at >= claimed_at),
  CONSTRAINT review_sessions_cap CHECK (handling_seconds <= elapsed_seconds)
);
CREATE INDEX review_sessions_reviewer_idx ON verification.review_sessions(reviewer_id, ended_at);
CREATE INDEX review_sessions_case_idx ON verification.review_sessions(case_id);
CREATE TRIGGER review_sessions_no_mutation BEFORE UPDATE OR DELETE ON verification.review_sessions FOR EACH ROW EXECUTE FUNCTION governance.forbid_mutation();
CREATE TRIGGER review_sessions_reviewer BEFORE INSERT ON verification.review_sessions FOR EACH ROW EXECUTE FUNCTION verification.require_reviewer_role();

-- Closes a stretch of work: computes elapsed and capped handling time from the log and writes the record.
CREATE OR REPLACE FUNCTION verification.close_review_session(p_case uuid, p_reviewer uuid, p_claimed timestamptz, p_ended timestamptz, p_reason text)
RETURNS uuid LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE sid uuid; opens int;
BEGIN
  SELECT count(*) INTO opens FROM governance.data_access_log
    WHERE accessor_id = p_reviewer AND reason LIKE 'case ' || p_case::text || '%' AND accessed_at > p_claimed AND accessed_at < p_ended;
  INSERT INTO verification.review_sessions(case_id, reviewer_id, claimed_at, ended_at, end_reason, elapsed_seconds, handling_seconds, opens)
  VALUES (p_case, p_reviewer, p_claimed, p_ended, p_reason,
          floor(extract(epoch FROM (p_ended - p_claimed)))::int,
          verification.capped_handling_seconds(p_case, p_reviewer, p_claimed, p_ended), opens)
  RETURNING id INTO sid;
  RETURN sid;
END $$;

-- ---------- Cost inputs (typed by an admin; the system never guesses) ----------
CREATE TABLE verification.cost_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period date NOT NULL CHECK (period = date_trunc('month', period)::date),
  tier text NOT NULL CHECK (tier IN ('t1','t2','all')),
  kind text NOT NULL CHECK (kind IN ('reviewer_rate_per_hour','identity_check_fees','field_visits','other')),
  amount_kes numeric(12,2) NOT NULL CHECK (amount_kes >= 0),
  note text,
  created_by uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cost_inputs_lookup_idx ON verification.cost_inputs(period, tier, kind, created_at DESC);
CREATE TRIGGER cost_inputs_no_mutation BEFORE UPDATE OR DELETE ON verification.cost_inputs FOR EACH ROW EXECUTE FUNCTION governance.forbid_mutation();
CREATE VIEW verification.cost_inputs_current WITH (security_invoker = true) AS
  SELECT DISTINCT ON (period, tier, kind) period, tier, kind, amount_kes, note, created_by, created_at
  FROM verification.cost_inputs ORDER BY period, tier, kind, created_at DESC, id DESC;

-- ---------- Integrity rules (placeholders, editable; changes are audited) ----------
CREATE TABLE verification.integrity_rules (
  code text PRIMARY KEY,
  description text NOT NULL,
  threshold numeric NOT NULL,
  unit text NOT NULL,
  min_sample int NOT NULL DEFAULT 1 CHECK (min_sample >= 0),
  window_days int CHECK (window_days > 0),
  window_minutes int CHECK (window_minutes > 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES identity.users(id)
);
INSERT INTO verification.integrity_rules(code, description, threshold, unit, min_sample, window_days, window_minutes, enabled) VALUES
 ('approval_rate_high',     'Approval rate above the median of other reviewers', 25,   'percentage_points', 20, 30, NULL, true),
 ('too_fast',               'Median time from last opening to decision',         45,   'seconds',           15, 30, NULL, true),
 ('org_concentration',      'Share of approvals for one organisation',            40,   'percent',           10, 30, NULL, true),
 ('approvals_withdrawn',    'Approvals withdrawn within 90 days',                 10,   'percent',           10, 90, NULL, true),
 ('appeals_overturned',     'Appealed rejections overturned',                     40,   'percent',            5, 90, NULL, true),
 ('flagged_approved',       'Approvals of strongly flagged cases',                 0,   'cases',              0, 30, NULL, true),
 ('uniform_checklist',      'T2 decisions with six yes answers and no "no"',     100,   'percent',           20, 30, NULL, true),
 ('burst',                  'Decisions inside the window',                        15,   'decisions',         15, NULL, 10, true),
 ('stale_claim',            'Hours a case is claimed with no decision',            4,   'hours',              1, NULL, NULL, true),
 ('own_org_attempt',        'Refused claim or open of own-organisation case',      1,   'attempts',           1, 30, NULL, true),
 ('second_look_disagree',   'Second reviewer disagrees with the first',            1,   'cases',              1, 90, NULL, false),
 ('second_look_rate_new',   'Share of a new reviewer''s first 100 approvals re-checked', 10, 'percent',        0, NULL, NULL, false),
 ('second_look_rate_later', 'Share of later approvals re-checked',                  5,   'percent',            0, NULL, NULL, false);

CREATE OR REPLACE FUNCTION verification.integrity_rule_audit() RETURNS trigger AS $$
BEGIN
  IF NEW.code <> OLD.code THEN RAISE EXCEPTION 'a rule code cannot be changed'; END IF;
  IF NEW.threshold IS DISTINCT FROM OLD.threshold OR NEW.min_sample IS DISTINCT FROM OLD.min_sample OR NEW.enabled IS DISTINCT FROM OLD.enabled
     OR NEW.window_days IS DISTINCT FROM OLD.window_days OR NEW.window_minutes IS DISTINCT FROM OLD.window_minutes THEN
    NEW.updated_at := now();
    INSERT INTO governance.audit_events(actor_id, action, subject_type, subject_id, metadata)
    VALUES (NEW.updated_by, 'integrity.rule_changed', 'integrity_rule', NEW.code,
      jsonb_build_object('threshold', jsonb_build_array(OLD.threshold, NEW.threshold), 'min_sample', jsonb_build_array(OLD.min_sample, NEW.min_sample),
        'enabled', jsonb_build_array(OLD.enabled, NEW.enabled)));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER integrity_rules_audit BEFORE UPDATE ON verification.integrity_rules FOR EACH ROW EXECUTE FUNCTION verification.integrity_rule_audit();
CREATE TRIGGER integrity_rules_no_delete BEFORE DELETE ON verification.integrity_rules FOR EACH ROW EXECUTE FUNCTION governance.forbid_mutation();

-- ---------- Alerts (advisory; append-only apart from one controlled handling step) ----------
CREATE TABLE verification.integrity_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text NOT NULL REFERENCES verification.integrity_rules(code),
  reviewer_id uuid NOT NULL REFERENCES identity.users(id),
  raised_at timestamptz NOT NULL DEFAULT now(),
  window_from timestamptz,
  window_to timestamptz,
  figures jsonb NOT NULL DEFAULT '{}',
  case_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','dismissed','escalated')),
  handled_by uuid REFERENCES identity.users(id),
  handled_at timestamptz,
  handler_note text,
  CONSTRAINT integrity_alerts_handled CHECK (
    (status = 'open' AND handled_by IS NULL AND handled_at IS NULL AND handler_note IS NULL) OR
    (status <> 'open' AND handled_by IS NOT NULL AND handled_at IS NOT NULL AND length(btrim(coalesce(handler_note,''))) > 0))
);
-- one live (open or escalated) alert per rule and reviewer, so the daily scan cannot pile up duplicates
CREATE UNIQUE INDEX integrity_alerts_one_live ON verification.integrity_alerts(rule_code, reviewer_id) WHERE status IN ('open','escalated');
CREATE INDEX integrity_alerts_reviewer_idx ON verification.integrity_alerts(reviewer_id, raised_at);

CREATE OR REPLACE FUNCTION verification.integrity_alert_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'integrity_alerts is append-only; an alert is closed, never deleted'; END IF;
  IF NEW.id <> OLD.id OR NEW.rule_code <> OLD.rule_code OR NEW.reviewer_id <> OLD.reviewer_id OR NEW.raised_at <> OLD.raised_at
     OR NEW.window_from IS DISTINCT FROM OLD.window_from OR NEW.window_to IS DISTINCT FROM OLD.window_to
     OR NEW.figures <> OLD.figures OR NEW.case_ids <> OLD.case_ids THEN
    RAISE EXCEPTION 'only the handling fields of an alert may change';
  END IF;
  IF NOT ((OLD.status = 'open' AND NEW.status IN ('acknowledged','dismissed','escalated')) OR (OLD.status = 'escalated' AND NEW.status IN ('acknowledged','dismissed'))) THEN
    RAISE EXCEPTION 'alert status cannot go from % to %', OLD.status, NEW.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.platform_roles WHERE user_id = NEW.handled_by AND role = 'super_admin') THEN
    RAISE EXCEPTION 'only an admin may handle an alert';
  END IF;
  IF NEW.handled_by = NEW.reviewer_id THEN RAISE EXCEPTION 'a reviewer cannot handle an alert about themselves'; END IF;
  INSERT INTO governance.audit_events(actor_id, action, subject_type, subject_id, metadata)
  VALUES (NEW.handled_by, 'integrity.alert_' || NEW.status, 'integrity_alert', NEW.id::text, jsonb_build_object('rule', NEW.rule_code));
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER integrity_alerts_guard BEFORE UPDATE OR DELETE ON verification.integrity_alerts FOR EACH ROW EXECUTE FUNCTION verification.integrity_alert_guard();

-- ---------- Second looks (used only when sampling is switched on) ----------
CREATE TABLE verification.second_looks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES verification.cases(id),
  second_reviewer_id uuid NOT NULL REFERENCES identity.users(id),
  selected_at timestamptz NOT NULL DEFAULT now(),
  selected_why text NOT NULL CHECK (selected_why IN ('sample','flagged')),
  outcome text CHECK (outcome IN ('agree','disagree')),
  completed_at timestamptz,
  CONSTRAINT second_looks_done CHECK ((outcome IS NULL) = (completed_at IS NULL))
);
CREATE OR REPLACE FUNCTION verification.second_look_guard() RETURNS trigger AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM verification.cases WHERE id = NEW.case_id;
  IF c.status <> 'approved' THEN RAISE EXCEPTION 'only an approved case can have a second look'; END IF;
  IF NEW.second_reviewer_id = c.decided_by THEN RAISE EXCEPTION 'the second look must be by a different reviewer'; END IF;
  IF EXISTS (SELECT 1 FROM identity.memberships m WHERE m.org_id = c.org_id AND m.user_id = NEW.second_reviewer_id) THEN
    RAISE EXCEPTION 'the second reviewer belongs to the case organisation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER second_looks_guard BEFORE INSERT ON verification.second_looks FOR EACH ROW EXECUTE FUNCTION verification.second_look_guard();
CREATE TRIGGER second_looks_reviewer BEFORE INSERT ON verification.second_looks FOR EACH ROW EXECUTE FUNCTION verification.require_reviewer_role();

-- A second look can be completed once, and nothing else about it changes. Never deleted.
CREATE OR REPLACE FUNCTION verification.second_look_complete_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'second_looks cannot be deleted'; END IF;
  IF OLD.outcome IS NOT NULL THEN RAISE EXCEPTION 'a completed second look cannot change'; END IF;
  IF NEW.id <> OLD.id OR NEW.case_id <> OLD.case_id OR NEW.second_reviewer_id <> OLD.second_reviewer_id OR NEW.selected_at <> OLD.selected_at OR NEW.selected_why <> OLD.selected_why THEN
    RAISE EXCEPTION 'only the outcome of a second look may be set';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER second_looks_complete BEFORE UPDATE OR DELETE ON verification.second_looks FOR EACH ROW EXECUTE FUNCTION verification.second_look_complete_guard();

-- ---------- No public access, as everywhere ----------
ALTER TABLE verification.review_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.cost_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.integrity_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.integrity_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.second_looks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON verification.review_sessions, verification.cost_inputs, verification.cost_inputs_current, verification.integrity_rules, verification.integrity_alerts, verification.second_looks FROM anon, authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION verification.close_review_session(uuid,uuid,timestamptz,timestamptz,text), verification.capped_handling_seconds(uuid,uuid,timestamptz,timestamptz) FROM anon, authenticated, public';
  END IF;
END $$;
