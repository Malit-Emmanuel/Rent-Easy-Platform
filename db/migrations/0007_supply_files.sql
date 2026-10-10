-- B3 slice S2: documents, photos and videos for properties and units. Metadata lives here; the bytes live in a PRIVATE storage bucket.

-- PLACEHOLDER document types. The real list comes from the advocate (decision 5); change it with a data update, not code.
CREATE TABLE supply.document_types (code text PRIMARY KEY, description text NOT NULL);
INSERT INTO supply.document_types VALUES
  ('title_deed','Title deed or title search'),
  ('lease_agreement','Lease or head lease'),
  ('management_authorisation','Letter authorising the manager or agent'),
  ('other','Other supporting document');

CREATE TABLE supply.files (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES identity.organizations(id),
  property_id uuid NOT NULL REFERENCES supply.properties(id),
  unit_id uuid REFERENCES supply.units(id),
  kind text NOT NULL CHECK (kind IN ('document','photo','video')),
  doc_type text REFERENCES supply.document_types(code),
  storage_path text NOT NULL UNIQUE,
  original_name text,                               -- display only, never used to build paths
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','rejected','deleted')),
  reject_reason text,
  uploaded_by uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  CHECK ((kind = 'document') = (doc_type IS NOT NULL)),                       -- documents need a type, others must not have one
  CHECK (kind <> 'document' OR unit_id IS NULL),                              -- documents belong to the property
  CHECK (size_bytes <= CASE kind WHEN 'document' THEN 10485760 WHEN 'photo' THEN 8388608 ELSE 47185920 END),
  CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm')),
  CHECK ((kind = 'document' AND mime_type IN ('application/pdf','image/jpeg','image/png'))
      OR (kind = 'photo'    AND mime_type IN ('image/jpeg','image/png','image/webp'))
      OR (kind = 'video'    AND mime_type IN ('video/mp4','video/quicktime','video/webm')))
);
CREATE INDEX files_property_idx ON supply.files (property_id, status);
CREATE INDEX files_unit_idx ON supply.files (unit_id) WHERE unit_id IS NOT NULL;

-- Defence in depth: a file's organisation must be the property's organisation, and its unit must belong to that property.
CREATE OR REPLACE FUNCTION supply.files_consistency() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supply.properties p WHERE p.id = NEW.property_id AND p.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'file organisation does not match the property organisation';
  END IF;
  IF NEW.unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM supply.units u WHERE u.id = NEW.unit_id AND u.property_id = NEW.property_id) THEN
    RAISE EXCEPTION 'file unit does not belong to the property';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public;
CREATE TRIGGER files_consistency_trg BEFORE INSERT OR UPDATE OF org_id, property_id, unit_id ON supply.files
  FOR EACH ROW EXECUTE FUNCTION supply.files_consistency();

-- Same lock-down as every other table: row security on, no policies, no access for Supabase's API roles.
ALTER TABLE supply.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply.document_types ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON supply.files, supply.document_types FROM anon, authenticated';
  END IF;
END $$;

-- The private bucket (Supabase only; skipped on plain Postgres such as local development and CI).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('property-files', 'property-files', false, 47185920,
            ARRAY['application/pdf','image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
