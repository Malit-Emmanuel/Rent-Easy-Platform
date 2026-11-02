-- Portable rule tests: run with psql OR Supabase's SQL runner. Everything rolls back (it ends by raising).
-- Read the result in the final error message: "RULES: N passed, M failed [...]".
DO $$
DECLARE passed int := 0; failed text[] := '{}';
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;

  -- audit chain links, and cannot be edited or deleted
  INSERT INTO governance.audit_events(action,subject_type,subject_id) VALUES ('t1','x','1');
  INSERT INTO governance.audit_events(action,subject_type,subject_id) VALUES ('t2','x','2');
  IF (SELECT prev_hash FROM governance.audit_events WHERE action='t2') = (SELECT hash FROM governance.audit_events WHERE action='t1')
    THEN passed := passed + 1; ELSE failed := failed || 'audit chain not linked'; END IF;
  BEGIN UPDATE governance.audit_events SET action='tamper'; failed := failed || 'audit UPDATE allowed';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN DELETE FROM governance.audit_events; failed := failed || 'audit DELETE allowed';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;

  -- ledger: balanced entries accepted, unbalanced rejected, immutable
  INSERT INTO txn.ledger_accounts(id, code) VALUES ('a0000000-0000-0000-0000-00000000000a','A'),('b0000000-0000-0000-0000-00000000000b','B');
  BEGIN
    INSERT INTO txn.ledger_entries(txn_id,account_id,direction,amount_minor) VALUES
      ('00000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','debit',5000),
      ('00000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','credit',5000);
    passed := passed + 1;
  EXCEPTION WHEN OTHERS THEN failed := failed || ('balanced ledger rejected: ' || SQLERRM); END;
  BEGIN
    INSERT INTO txn.ledger_entries(txn_id,account_id,direction,amount_minor) VALUES
      ('00000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','debit',100);
    failed := failed || 'unbalanced ledger accepted';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  BEGIN UPDATE txn.ledger_entries SET amount_minor = 1; failed := failed || 'ledger UPDATE allowed';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;

  -- listing cannot be published without all five costs (zero allowed)
  INSERT INTO identity.organizations(id,name,kind) VALUES ('11111111-1111-1111-1111-111111111111','Org','agency');
  INSERT INTO supply.properties(id,org_id,name,address_text,location)
    VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','P','addr', extensions.st_point(36.8,-1.29)::extensions.geography);
  INSERT INTO supply.units(id,property_id,label,bedrooms) VALUES ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','A1',1);
  INSERT INTO supply.listings(id,unit_id) VALUES ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333');
  BEGIN UPDATE supply.listings SET status='published' WHERE id='44444444-4444-4444-4444-444444444444'; failed := failed || 'published without costs';
  EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  INSERT INTO supply.listing_costs(listing_id,cost_type,amount_minor)
    SELECT '44444444-4444-4444-4444-444444444444', t, 0 FROM unnest(ARRAY['rent','deposit','utility_deposit','service_charge','agent_fee']) t;
  BEGIN UPDATE supply.listings SET status='published' WHERE id='44444444-4444-4444-4444-444444444444'; passed := passed + 1;
  EXCEPTION WHEN OTHERS THEN failed := failed || ('publish with all costs rejected: ' || SQLERRM); END;

  -- data constraints
  BEGIN INSERT INTO identity.users(phone) VALUES ('0712345678'); failed := failed || 'bad phone accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
  BEGIN INSERT INTO verification.badges(subject_type,subject_id,level,expires_at,revoked_at) VALUES ('user',gen_random_uuid(),'id_verified',now(),now());
    failed := failed || 'revoked badge without reason accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;

  -- S1: coordinates must be in Kenya (catches swapped latitude/longitude)
  BEGIN
    INSERT INTO supply.properties(org_id,name,address_text,location)
      VALUES ('11111111-1111-1111-1111-111111111111','Swapped','somewhere', extensions.st_point(-1.29,36.8)::extensions.geography);
    failed := failed || 'swapped coordinates accepted';
  EXCEPTION WHEN check_violation THEN passed := passed + 1; END;

  -- S1: the same building cannot be recorded twice by one organisation (case-insensitive), but can be re-added after archiving
  BEGIN
    INSERT INTO supply.properties(org_id,name,address_text) VALUES ('11111111-1111-1111-1111-111111111111','p','ADDR');
    failed := failed || 'duplicate property accepted';
  EXCEPTION WHEN unique_violation THEN passed := passed + 1; END;
  UPDATE supply.properties SET archived_at = now() WHERE id='22222222-2222-2222-2222-222222222222';
  BEGIN
    INSERT INTO supply.properties(org_id,name,address_text) VALUES ('11111111-1111-1111-1111-111111111111','P','addr');
    passed := passed + 1;
  EXCEPTION WHEN OTHERS THEN failed := failed || ('re-adding after archive rejected: ' || SQLERRM); END;

  -- S1: unit labels are unique per property (case-insensitive) and reusable after archiving
  BEGIN
    INSERT INTO supply.units(property_id,label,bedrooms) VALUES ('22222222-2222-2222-2222-222222222222','a1',1);
    failed := failed || 'duplicate unit label accepted';
  EXCEPTION WHEN unique_violation THEN passed := passed + 1; END;
  UPDATE supply.units SET archived_at = now() WHERE id='33333333-3333-3333-3333-333333333333';
  BEGIN
    INSERT INTO supply.units(property_id,label,bedrooms) VALUES ('22222222-2222-2222-2222-222222222222','A1',2);
    passed := passed + 1;
  EXCEPTION WHEN OTHERS THEN failed := failed || ('unit label reuse after archive rejected: ' || SQLERRM); END;

  -- S2: file rules (kinds, types, sizes, and organisation/unit consistency)
  DECLARE f_pid uuid; f_uid uuid; f_pid2 uuid; f_uid2 uuid; me uuid := '55555555-5555-5555-5555-555555555555';
  BEGIN
    INSERT INTO identity.users(id, phone) VALUES (me, '+254700000099');
    SELECT id INTO f_pid FROM supply.properties WHERE org_id = '11111111-1111-1111-1111-111111111111' AND archived_at IS NULL LIMIT 1;
    INSERT INTO supply.units(property_id,label,bedrooms) VALUES (f_pid,'F1',1) RETURNING id INTO f_uid;
    INSERT INTO supply.properties(org_id,name,address_text) VALUES ('11111111-1111-1111-1111-111111111111','Second','other road') RETURNING id INTO f_pid2;
    INSERT INTO supply.units(property_id,label,bedrooms) VALUES (f_pid2,'G1',1) RETURNING id INTO f_uid2;

    BEGIN INSERT INTO supply.files(id,org_id,property_id,kind,doc_type,storage_path,mime_type,size_bytes,uploaded_by)
      VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111',f_pid,'photo','title_deed','t/1','image/jpeg',1000,me);
      failed := failed || 'photo with a document type accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,uploaded_by)
      VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111',f_pid,'document','t/2','application/pdf',1000,me);
      failed := failed || 'document without a type accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.files(id,org_id,property_id,unit_id,kind,doc_type,storage_path,mime_type,size_bytes,uploaded_by)
      VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111',f_pid,f_uid,'document','title_deed','t/3','application/pdf',1000,me);
      failed := failed || 'unit-level document accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,uploaded_by)
      VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111',f_pid,'photo','t/4','image/jpeg',9000000,me);
      failed := failed || 'oversize photo accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,uploaded_by)
      VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111',f_pid,'photo','t/5','video/mp4',1000,me);
      failed := failed || 'video type accepted as a photo';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.files(id,org_id,property_id,unit_id,kind,storage_path,mime_type,size_bytes,uploaded_by)
      VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111',f_pid,f_uid,'photo','t/6','image/jpeg',500000,me);
      passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid unit photo rejected: ' || SQLERRM); END;
    INSERT INTO identity.organizations(id,name,kind) VALUES ('66666666-6666-6666-6666-666666666666','Other Org','agency');
    BEGIN INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,uploaded_by)
      VALUES (gen_random_uuid(),'66666666-6666-6666-6666-666666666666',f_pid,'photo','t/7','image/jpeg',1000,me);
      failed := failed || 'file filed under the wrong organisation accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.files(id,org_id,property_id,unit_id,kind,storage_path,mime_type,size_bytes,uploaded_by)
      VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111',f_pid,f_uid2,'photo','t/8','image/jpeg',1000,me);
      failed := failed || 'unit from another property accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  END;

  -- S3: import run rules
  BEGIN
    INSERT INTO identity.users(id, phone) VALUES ('77777777-7777-7777-7777-777777777777', '+254700000088');
    BEGIN INSERT INTO supply.import_runs(org_id,created_by,content_sha256,status,row_count,error_count,warning_count,plan,issues)
      VALUES ('11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777','x','weird',1,0,0,'{}','[]');
      failed := failed || 'import run with an invalid status accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.import_runs(org_id,created_by,content_sha256,status,row_count,error_count,warning_count,plan,issues)
      VALUES ('11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777','x','committed',1,0,0,'{}','[]');
      failed := failed || 'committed run without a commit time accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.import_runs(org_id,created_by,content_sha256,status,row_count,error_count,warning_count,plan,issues,committed_at)
      VALUES ('11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777','x','committed',5,2,0,'{}','[]',now());
      failed := failed || 'committed run with errors accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.import_runs(org_id,created_by,content_sha256,row_count,error_count,warning_count,plan,issues)
      VALUES ('11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777','x',5,0,0,'{}','[]');
      passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid planned run rejected: ' || SQLERRM); END;
  END;

  -- S3 follow-up: unit floor rules
  DECLARE fl_pid uuid; BEGIN
    SELECT id INTO fl_pid FROM supply.properties LIMIT 1;
    IF fl_pid IS NULL THEN
      INSERT INTO supply.properties(id,org_id,name,address_text) VALUES (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','Floor Test','Floor Test Rd') RETURNING id INTO fl_pid;
    END IF;
    BEGIN INSERT INTO supply.units(property_id,label,bedrooms,floor) VALUES (fl_pid,'FL1',1,'');
      failed := failed || 'empty floor accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.units(property_id,label,bedrooms,floor) VALUES (fl_pid,'FL2',1,repeat('x',21));
      failed := failed || 'overlong floor accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO supply.units(property_id,label,bedrooms,floor) VALUES (fl_pid,'FL3',1,'Ground'); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid floor rejected: ' || SQLERRM); END;
    BEGIN INSERT INTO supply.units(property_id,label,bedrooms) VALUES (fl_pid,'FL4',1); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('unit without floor rejected: ' || SQLERRM); END;
  END;

  -- S4: review cases
  DECLARE
    org uuid := '11111111-1111-1111-1111-111111111111'; prop uuid := '22222222-2222-2222-2222-222222222222';
    sub uuid := '81111111-1111-1111-1111-111111111111'; rev1 uuid := '82222222-2222-2222-2222-222222222222';
    rev2 uuid := '83333333-3333-3333-3333-333333333333'; insider uuid := '84444444-4444-4444-4444-444444444444';
    doc uuid := '85555555-5555-5555-5555-555555555555'; pending_doc uuid := '86666666-6666-6666-6666-666666666666';
    c1 uuid := '91111111-1111-1111-1111-111111111111'; c2 uuid := '92222222-2222-2222-2222-222222222222'; c3 uuid := '93333333-3333-3333-3333-333333333333';
    c4 uuid := '94444444-4444-4444-4444-444444444444'; badge uuid;
  BEGIN
    INSERT INTO identity.users(id, phone) VALUES (sub,'+254700000071'),(rev1,'+254700000072'),(rev2,'+254700000073'),(insider,'+254700000074');
    INSERT INTO identity.memberships(user_id, org_id, role) VALUES (sub, org, 'manager_admin'), (insider, org, 'manager_staff');
    INSERT INTO identity.platform_roles(user_id, role) VALUES (rev1,'reviewer'),(rev2,'reviewer'),(insider,'reviewer');
    INSERT INTO supply.files(id,org_id,property_id,kind,doc_type,storage_path,mime_type,size_bytes,status,uploaded_by,ready_at)
      VALUES (doc,org,prop,'document','title_deed','s4/doc','application/pdf',1000,'ready',sub,now());
    INSERT INTO supply.files(id,org_id,property_id,kind,doc_type,storage_path,mime_type,size_bytes,status,uploaded_by)
      VALUES (pending_doc,org,prop,'document','title_deed','s4/pending','application/pdf',1000,'pending',sub);

    BEGIN INSERT INTO verification.cases(id,org_id,property_id,submitted_by,due_at) VALUES (c1,org,prop,sub,now()+interval '2 days'); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid case rejected: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.cases(org_id,property_id,submitted_by,due_at) VALUES (org,prop,sub,now()+interval '2 days');
      failed := failed || 'second open case accepted';
    EXCEPTION WHEN unique_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.case_files(case_id,file_id) VALUES (c1,doc); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('ready document rejected: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.case_files(case_id,file_id) VALUES (c1,pending_doc); failed := failed || 'pending document attached';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='in_review', claimed_by=insider, claimed_at=now() WHERE id=c1; failed := failed || 'reviewer from the same organisation could claim';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='in_review', claimed_by=sub, claimed_at=now() WHERE id=c1; failed := failed || 'non-reviewer could claim';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='in_review', claimed_by=rev1, claimed_at=now() WHERE id=c1; passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid claim rejected: ' || SQLERRM); END;
    BEGIN UPDATE supply.files SET status='deleted', deleted_at=now() WHERE id=doc; failed := failed || 'evidence of an open case could be deleted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='rejected', decided_by=rev1, decided_at=now() WHERE id=c1; failed := failed || 'rejection without a reason accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='rejected', decided_by=rev1, decided_at=now(), reason_code='other' WHERE id=c1; failed := failed || '"other" without a note accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='approved', decided_by=rev1, decided_at=now() WHERE id=c1; failed := failed || 'approval without a badge accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='rejected', decided_by=rev1, decided_at=now(), reason_code='doc_expired' WHERE id=c1; passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid rejection failed: ' || SQLERRM); END;
    BEGIN UPDATE verification.cases SET status='in_review', decided_at=NULL WHERE id=c1; failed := failed || 'decided case reopened';
    EXCEPTION WHEN OTHERS THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET reason_code='suspected_forgery' WHERE id=c1; failed := failed || 'decided case changed';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.cases(id,org_id,property_id,submitted_by,due_at,appeal_of) VALUES (c2,org,prop,sub,now()+interval '2 days',c1); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid appeal rejected: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.cases(org_id,property_id,submitted_by,due_at,appeal_of) VALUES (org,prop,sub,now()+interval '2 days',c1); failed := failed || 'second appeal accepted';
    EXCEPTION WHEN unique_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='rejected', decided_by=rev1, decided_at=now(), reason_code='doc_expired' WHERE id=c2; failed := failed || 'appeal decided by the same reviewer';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='rejected', decided_by=rev2, decided_at=now(), reason_code='doc_expired' WHERE id=c2; passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('appeal by another reviewer failed: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.cases(org_id,property_id,submitted_by,due_at,appeal_of) VALUES (org,prop,sub,now()+interval '2 days',c2); failed := failed || 'appeal of an appeal accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',prop,'t1_documented',rev1,now(),now()); failed := failed || 'badge with no lifetime accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    -- a later, fresh case can be approved with a badge, and its evidence stays frozen
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',prop,'t1_documented',rev1,now(),now()+interval '12 months') RETURNING id INTO badge;
    BEGIN INSERT INTO verification.cases(id,org_id,property_id,status,submitted_by,due_at,claimed_by,decided_by,decided_at,badge_id)
      VALUES (c3,org,prop,'approved',sub,now()+interval '2 days',rev1,rev1,now(),badge); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid approval failed: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.case_files(case_id,file_id) VALUES (c3,doc); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('attach to approved case failed: ' || SQLERRM); END;
    BEGIN UPDATE supply.files SET status='deleted', deleted_at=now() WHERE id=doc; failed := failed || 'evidence of an approved case could be deleted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    -- revoking a badge: reason code mandatory, "other" needs a note, and a revoked badge stays revoked
    BEGIN UPDATE verification.badges SET revoked_at=now() WHERE id=badge; failed := failed || 'revoke without a reason accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.badges SET revoked_at=now(), revoke_reason_code='other' WHERE id=badge; failed := failed || 'revoke "other" without a note accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.badges SET revoked_at=now(), revoke_reason_code='suspected_forgery', revoke_note='Seal copied from another deed' WHERE id=badge; passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid revoke failed: ' || SQLERRM); END;
    BEGIN UPDATE verification.badges SET revoked_at=NULL WHERE id=badge; failed := failed || 'revoked badge brought back';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.badges SET expires_at=now()+interval '5 years' WHERE id=badge; failed := failed || 'revoked badge extended';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
  END;

  -- ===== S5a: T2 video and location =====
  DECLARE
    org uuid := '11111111-1111-1111-1111-111111111111';
    sub uuid := '81111111-1111-1111-1111-111111111111'; rev1 uuid := '82222222-2222-2222-2222-222222222222';
    rev2 uuid := '83333333-3333-3333-3333-333333333333'; insider uuid := '84444444-4444-4444-4444-444444444444';
    pa uuid := 'e1000000-0000-0000-0000-00000000000a'; pb uuid := 'e1000000-0000-0000-0000-00000000000b'; pc uuid := 'e1000000-0000-0000-0000-00000000000c';
    pd uuid := 'e1000000-0000-0000-0000-00000000000d'; pe uuid := 'e1000000-0000-0000-0000-00000000000e'; pf uuid := 'e1000000-0000-0000-0000-00000000000f';
    pg uuid := 'e1000000-0000-0000-0000-000000000010';
    ua uuid := 'e2000000-0000-0000-0000-00000000000a'; ub uuid := 'e2000000-0000-0000-0000-00000000000b'; ug uuid := 'e2000000-0000-0000-0000-000000000010';
    ua2 uuid := 'e2000000-0000-0000-0000-0000000000aa'; uc1 uuid; uc2 uuid; u_other uuid := 'e2000000-0000-0000-0000-0000000000ff';
    cha uuid := 'e3000000-0000-0000-0000-00000000000a'; chb1 uuid := 'e3000000-0000-0000-0000-0000000000b1'; chb2 uuid := 'e3000000-0000-0000-0000-0000000000b2';
    chg uuid := 'e3000000-0000-0000-0000-0000000000c1'; chg2 uuid := 'e3000000-0000-0000-0000-0000000000c2'; chg3 uuid := 'e3000000-0000-0000-0000-0000000000c3';
    ca uuid := 'e4000000-0000-0000-0000-00000000000a'; cb uuid := 'e4000000-0000-0000-0000-00000000000b'; cg uuid := 'e4000000-0000-0000-0000-000000000010';
    cf uuid := 'e4000000-0000-0000-0000-00000000000f'; cb_appeal uuid := 'e4000000-0000-0000-0000-0000000000b2';
    va uuid := 'e5000000-0000-0000-0000-00000000000a'; vb1 uuid := 'e5000000-0000-0000-0000-0000000000b1'; vb2 uuid := 'e5000000-0000-0000-0000-0000000000b2';
    vg_doc uuid := 'e5000000-0000-0000-0000-0000000000d0'; vg_pend uuid := 'e5000000-0000-0000-0000-0000000000d1'; vg_ok uuid := 'e5000000-0000-0000-0000-0000000000d2';
    vg_other uuid := 'e5000000-0000-0000-0000-0000000000d3'; vg_early uuid := 'e5000000-0000-0000-0000-0000000000d4';
    t1a uuid; t1b uuid; t1d uuid; t1f uuid; t1g uuid; t1c uuid; t2a uuid; wrong uuid; sha bytea := decode(repeat('ab', 32), 'hex'); sha2 bytea := decode(repeat('cd', 32), 'hex');
    all_yes jsonb := '{"code_heard":true,"place_matches_address":true,"units_shown":true,"footage_continuous":true,"location_close":true,"matches_documents":true}';
    one_no jsonb := '{"code_heard":true,"place_matches_address":true,"units_shown":false,"footage_continuous":true,"location_close":true,"matches_documents":true}';
  BEGIN
    -- properties: A main flow, B needs-changes and appeal, C many units, D no position, E no T1, F a T1 case, G time-window checks
    INSERT INTO supply.properties(id,org_id,name,address_text,location) VALUES
      (pa,org,'S5 A','a', extensions.st_point(36.80,-1.29)::extensions.geography), (pb,org,'S5 B','b', extensions.st_point(36.81,-1.30)::extensions.geography),
      (pc,org,'S5 C','c', extensions.st_point(36.82,-1.31)::extensions.geography), (pd,org,'S5 D','d', NULL),
      (pe,org,'S5 E','e', extensions.st_point(36.83,-1.32)::extensions.geography), (pf,org,'S5 F','f', extensions.st_point(36.84,-1.33)::extensions.geography),
      (pg,org,'S5 G','g', extensions.st_point(36.85,-1.34)::extensions.geography);
    INSERT INTO supply.units(id,property_id,label,bedrooms) VALUES (ua,pa,'A1',1),(ua2,pa,'A2',1),(ub,pb,'B1',1),(ug,pg,'G1',1),(u_other,pd,'D1',1);
    UPDATE supply.units SET archived_at = now() WHERE id = ua2;
    FOR i IN 1..11 LOOP INSERT INTO supply.units(property_id,label,bedrooms) VALUES (pc,'C'||i,1); END LOOP;
    SELECT min(id::text)::uuid, max(id::text)::uuid INTO uc1, uc2 FROM supply.units WHERE property_id = pc;

    -- a challenge needs a valid T1, a recorded position, a member, and the right units
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pa,sub,'4821',ARRAY[ua],now(),now()+interval '30 minutes');
      failed := failed || 'challenge without T1 accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pa,'t1_documented',rev1,now(),now()+interval '12 months') RETURNING id INTO t1a;
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pb,'t1_documented',rev1,now(),now()+interval '12 months') RETURNING id INTO t1b;
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pc,'t1_documented',rev1,now(),now()+interval '12 months');
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pd,'t1_documented',rev1,now(),now()+interval '12 months');
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pf,'t1_documented',rev1,now(),now()+interval '12 months');
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pg,'t1_documented',rev1,now(),now()+interval '12 months');
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pe,'t1_documented',rev1,now()-interval '2 days',now()-interval '1 day');   -- expired
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pc,sub,'4821',ARRAY[]::uuid[],now(),now()+interval '30 minutes');
      failed := failed || 'challenge with no units accepted';
    EXCEPTION WHEN raise_exception OR check_violation THEN passed := passed + 1; END;
    INSERT INTO supply.units(id,property_id,label,bedrooms) VALUES ('e2000000-0000-0000-0000-0000000000ee',pe,'E1',1);
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pe,sub,'4821',ARRAY['e2000000-0000-0000-0000-0000000000ee'::uuid],now(),now()+interval '30 minutes');
      failed := failed || 'challenge with an expired T1 accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.cases(org_id,property_id,tier,submitted_by,due_at) VALUES (org,pe,'t2',sub,now()+interval '3 days'); failed := failed || 'T2 case without a valid T1 accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pd,sub,'4821',ARRAY[u_other],now(),now()+interval '30 minutes');
      failed := failed || 'challenge for a property with no position accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pa,rev1,'4821',ARRAY[ua],now(),now()+interval '30 minutes');
      failed := failed || 'challenge requested by a non-member accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pa,sub,'4821',ARRAY[ua,ua2],now(),now()+interval '30 minutes');
      failed := failed || 'two units for a small property accepted';
    EXCEPTION WHEN raise_exception OR check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pa,sub,'4821',ARRAY[ua2],now(),now()+interval '30 minutes');
      failed := failed || 'an archived unit accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pa,sub,'4821',ARRAY[ub],now(),now()+interval '30 minutes');
      failed := failed || 'a unit of another property accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pa,sub,'48x1',ARRAY[ua],now(),now()+interval '30 minutes');
      failed := failed || 'a non-numeric code accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pa,sub,'4821',ARRAY[ua],now(),now()+interval '31 minutes');
      failed := failed || 'a window over 30 minutes accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    -- a property with 11 units needs two different units shown
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pc,sub,'1111',ARRAY[uc1],now(),now()+interval '30 minutes');
      failed := failed || 'one unit for a large property accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pc,sub,'1111',ARRAY[uc1,uc1],now(),now()+interval '30 minutes');
      failed := failed || 'the same unit twice accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pc,sub,'1111',ARRAY[uc1,uc2],now(),now()+interval '30 minutes'); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('two units for a large property rejected: ' || SQLERRM); END;

    -- the main flow on property A
    BEGIN INSERT INTO verification.t2_challenges(id,org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (cha,org,pa,sub,'4821',ARRAY[ua],now(),now()+interval '30 minutes'); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid challenge rejected: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pa,sub,'9999',ARRAY[ua],now(),now()+interval '30 minutes');
      failed := failed || 'a second active challenge accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.t2_challenges SET code='0000' WHERE id=cha; failed := failed || 'challenge code edited';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.t2_challenges SET expires_at = expires_at + interval '1 minute' WHERE id=cha; failed := failed || 'challenge extended';
    EXCEPTION WHEN raise_exception OR check_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.t2_challenges SET takes = 4 WHERE id=cha; failed := failed || 'a fourth take accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.t2_challenges SET takes = 2 WHERE id=cha; UPDATE verification.t2_challenges SET takes = 1 WHERE id=cha; failed := failed || 'takes counted down';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.cases(id,org_id,property_id,tier,submitted_by,due_at) VALUES (ca,org,pa,'t2',sub,now()+interval '3 days'); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid T2 case rejected: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.cases(org_id,property_id,tier,submitted_by,due_at) VALUES (org,pf,'t3',sub,now()+interval '3 days'); failed := failed || 'unknown tier accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;

    -- evidence rules, using property G with challenges that are already in the past
    INSERT INTO verification.t2_challenges(id,org_id,property_id,requested_by,code,unit_ids,consent_at,issued_at,expires_at) VALUES
      (chg,org,pg,sub,'1234',ARRAY[ug],now()-interval '60 minutes',now()-interval '60 minutes',now()-interval '30 minutes');          -- long expired
    INSERT INTO verification.t2_challenges(id,org_id,property_id,requested_by,code,unit_ids,consent_at,issued_at,expires_at) VALUES
      (chg2,org,pg,sub,'2345',ARRAY[ug],now()-interval '20 minutes',now()-interval '20 minutes',now()-interval '1 minute');
    INSERT INTO verification.t2_challenges(id,org_id,property_id,requested_by,code,unit_ids,consent_at,issued_at,expires_at) VALUES
      (chg3,org,pg,sub,'3456',ARRAY[ug],now(),now()+interval '5 minutes',now()+interval '30 minutes');
    INSERT INTO verification.cases(id,org_id,property_id,tier,submitted_by,due_at) VALUES (cg,org,pg,'t2',sub,now()+interval '3 days');
    INSERT INTO supply.files(id,org_id,property_id,kind,doc_type,storage_path,mime_type,size_bytes,status,uploaded_by,ready_at) VALUES (vg_doc,org,pg,'document','title_deed','s5/doc','application/pdf',1000,'ready',sub,now());
    INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,status,uploaded_by) VALUES (vg_pend,org,pg,'video','s5/pend','video/mp4',1000,'pending',sub);
    INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,status,uploaded_by,ready_at) VALUES (vg_ok,org,pg,'video','s5/ok','video/mp4',1000,'ready',sub,now());
    INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,status,uploaded_by,ready_at) VALUES (vg_other,org,pg,'video','s5/other','video/mp4',1000,'ready',insider,now());
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg,vg_ok,sha,-1.34,36.85,12,now()-interval '40 minutes',-1.34,36.85,12,now()-interval '39 minutes'); failed := failed || 'upload long after expiry accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg2,vg_ok,sha,-1.34,36.85,12,now()-interval '25 minutes',-1.34,36.85,12,now()-interval '24 minutes'); failed := failed || 'recording that started before the challenge accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg2,vg_doc,sha,-1.34,36.85,12,now()-interval '10 minutes',-1.34,36.85,12,now()-interval '9 minutes'); failed := failed || 'a document accepted as video evidence';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg2,vg_pend,sha,-1.34,36.85,12,now()-interval '10 minutes',-1.34,36.85,12,now()-interval '9 minutes'); failed := failed || 'an unfinished upload accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg2,vg_other,sha,-1.34,36.85,12,now()-interval '10 minutes',-1.34,36.85,12,now()-interval '9 minutes'); failed := failed || 'a video from someone else accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg2,vg_ok,sha,-1.34,36.85,12,now()-interval '10 minutes',-1.34,36.85,12,now()-interval '11 minutes'); failed := failed || 'readings in the wrong order accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg2,vg_ok,sha,51.5,-0.12,12,now()-interval '10 minutes',51.5,-0.12,12,now()-interval '9 minutes'); failed := failed || 'readings outside Kenya accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg2,vg_ok,decode('abcd','hex'),-1.34,36.85,12,now()-interval '10 minutes',-1.34,36.85,12,now()-interval '9 minutes'); failed := failed || 'a short fingerprint accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,2,chg2,vg_ok,sha,-1.34,36.85,12,now()-interval '10 minutes',-1.34,36.85,12,now()-interval '9 minutes'); failed := failed || 'attempt numbering skipped';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    -- a video uploaded before the challenge was issued is not live evidence
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cg,1,chg3,vg_ok,sha,-1.34,36.85,12,now()+interval '6 minutes',-1.34,36.85,12,now()+interval '7 minutes'); failed := failed || 'a video older than the challenge accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;

    -- valid evidence on property A, then it is locked down
    INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,status,uploaded_by,ready_at) VALUES (va,org,pa,'video','s5/va','video/mp4',1000,'ready',sub,now());
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at,hints)
      VALUES (ca,1,cha,va,sha,-1.2901,36.8001,9,now(),-1.2902,36.8002,11,now()+interval '1 minute','{"distance_m":20}'); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid evidence rejected: ' || SQLERRM); END;
    IF (SELECT used_at FROM verification.t2_challenges WHERE id=cha) IS NOT NULL THEN passed := passed + 1; ELSE failed := failed || 'challenge not marked used'; END IF;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (ca,2,cha,va,sha2,-1.29,36.80,9,now(),-1.29,36.80,9,now()+interval '1 minute'); failed := failed || 'a used challenge accepted again';
    EXCEPTION WHEN raise_exception OR unique_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.t2_evidence SET start_lat = -1.0 WHERE case_id=ca; failed := failed || 'evidence edited';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN DELETE FROM verification.t2_evidence WHERE case_id=ca; failed := failed || 'evidence deleted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE supply.files SET status='deleted', deleted_at=now() WHERE id=va; failed := failed || 'video of an open case deleted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE supply.properties SET location = extensions.st_point(36.90,-1.40)::extensions.geography WHERE id=pa; failed := failed || 'position moved during an open T2 case';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE supply.properties SET location = extensions.st_point(36.80,-1.29)::extensions.geography, address_text='a2' WHERE id=pa; passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('an unchanged position blocked an ordinary edit: ' || SQLERRM); END;

    -- review and decision on property A
    UPDATE verification.cases SET status='in_review', claimed_by=rev1, claimed_at=now() WHERE id=ca;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (ca,2,chg3,va,sha2,-1.29,36.80,9,now(),-1.29,36.80,9,now()+interval '1 minute'); failed := failed || 'evidence added during review';
    EXCEPTION WHEN raise_exception OR unique_violation THEN passed := passed + 1; END;
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pa,'t2_video',rev1,now(),now()+interval '6 months') RETURNING id INTO t2a;
    BEGIN UPDATE verification.cases SET status='approved', decided_by=rev1, decided_at=now(), badge_id=t2a WHERE id=ca; failed := failed || 'T2 approval without a checklist accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='approved', decided_by=rev1, decided_at=now(), badge_id=t2a, t2_checklist=one_no WHERE id=ca; failed := failed || 'T2 approval with a "no" accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='approved', decided_by=rev1, decided_at=now(), badge_id=t1a, t2_checklist=all_yes WHERE id=ca; failed := failed || 'a T1 badge accepted for a T2 case';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET t2_checklist='[1,2]'::jsonb WHERE id=ca; failed := failed || 'a checklist that is not an object accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='rejected', decided_by=rev1, decided_at=now(), reason_code='t2_location_mismatch', note='x', tier='t1' WHERE id=ca; failed := failed || 'tier changed';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN UPDATE verification.cases SET status='approved', decided_by=rev1, decided_at=now(), badge_id=t2a, t2_checklist=all_yes WHERE id=ca; passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('valid T2 approval failed: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pa,'t2_video',rev1,now(),now()+interval '2 years'); failed := failed || 'a T2 badge over six months accepted';
    EXCEPTION WHEN check_violation THEN passed := passed + 1; END;
    -- video retention: kept for the retention period after the decision, deletable afterwards
    BEGIN UPDATE supply.files SET status='deleted', deleted_at=now() WHERE id=va; failed := failed || 'video deleted inside the retention period';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    UPDATE verification.cases SET decided_at = now() - interval '91 days', submitted_at = now() - interval '95 days', due_at = now() - interval '90 days' WHERE id=ca;
    BEGIN UPDATE supply.files SET status='deleted', deleted_at=now() WHERE id=va; passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('video not deletable after retention: ' || SQLERRM); END;
    BEGIN UPDATE supply.properties SET location = extensions.st_point(36.90,-1.40)::extensions.geography WHERE id=pa; passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('position stayed locked after the case closed: ' || SQLERRM); END;

    -- T2 reason codes only on T2 cases
    INSERT INTO verification.cases(id,org_id,property_id,tier,submitted_by,due_at) VALUES (cf,org,pf,'t1',sub,now()+interval '2 days');
    UPDATE verification.cases SET status='in_review', claimed_by=rev1, claimed_at=now() WHERE id=cf;
    BEGIN UPDATE verification.cases SET status='rejected', decided_by=rev1, decided_at=now(), reason_code='t2_video_unusable' WHERE id=cf; failed := failed || 'T2 reason on a T1 case accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;

    -- needs-changes round, T1 lapsing, rejection and appeal on property B
    INSERT INTO verification.t2_challenges(id,org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (chb1,org,pb,sub,'5555',ARRAY[ub],now(),now()+interval '30 minutes');
    INSERT INTO verification.cases(id,org_id,property_id,tier,submitted_by,due_at) VALUES (cb,org,pb,'t2',sub,now()+interval '3 days');
    INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,status,uploaded_by,ready_at) VALUES (vb1,org,pb,'video','s5/vb1','video/mp4',1000,'ready',sub,now());
    INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cb,1,chb1,vb1,sha,-1.30,36.81,10,now(),-1.30,36.81,10,now()+interval '1 minute');
    UPDATE verification.cases SET status='in_review', claimed_by=rev1, claimed_at=now() WHERE id=cb;
    BEGIN INSERT INTO verification.t2_challenges(org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (org,pb,sub,'6666',ARRAY[ub],now(),now()+interval '30 minutes');
      failed := failed || 'challenge accepted while the case is in review';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    UPDATE verification.cases SET status='needs_changes', paused_at=now(), reason_code='t2_video_unusable', claimed_by=NULL, claimed_at=NULL WHERE id=cb;
    BEGIN INSERT INTO verification.t2_challenges(id,org_id,property_id,requested_by,code,unit_ids,consent_at,expires_at) VALUES (chb2,org,pb,sub,'6666',ARRAY[ub],now(),now()+interval '30 minutes'); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('new challenge after needs-changes rejected: ' || SQLERRM); END;
    INSERT INTO supply.files(id,org_id,property_id,kind,storage_path,mime_type,size_bytes,status,uploaded_by,ready_at) VALUES (vb2,org,pb,'video','s5/vb2','video/mp4',1000,'ready',sub,now());
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cb,2,chb2,vb2,sha2,-1.30,36.81,10,now(),-1.30,36.81,10,now()+interval '1 minute'); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('second attempt rejected: ' || SQLERRM); END;
    BEGIN UPDATE supply.files SET status='deleted', deleted_at=now() WHERE id=vb1; failed := failed || 'earlier attempt video deleted while the case is open';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    UPDATE verification.cases SET status='in_review', claimed_by=rev1, claimed_at=now(), paused_at=NULL, reason_code=NULL WHERE id=cb;
    UPDATE verification.badges SET revoked_at=now(), revoke_reason_code='other', revoke_note='lapsed for the test' WHERE id=t1b;
    INSERT INTO verification.badges(subject_type,subject_id,level,verified_by,issued_at,expires_at) VALUES ('property',pb,'t2_video',rev1,now(),now()+interval '6 months') RETURNING id INTO wrong;
    BEGIN UPDATE verification.cases SET status='approved', decided_by=rev1, decided_at=now(), badge_id=wrong, t2_checklist=all_yes WHERE id=cb; failed := failed || 'T2 approved after T1 was revoked';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    UPDATE verification.cases SET status='rejected', decided_by=rev1, decided_at=now(), reason_code='t2_location_mismatch', t2_checklist=one_no WHERE id=cb;
    BEGIN INSERT INTO verification.cases(org_id,property_id,tier,submitted_by,due_at,appeal_of) VALUES (org,pb,'t1',sub,now()+interval '3 days',cb); failed := failed || 'a T1 appeal of a T2 rejection accepted';
    EXCEPTION WHEN raise_exception THEN passed := passed + 1; END;
    BEGIN INSERT INTO verification.cases(id,org_id,property_id,tier,submitted_by,due_at,appeal_of) VALUES (cb_appeal,org,pb,'t2',sub,now()+interval '3 days',cb); passed := passed + 1;
    EXCEPTION WHEN OTHERS THEN failed := failed || ('T2 appeal rejected: ' || SQLERRM); END;
    BEGIN INSERT INTO verification.t2_evidence(case_id,attempt,challenge_id,video_file_id,video_sha256,start_lat,start_lon,start_accuracy_m,start_at,end_lat,end_lon,end_accuracy_m,end_at)
      VALUES (cb_appeal,1,chb2,vb2,sha2,-1.30,36.81,10,now(),-1.30,36.81,10,now()+interval '1 minute'); failed := failed || 'evidence attached to an appeal';
    EXCEPTION WHEN raise_exception OR unique_violation THEN passed := passed + 1; END;
  END;

  RAISE EXCEPTION 'RULES: % passed, % failed %', passed, cardinality(failed), failed;
END $$;
