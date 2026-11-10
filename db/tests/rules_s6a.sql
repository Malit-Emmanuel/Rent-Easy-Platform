-- S6a rule tests (review time record, cost inputs, integrity rules and alerts, second looks). Everything rolls back.
-- Read the result in the final error message: "RULES S6A: N passed, M failed [...]".
DO $$
DECLARE passed int := 0; failed text[] := '{}'; sid uuid; v record; n int; t0 timestamptz := now() - interval '3 hours';
  org uuid := 'e6a00000-0000-0000-0000-000000000001'; r1 uuid := 'e6a00000-0000-0000-0000-000000000002'; r2 uuid := 'e6a00000-0000-0000-0000-000000000003';
  adm uuid := 'e6a00000-0000-0000-0000-000000000004'; mgr uuid := 'e6a00000-0000-0000-0000-000000000005'; plain uuid := 'e6a00000-0000-0000-0000-000000000006';
  p uuid := 'e6a00000-0000-0000-0000-000000000010'; c1 uuid := 'e6a00000-0000-0000-0000-0000000000a1'; c2 uuid := 'e6a00000-0000-0000-0000-0000000000a2';
  bd uuid; al uuid; al2 uuid; sl uuid; d1 date := date_trunc('month', now())::date;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  INSERT INTO identity.organizations(id,name,kind) VALUES (org,'S6a Org','agency');
  INSERT INTO identity.users(id,phone) VALUES (r1,'+254700000601'),(r2,'+254700000602'),(adm,'+254700000603'),(mgr,'+254700000604'),(plain,'+254700000605');
  INSERT INTO identity.platform_roles(user_id,role) VALUES (r1,'reviewer'),(r2,'reviewer'),(adm,'super_admin');
  INSERT INTO identity.memberships(user_id,org_id,role) VALUES (mgr,org,'manager_admin'),(r2,org,'agent');
  INSERT INTO supply.properties(id,org_id,name,address_text,location) VALUES (p,org,'P','addr',extensions.st_point(36.8,-1.29)::extensions.geography);
  INSERT INTO verification.badges(subject_type,subject_id,level,issued_at,expires_at) VALUES ('property',p,'t1_documented',now(),now()+interval '12 months') RETURNING id INTO bd;
  INSERT INTO verification.cases(id,org_id,property_id,tier,status,submitted_by,submitted_at,due_at,decided_by,decided_at,badge_id)
    VALUES (c1,org,p,'t1','approved',mgr,t0,t0+interval '3 days',r1,t0+interval '2 hours',bd);

  -- ===== 1. Handling time: each gap is capped at 30 minutes =====
  -- claimed 3 h ago; opened a document 10 min later; decided 2 h after the claim. Gaps: 10 min, then 110 min -> capped 30 min. Handling = 40 min.
  INSERT INTO governance.data_access_log(accessed_at, accessor_id, resource, reason) VALUES (t0+interval '10 minutes', r1, 'doc', 'case ' || c1 || ' document');
  INSERT INTO governance.data_access_log(accessed_at, accessor_id, resource, reason) VALUES (t0+interval '20 minutes', r2, 'doc', 'case ' || c1 || ' document');   -- someone else's opening is ignored
  INSERT INTO governance.data_access_log(accessed_at, accessor_id, resource, reason) VALUES (t0+interval '25 minutes', r1, 'doc', 'case ' || c2 || ' document');   -- another case is ignored
  IF verification.capped_handling_seconds(c1, r1, t0, t0+interval '2 hours') = 2400 THEN passed := passed + 1; ELSE failed := failed || ('cap wrong: ' || verification.capped_handling_seconds(c1, r1, t0, t0+interval '2 hours')); END IF;
  IF verification.capped_handling_seconds(c1, r1, t0, t0+interval '5 minutes') = 300 THEN passed := passed + 1; ELSE failed := failed || 'short stretch wrong'; END IF;
  IF verification.capped_handling_seconds(c1, r1, t0, t0) = 0 THEN passed := passed + 1; ELSE failed := failed || 'zero stretch wrong'; END IF;

  sid := verification.close_review_session(c1, r1, t0, t0+interval '2 hours', 'decided');
  SELECT * INTO v FROM verification.review_sessions WHERE id = sid;
  IF v.elapsed_seconds = 7200 AND v.handling_seconds = 2400 AND v.opens = 1 AND v.end_reason = 'decided' THEN passed := passed + 1; ELSE failed := failed || ('session figures wrong: ' || row_to_json(v)::text); END IF;

  -- ===== 2. The time record is append-only and well formed =====
  BEGIN UPDATE verification.review_sessions SET handling_seconds = 1 WHERE id = sid; failed := failed || 'session edited';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN DELETE FROM verification.review_sessions WHERE id = sid; failed := failed || 'session deleted';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.review_sessions(case_id,reviewer_id,claimed_at,ended_at,end_reason,elapsed_seconds,handling_seconds) VALUES (c1,r1,t0,t0-interval '1 minute','released',0,0); failed := failed || 'end before start accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.review_sessions(case_id,reviewer_id,claimed_at,ended_at,end_reason,elapsed_seconds,handling_seconds) VALUES (c1,r1,t0,t0+interval '1 minute','released',60,61); failed := failed || 'handling above elapsed accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.review_sessions(case_id,reviewer_id,claimed_at,ended_at,end_reason,elapsed_seconds,handling_seconds) VALUES (c1,r1,t0,t0+interval '1 minute','vanished',60,60); failed := failed || 'unknown end reason accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
  BEGIN PERFORM verification.close_review_session(c1, plain, t0, t0+interval '1 minute', 'released'); failed := failed || 'a non-reviewer got a session';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  IF verification.close_review_session(c1, adm, t0, t0+interval '1 minute', 'admin_released') IS NOT NULL THEN passed := passed + 1; ELSE failed := failed || 'admin could not be recorded'; END IF;

  -- ===== 3. Cost inputs: typed by a person, append-only, latest wins =====
  INSERT INTO verification.cost_inputs(period,tier,kind,amount_kes,note,created_by) VALUES (d1,'all','reviewer_rate_per_hour',600,'placeholder',adm);
  INSERT INTO verification.cost_inputs(period,tier,kind,amount_kes,note,created_by) VALUES (d1,'all','reviewer_rate_per_hour',750,'agreed rate',adm);
  IF (SELECT amount_kes FROM verification.cost_inputs_current WHERE period = d1 AND tier = 'all' AND kind = 'reviewer_rate_per_hour') = 750 THEN passed := passed + 1; ELSE failed := failed || 'latest cost input not used'; END IF;
  IF (SELECT count(*) FROM verification.cost_inputs WHERE period = d1) = 2 THEN passed := passed + 1; ELSE failed := failed || 'earlier input lost'; END IF;
  BEGIN UPDATE verification.cost_inputs SET amount_kes = 1 WHERE period = d1; failed := failed || 'cost input edited';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.cost_inputs(period,tier,kind,amount_kes,created_by) VALUES (d1,'t1','other',-5,adm); failed := failed || 'negative cost accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.cost_inputs(period,tier,kind,amount_kes,created_by) VALUES (d1 + 3,'t1','other',5,adm); failed := failed || 'mid-month period accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;

  -- ===== 4. Integrity rules: seeded, adjustable, changes audited =====
  IF (SELECT count(*) FROM verification.integrity_rules) = 13 AND (SELECT count(*) FROM verification.integrity_rules WHERE enabled) = 10 THEN passed := passed + 1; ELSE failed := failed || 'seed rules wrong'; END IF;
  IF (SELECT enabled FROM verification.integrity_rules WHERE code = 'second_look_disagree') = false THEN passed := passed + 1; ELSE failed := failed || 'second looks not off by default'; END IF;
  n := (SELECT count(*) FROM governance.audit_events WHERE action = 'integrity.rule_changed');
  UPDATE verification.integrity_rules SET threshold = 30, updated_by = adm WHERE code = 'approval_rate_high';
  IF (SELECT count(*) FROM governance.audit_events WHERE action = 'integrity.rule_changed') = n + 1 THEN passed := passed + 1; ELSE failed := failed || 'rule change not audited'; END IF;
  BEGIN DELETE FROM verification.integrity_rules WHERE code = 'burst'; failed := failed || 'rule deleted';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;

  -- ===== 5. Alerts: advisory records with a controlled handling step =====
  INSERT INTO verification.integrity_alerts(rule_code, reviewer_id, figures, case_ids) VALUES ('too_fast', r1, '{"median_seconds": 20, "decisions": 16}', ARRAY[c1]) RETURNING id INTO al;
  BEGIN INSERT INTO verification.integrity_alerts(rule_code, reviewer_id) VALUES ('too_fast', r1); failed := failed || 'duplicate live alert accepted';
  EXCEPTION WHEN unique_violation THEN passed := passed + 1; END;
  BEGIN UPDATE verification.integrity_alerts SET figures = '{}' WHERE id = al; failed := failed || 'alert figures edited';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN UPDATE verification.integrity_alerts SET status = 'dismissed', handled_by = adm, handled_at = now() WHERE id = al; failed := failed || 'dismissed without a note';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
  BEGIN UPDATE verification.integrity_alerts SET status = 'dismissed', handled_by = r1, handled_at = now(), handler_note = 'self' WHERE id = al; failed := failed || 'reviewer handled own alert';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN UPDATE verification.integrity_alerts SET status = 'dismissed', handled_by = r2, handled_at = now(), handler_note = 'peer' WHERE id = al; failed := failed || 'non-admin handled an alert';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  UPDATE verification.integrity_alerts SET status = 'escalated', handled_by = adm, handled_at = now(), handler_note = 'looks odd, asking the reviewer' WHERE id = al;
  IF (SELECT status FROM verification.integrity_alerts WHERE id = al) = 'escalated' THEN passed := passed + 1; ELSE failed := failed || 'escalation failed'; END IF;
  BEGIN INSERT INTO verification.integrity_alerts(rule_code, reviewer_id) VALUES ('too_fast', r1); failed := failed || 'second live alert while escalated';
  EXCEPTION WHEN unique_violation THEN passed := passed + 1; END;
  UPDATE verification.integrity_alerts SET status = 'dismissed', handled_by = adm, handled_at = now(), handler_note = 'explained: easy queue' WHERE id = al;
  BEGIN UPDATE verification.integrity_alerts SET status = 'open', handled_by = NULL, handled_at = NULL, handler_note = NULL WHERE id = al; failed := failed || 'closed alert reopened';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN DELETE FROM verification.integrity_alerts WHERE id = al; failed := failed || 'alert deleted';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  IF (SELECT count(*) FROM governance.audit_events WHERE action IN ('integrity.alert_escalated','integrity.alert_dismissed') AND subject_id = al::text) = 2 THEN passed := passed + 1; ELSE failed := failed || 'alert handling not audited'; END IF;
  INSERT INTO verification.integrity_alerts(rule_code, reviewer_id) VALUES ('too_fast', r1) RETURNING id INTO al2;   -- once closed, the scan may raise a new one
  passed := passed + 1;
  -- an alert changes nothing about the case or the reviewer
  IF (SELECT status FROM verification.cases WHERE id = c1) = 'approved' AND EXISTS (SELECT 1 FROM identity.platform_roles WHERE user_id = r1 AND role = 'reviewer') THEN passed := passed + 1; ELSE failed := failed || 'alert changed a case or role'; END IF;

  -- ===== 6. Second looks =====
  BEGIN INSERT INTO verification.second_looks(case_id, second_reviewer_id, selected_why) VALUES (c1, r1, 'sample'); failed := failed || 'second look by the decider';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.second_looks(case_id, second_reviewer_id, selected_why) VALUES (c1, r2, 'sample'); failed := failed || 'second look by a member of the case organisation';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.second_looks(case_id, second_reviewer_id, selected_why) VALUES (c1, plain, 'sample'); failed := failed || 'second look by a non-reviewer';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  INSERT INTO identity.users(id,phone) VALUES ('e6a00000-0000-0000-0000-000000000007','+254700000607');
  INSERT INTO identity.platform_roles(user_id,role) VALUES ('e6a00000-0000-0000-0000-000000000007','reviewer');
  INSERT INTO verification.second_looks(case_id, second_reviewer_id, selected_why) VALUES (c1, 'e6a00000-0000-0000-0000-000000000007', 'sample') RETURNING id INTO sl;
  UPDATE verification.second_looks SET outcome = 'agree', completed_at = now() WHERE id = sl;
  BEGIN UPDATE verification.second_looks SET outcome = 'disagree' WHERE id = sl; failed := failed || 'completed second look changed';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN DELETE FROM verification.second_looks WHERE id = sl; failed := failed || 'second look deleted';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  IF (SELECT status FROM verification.cases WHERE id = c1) = 'approved' THEN passed := passed + 1; ELSE failed := failed || 'a second look changed the case'; END IF;

  -- ===== 7. Nothing is open to the public =====
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'verification'
      AND c.relname IN ('review_sessions','cost_inputs','integrity_rules','integrity_alerts','second_looks') AND NOT c.relrowsecurity) THEN passed := passed + 1;
  ELSE failed := failed || 'row-level security missing'; END IF;

  RAISE EXCEPTION 'RULES S6A: % passed, % failed %', passed, cardinality(failed), failed;
END $$;
