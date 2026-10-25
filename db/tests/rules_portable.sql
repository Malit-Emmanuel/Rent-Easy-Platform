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

  RAISE EXCEPTION 'RULES: % passed, % failed %', passed, cardinality(failed), failed;
END $$;
