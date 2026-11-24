-- 0022: indexes for foreign keys that had none (Supabase performance advisor, 'unindexed foreign keys').
-- Speeds up joins and parent-row deletes as tables grow. No data or behaviour changes. Safe to run twice.
-- Plain CREATE INDEX (not CONCURRENTLY): the tables are small today and migrations run in a transaction.

create index if not exists consents_grantee_org_id_fk_idx on governance.consents (grantee_org_id);
create index if not exists consents_grantee_user_id_fk_idx on governance.consents (grantee_user_id);
create index if not exists consents_grantor_id_fk_idx on governance.consents (grantor_id);
create index if not exists data_access_log_consent_id_fk_idx on governance.data_access_log (consent_id);
create index if not exists data_requests_handled_by_fk_idx on governance.data_requests (handled_by);
create index if not exists invitations_invited_by_fk_idx on identity.invitations (invited_by);
create index if not exists memberships_org_id_fk_idx on identity.memberships (org_id);
create index if not exists refresh_tokens_replaced_by_fk_idx on identity.refresh_tokens (replaced_by);
create index if not exists verification_sessions_decided_by_fk_idx on identity.verification_sessions (decided_by);
create index if not exists verification_sessions_reason_code_fk_idx on identity.verification_sessions (reason_code);
create index if not exists files_doc_type_fk_idx on supply.files (doc_type);
create index if not exists files_org_id_fk_idx on supply.files (org_id);
create index if not exists files_uploaded_by_fk_idx on supply.files (uploaded_by);
create index if not exists import_runs_committed_by_fk_idx on supply.import_runs (committed_by);
create index if not exists import_runs_created_by_fk_idx on supply.import_runs (created_by);
create index if not exists listings_unit_id_fk_idx on supply.listings (unit_id);
create index if not exists properties_import_run_id_fk_idx on supply.properties (import_run_id);
create index if not exists properties_node_id_fk_idx on supply.properties (node_id);
create index if not exists units_import_run_id_fk_idx on supply.units (import_run_id);
create index if not exists ledger_entries_account_id_fk_idx on txn.ledger_entries (account_id);
create index if not exists ledger_entries_reverses_entry_id_fk_idx on txn.ledger_entries (reverses_entry_id);
create index if not exists payment_requests_payer_id_fk_idx on txn.payment_requests (payer_id);
create index if not exists badges_verified_by_fk_idx on verification.badges (verified_by);
create index if not exists case_files_file_id_fk_idx on verification.case_files (file_id);
create index if not exists cases_badge_id_fk_idx on verification.cases (badge_id);
create index if not exists cases_claimed_by_fk_idx on verification.cases (claimed_by);
create index if not exists cases_decided_by_fk_idx on verification.cases (decided_by);
create index if not exists cases_reason_code_fk_idx on verification.cases (reason_code);
create index if not exists cases_submitted_by_fk_idx on verification.cases (submitted_by);
create index if not exists cost_inputs_created_by_fk_idx on verification.cost_inputs (created_by);
create index if not exists integrity_alerts_handled_by_fk_idx on verification.integrity_alerts (handled_by);
create index if not exists integrity_rules_updated_by_fk_idx on verification.integrity_rules (updated_by);
create index if not exists second_looks_second_reviewer_id_fk_idx on verification.second_looks (second_reviewer_id);
create index if not exists t2_challenges_org_id_fk_idx on verification.t2_challenges (org_id);
create index if not exists t2_challenges_requested_by_fk_idx on verification.t2_challenges (requested_by);
