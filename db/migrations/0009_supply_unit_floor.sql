-- B3 S3 follow-up: an optional floor on each unit. The unit label (apartment number) stays the preferred name.
ALTER TABLE supply.units ADD COLUMN floor text CHECK (floor IS NULL OR char_length(floor) BETWEEN 1 AND 20);
