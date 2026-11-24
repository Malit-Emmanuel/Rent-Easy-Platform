-- S19: listings. A unit has at most one open listing (draft, published or stale) at a time,
-- and a published or stale listing always carries the dates the 14-day / 21-day rule depends on.
-- (supply.listings is empty when this runs; the checks apply to every future row.)
CREATE UNIQUE INDEX IF NOT EXISTS listings_one_open_per_unit_uq
  ON supply.listings (unit_id) WHERE status IN ('draft','published','stale');

ALTER TABLE supply.listings ADD CONSTRAINT listings_dates_when_live CHECK (
  status NOT IN ('published','stale') OR (published_at IS NOT NULL AND last_confirmed_at IS NOT NULL));

-- The cost table is meant to be written through the API only; keep amounts and currency sane.
ALTER TABLE supply.listing_costs ADD CONSTRAINT listing_costs_kes_only CHECK (currency = 'KES');
