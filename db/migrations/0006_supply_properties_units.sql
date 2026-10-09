-- B3 slice S1: properties and units.
-- Soft archive instead of delete; duplicate protection inside one organisation; Kenya-only coordinates; placeholder nodes.

ALTER TABLE supply.properties ADD COLUMN archived_at timestamptz;
ALTER TABLE supply.units      ADD COLUMN archived_at timestamptz;

-- The same building cannot be recorded twice by one organisation (while active).
CREATE UNIQUE INDEX properties_org_name_address_uq
  ON supply.properties (org_id, lower(name), lower(address_text)) WHERE archived_at IS NULL;
CREATE INDEX properties_org_idx ON supply.properties (org_id) WHERE archived_at IS NULL;
CREATE INDEX units_property_idx ON supply.units (property_id) WHERE archived_at IS NULL;

-- A unit label is unique within a property, case-insensitively, and can be reused after the unit is archived.
ALTER TABLE supply.units DROP CONSTRAINT units_property_id_label_key;
CREATE UNIQUE INDEX units_property_label_uq ON supply.units (property_id, lower(label)) WHERE archived_at IS NULL;

-- Catches swapped latitude/longitude and other typing mistakes at the database level.
ALTER TABLE supply.properties ADD CONSTRAINT properties_location_in_kenya CHECK (
  location IS NULL OR (
    extensions.st_y(location::extensions.geometry) BETWEEN -5.1 AND 5.6 AND
    extensions.st_x(location::extensions.geometry) BETWEEN 33.5 AND 42.0));

-- PLACEHOLDER pilot nodes. The real nodes are chosen with the pilot managers (gate G3); rename or replace then.
INSERT INTO supply.nodes (name) VALUES ('Kilimani'), ('Kileleshwa'), ('Westlands'), ('Lavington') ON CONFLICT DO NOTHING;
