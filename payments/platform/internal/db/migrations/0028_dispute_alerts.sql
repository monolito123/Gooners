-- 0028: pre-dispute alerts (Mastercard's Ethoca, Visa's Verifi CDRN and RDR): an issuer's notice
-- that a cardholder disputes a sale, answered by refunding it before it becomes a chargeback.
CREATE TABLE dispute_alerts (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID,                                 -- NULL when no sale matched
  provider          TEXT        NOT NULL CHECK (provider IN ('ethoca', 'verifi_cdrn', 'verifi_rdr')),
  external_id       TEXT        NOT NULL,                 -- the provider's alert ID
  type              TEXT        NOT NULL CHECK (type IN ('fraud', 'dispute')),
  amount            BIGINT      NOT NULL CHECK (amount > 0),
  reason_code       TEXT,
  rrn               TEXT        NOT NULL,
  auth_code         TEXT,
  payment_intent_id TEXT,
  merchant_id       TEXT,
  outcome           TEXT        NOT NULL CHECK (outcome IN ('refunded', 'already_refunded', 'in_dispute', 'not_found', 'refund_failed')),
  refund_id         TEXT,
  detail            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);
CREATE INDEX dispute_alerts_by_tenant ON dispute_alerts (tenant_id, created_at DESC);
