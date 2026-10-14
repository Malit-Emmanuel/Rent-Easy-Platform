-- B3 slice S3: bulk import of units from a spreadsheet.
-- A "run" stores the validated plan on the server. Confirming an import applies THAT plan, never data sent by the browser.
CREATE TABLE supply.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES identity.organizations(id),
  created_by uuid NOT NULL REFERENCES identity.users(id),
  file_name text,                                   -- display only
  content_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','committed')),
  row_count int NOT NULL CHECK (row_count >= 0),
  error_count int NOT NULL CHECK (error_count >= 0),
  warning_count int NOT NULL CHECK (warning_count >= 0),
  new_properties int NOT NULL DEFAULT 0 CHECK (new_properties >= 0),
  new_units int NOT NULL DEFAULT 0 CHECK (new_units >= 0),
  plan jsonb NOT NULL,                              -- properties and units that would be created or already exist
  issues jsonb NOT NULL,                            -- row-level errors and warnings (capped)
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  committed_by uuid REFERENCES identity.users(id),
  result jsonb,
  CHECK ((status = 'committed') = (committed_at IS NOT NULL)),
  CHECK (status <> 'committed' OR error_count = 0)  -- an import with errors can never be committed
);
CREATE INDEX import_runs_org_idx ON supply.import_runs (org_id, created_at DESC);

-- Every property and unit created by an import points back at its run, so any import can be traced and reviewed.
ALTER TABLE supply.properties ADD COLUMN import_run_id uuid REFERENCES supply.import_runs(id);
ALTER TABLE supply.units      ADD COLUMN import_run_id uuid REFERENCES supply.import_runs(id);

ALTER TABLE supply.import_runs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON supply.import_runs FROM anon, authenticated';
  END IF;
END $$;
