-- 0020: what integrators need to manage their side (docs/02): webhook endpoints can be
-- switched off, and a merchant's sales are summed by capture time, by day or by hour.

ALTER TABLE webhook_endpoints ADD COLUMN disabled_at TIMESTAMPTZ;

-- The day and period summaries sum a merchant's captures by time.
CREATE INDEX payment_intents_captured_by_merchant ON payment_intents (tenant_id, merchant_id, captured_at) WHERE captured_at IS NOT NULL;

-- GET /v1/merchants lists a tenant's merchants, newest first.
CREATE INDEX merchants_by_tenant ON merchants (tenant_id, created_at DESC, id DESC);
