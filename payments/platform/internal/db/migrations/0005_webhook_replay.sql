-- 0005: webhook replay. A replayed delivery gets a fresh 72-hour window from replayed_at.
ALTER TABLE webhook_deliveries ADD COLUMN replayed_at TIMESTAMPTZ;
