-- Add optional Google Maps URL and per-person fee (TWD).
-- Existing rows get fee_amount = 0; do not recreate the table.
ALTER TABLE events ADD COLUMN google_maps_url TEXT;
ALTER TABLE events ADD COLUMN fee_amount INTEGER NOT NULL DEFAULT 0;

UPDATE events SET fee_amount = 0 WHERE fee_amount IS NULL;
