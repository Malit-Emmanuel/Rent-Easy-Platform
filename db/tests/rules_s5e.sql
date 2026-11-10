-- S5e rule tests (the T2 badge lifecycle). Run after rules_portable.sql with psql OR Supabase's SQL runner. Everything rolls back.
-- Read the result in the final error message: "RULES S5E: N passed, M failed [...]".
DO $$
DECLARE passed int := 0; failed text[] := '{}';
  org uuid := 'e5e00000-0000-0000-0000-000000000001'; u uuid := 'e5e00000-0000-0000-0000-000000000002'; p uuid := 'e5e00000-0000-0000-0000-000000000003';
  p2 uuid := 'e5e00000-0000-0000-0000-000000000004'; p3 uuid := 'e5e00000-0000-0000-0000-000000000005'; t1b uuid; t2b uuid; t2c uuid; v record; n int; ids uuid[];
  sha bytea := decode(repeat('ab', 32), 'hex');
  chA uuid := 'e5e00000-0000-0000-0000-0000000000c1'; chB uuid := 'e5e00000-0000-0000-0000-0000000000c2'; chC uuid := 'e5e00000-0000-0000-0000-0000000000c3';
  chE uuid := 'e5e00000-0000-0000-0000-0000000000c5'; chF uuid := 'e5e00000-0000-0000-0000-0000000000c6'; chG uuid := 'e5e00000-0000-0000-0000-0000000000c7';
  caA uuid := 'e5e00000-0000-0000-0000-0000000000a1'; caB uuid := 'e5e00000-0000-0000-0000-0000000000a2'; caC uuid := 'e5e00000-0000-0000-0000-0000000000a3';
  caC2 uuid := 'e5e00000-0000-0000-0000-0000000000a4'; caG uuid := 'e5e00000-0000-0000-0000-0000000000a7';
  fA uuid := 'e5e00000-0000-0000-0000-0000000000f1'; fB uuid := 'e5e00000-0000-0000-0000-0000000000f2'; fC uuid := 'e5e00000-0000-0000-0000-0000000000f3';
  fE uuid := 'e5e00000-0000-0000-0000-0000000000f5'; fF uuid := 'e5e00000-0000-0000-0000-0000000000f6'; fG uuid := 'e5e00000-0000-0000-0000-0000000000f7'; fH uuid := 'e5e00000-0000-0000-0000-0000000000f8';
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  INSERT INTO identity.organizations(id,name,kind) VALUES (org,'S5e Org','agency');
  INSERT INTO identity.users(id,phone) VALUES (u,'+254700000502');
  INSERT INTO supply.properties(id,org_id,name,address_text,location) VALUES (p,org,'P','addr',extensions.st_point(36.8,-1.29)::extensions.geography);
  INSERT INTO supply.properties(id,org_id,name,address_text,location) VALUES (p2,org,'P2','addr2',extensions.st_point(36.9,-1.30)::extensions.geography);
  INSERT INTO supply.properties(id,org_id,name,address_text,location) VALUES (p3,org,'P3','addr3',extensions.st_point(36.95,-1.35)::extensions.geography);

  -- ===== 1. The approved position is remembered and cannot be rewritten =====
  INSERT INTO verification.badges(subject_type,subject_id,level,issued_at,expires_at) VALUES ('property',p,'t1_documented',now(),now()+interval '12 months') RETURNING id INTO t1b;
  INSERT INTO verification.badges(subject_type,subject_id,level,issued_at,expires_at) VALUES ('property',p,'t2_video',now(),now()+interval '6 months') RETURNING id INTO t2b;
  SELECT * INTO v FROM verification.badges WHERE id = t2b;
  IF abs(v.anchor_lat - (-1.29)) < 1e-9 AND abs(v.anchor_lon - 36.8) < 1e-9 THEN passed := passed + 1; ELSE failed := failed || 'T2 badge did not remember the approved position'; END IF;
  SELECT * INTO v FROM verification.badges WHERE id = t1b;
  IF v.anchor_lat IS NULL THEN passed := passed + 1; ELSE failed := failed || 'T1 badge got an anchor'; END IF;
  BEGIN UPDATE verification.badges SET anchor_lat = -1.0, anchor_lon = 36.0 WHERE id = t2b; failed := failed || 'anchor rewritten';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.badges(subject_type,subject_id,level,issued_at,expires_at,anchor_lat) VALUES ('property',p2,'t2_video',now(),now()+interval '6 months',-1.3); failed := failed || 'half an anchor accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;

  -- ===== 2. Moving the pin =====
  UPDATE supply.properties SET location = extensions.st_point(36.8,-1.28946)::extensions.geography WHERE id = p;      -- about 60 m
  IF (SELECT revoked_at FROM verification.badges WHERE id = t2b) IS NULL THEN passed := passed + 1; ELSE failed := failed || 'a 60 m move ended T2'; END IF;
  UPDATE supply.properties SET location = extensions.st_point(36.8,-1.28892)::extensions.geography WHERE id = p;      -- another 60 m: 120 m from where it was approved
  SELECT * INTO v FROM verification.badges WHERE id = t2b;
  IF v.revoked_at IS NOT NULL AND v.revoke_reason_code = 't2_position_moved' THEN passed := passed + 1; ELSE failed := failed || 'walking the pin in small steps kept T2'; END IF;
  IF (SELECT revoked_at FROM verification.badges WHERE id = t1b) IS NULL THEN passed := passed + 1; ELSE failed := failed || 'moving the pin ended T1'; END IF;
  SELECT count(*) INTO n FROM governance.audit_events WHERE action = 'verification.badge_revoked' AND subject_id = t2b::text AND metadata->>'reasonCode' = 't2_position_moved' AND metadata->>'rule' = 'position_moved' AND NOT (metadata ? 'lat') AND NOT (metadata ? 'lon');
  IF n = 1 THEN passed := passed + 1; ELSE failed := failed || ('position move not audited once: ' || n); END IF;
  BEGIN UPDATE verification.badges SET revoke_reason_code = 'other', revoke_note = 'x' WHERE id = t2b; failed := failed || 'an ended T2 badge was edited';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;

  -- a move of the same property later does not end anything twice, and a new T2 badge is anchored at the new position
  INSERT INTO verification.badges(subject_type,subject_id,level,issued_at,expires_at) VALUES ('property',p,'t2_video',now(),now()+interval '6 months') RETURNING id INTO t2c;
  UPDATE supply.properties SET location = extensions.st_point(36.8,-1.28880)::extensions.geography WHERE id = p;      -- about 13 m from the new anchor
  IF (SELECT revoked_at FROM verification.badges WHERE id = t2c) IS NULL THEN passed := passed + 1; ELSE failed := failed || 'a 13 m move ended the new T2'; END IF;
  SELECT count(*) INTO n FROM governance.audit_events WHERE action = 'verification.badge_revoked' AND subject_id = t2b::text;
  IF n = 1 THEN passed := passed + 1; ELSE failed := failed || 'an ended badge was ended again'; END IF;

  -- removing the pin ends T2 too (nothing left to compare with)
  UPDATE supply.properties SET location = NULL WHERE id = p;
  SELECT * INTO v FROM verification.badges WHERE id = t2c;
  IF v.revoked_at IS NOT NULL AND v.revoke_reason_code = 't2_position_moved' THEN passed := passed + 1; ELSE failed := failed || 'removing the pin kept T2'; END IF;

  -- a property with no T2 badge can be moved freely
  UPDATE supply.properties SET location = extensions.st_point(37.0,-1.0)::extensions.geography WHERE id = p2;
  passed := passed + 1;

  -- ===== 3. T2 counts only while T1 is valid =====
  INSERT INTO verification.badges(subject_type,subject_id,level,issued_at,expires_at) VALUES ('property',p2,'t1_documented',now(),now()+interval '3 months');
  INSERT INTO verification.badges(subject_type,subject_id,level,issued_at,expires_at) VALUES ('property',p2,'t2_video',now(),now()+interval '5 months');
  SELECT * INTO v FROM verification.property_badge_status WHERE property_id = p2;
  IF v.t2_effective_until = v.t1_valid_until AND v.t2_valid_until > v.t1_valid_until THEN passed := passed + 1; ELSE failed := failed || 'T2 outlives T1 in the view'; END IF;
  UPDATE verification.badges SET revoked_at = now(), revoke_reason_code = 'doc_expired' WHERE subject_id = p2 AND level = 't1_documented';
  SELECT * INTO v FROM verification.property_badge_status WHERE property_id = p2;
  IF v.t1_valid_until IS NULL AND v.t2_valid_until IS NOT NULL AND v.t2_effective_until IS NULL THEN passed := passed + 1; ELSE failed := failed || 'T2 still counts without T1'; END IF;
  INSERT INTO verification.badges(subject_type,subject_id,level,issued_at,expires_at) VALUES ('property',p2,'t1_documented',now(),now()+interval '12 months');
  SELECT * INTO v FROM verification.property_badge_status WHERE property_id = p2;
  IF v.t2_effective_until = v.t2_valid_until THEN passed := passed + 1; ELSE failed := failed || 'T2 did not come back with a renewed T1'; END IF;

  -- ===== 4. Which videos are due for deletion =====
  -- Fixtures are built with the table rules switched off (they are tested elsewhere); only the candidate query is under test here.
  ALTER TABLE verification.cases DISABLE TRIGGER USER; ALTER TABLE verification.t2_evidence DISABLE TRIGGER USER;
  ALTER TABLE verification.t2_takes DISABLE TRIGGER USER; ALTER TABLE verification.t2_challenges DISABLE TRIGGER USER;
  INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,status,uploaded_by,ready_at) VALUES
    (fA,org,p2,'video','s5e/a','video/mp4',1000,'ready',u,now()), (fB,org,p2,'video','s5e/b','video/mp4',1000,'ready',u,now()), (fC,org,p2,'video','s5e/c','video/mp4',1000,'ready',u,now()),
    (fE,org,p2,'video','s5e/e','video/mp4',1000,'ready',u,now()), (fF,org,p2,'video','s5e/f','video/mp4',1000,'ready',u,now()), (fG,org,p2,'video','s5e/g','video/mp4',1000,'ready',u,now()),
    (fH,org,p2,'video','s5e/h','video/mp4',1000,'deleted',u,now());
  INSERT INTO verification.t2_challenges(id,org_id,property_id,requested_by,code,unit_ids,consent_at,issued_at,expires_at) VALUES
    (chA,org,p2,u,'1111',ARRAY[gen_random_uuid()],now()-interval '100 days',now()-interval '100 days',now()-interval '100 days'+interval '30 minutes'),
    (chB,org,p2,u,'2222',ARRAY[gen_random_uuid()],now()-interval '100 days',now()-interval '100 days',now()-interval '100 days'+interval '30 minutes'),
    (chC,org,p2,u,'3333',ARRAY[gen_random_uuid()],now()-interval '100 days',now()-interval '100 days',now()-interval '100 days'+interval '30 minutes'),
    (chE,org,p2,u,'5555',ARRAY[gen_random_uuid()],now()-interval '25 hours 30 minutes',now()-interval '25 hours 30 minutes',now()-interval '25 hours'),
    (chF,org,p2,u,'6666',ARRAY[gen_random_uuid()],now()-interval '23 hours 30 minutes',now()-interval '23 hours 30 minutes',now()-interval '23 hours'),
    (chG,org,p2,u,'7777',ARRAY[gen_random_uuid()],now()-interval '10 minutes',now()-interval '10 minutes',now()+interval '20 minutes');
  INSERT INTO verification.cases(id,org_id,property_id,tier,status,submitted_by,submitted_at,due_at,decided_by,decided_at,reason_code) VALUES
    (caA,org,p2,'t2','rejected',u,now()-interval '100 days',now()-interval '95 days',u,now()-interval '91 days','t2_location_mismatch'),
    (caB,org,p2,'t2','rejected',u,now()-interval '100 days',now()-interval '93 days',u,now()-interval '89 days','t2_location_mismatch'),
    (caC,org,p2,'t2','rejected',u,now()-interval '100 days',now()-interval '95 days',u,now()-interval '91 days','t2_location_mismatch');
  INSERT INTO verification.cases(id,org_id,property_id,tier,status,submitted_by,due_at,appeal_of) VALUES (caC2,org,p2,'t2','submitted',u,now()+interval '3 days',caC);
  INSERT INTO verification.cases(id,org_id,property_id,tier,status,submitted_by,due_at,claimed_by,claimed_at) VALUES (caG,org,p3,'t2','in_review',u,now()+interval '3 days',u,now());
  INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at) VALUES
    (caA,1,chA,fA,sha,-1.3,36.9,10,now()-interval '100 days',-1.3,36.9,10,now()-interval '100 days'),
    (caB,1,chB,fB,sha,-1.3,36.9,10,now()-interval '100 days',-1.3,36.9,10,now()-interval '100 days'),
    (caC,1,chC,fC,sha,-1.3,36.9,10,now()-interval '100 days',-1.3,36.9,10,now()-interval '100 days'),
    (caG,1,chG,fG,sha,-1.3,36.9,10,now()-interval '5 minutes',-1.3,36.9,10,now()-interval '4 minutes');
  INSERT INTO verification.t2_takes(file_id,challenge_id,take_no) VALUES (fA,chA,1),(fB,chB,1),(fC,chC,1),(fG,chG,1),(fE,chE,1),(fF,chF,1),(fH,chE,2);
  SELECT array_agg(file_id ORDER BY file_id) INTO ids FROM verification.t2_purge_candidates(100) WHERE file_id IN (fA,fB,fC,fE,fF,fG,fH);
  IF ids = ARRAY[fA, fE] THEN passed := passed + 1; ELSE failed := failed || ('wrong purge candidates: ' || coalesce(ids::text, 'none')); END IF;
  IF (SELECT why FROM verification.t2_purge_candidates(100) WHERE file_id = fA) = 'retention' AND (SELECT why FROM verification.t2_purge_candidates(100) WHERE file_id = fE) = 'unsubmitted'
    THEN passed := passed + 1; ELSE failed := failed || 'purge reasons wrong'; END IF;
  -- once the appeal is decided, the original's video becomes due
  UPDATE verification.cases SET status = 'rejected', decided_by = u, decided_at = now(), reason_code = 't2_location_mismatch' WHERE id = caC2;
  IF EXISTS (SELECT 1 FROM verification.t2_purge_candidates(100) WHERE file_id = fC) THEN passed := passed + 1; ELSE failed := failed || 'video stayed protected after the appeal was decided'; END IF;
  -- the batch limit applies to each kind
  IF (SELECT count(*) FROM verification.t2_purge_candidates(1)) <= 2 THEN passed := passed + 1; ELSE failed := failed || 'batch limit ignored'; END IF;

  RAISE EXCEPTION 'RULES S5E: % passed, % failed %', passed, cardinality(failed), failed;
END $$;
