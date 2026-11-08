-- 0007: daily settlement statements (kind 7713) and the public transparency log (kind 7715),
-- docs/03 §6 and docs/02 §9.

-- What a statement line needs from the payment, recorded at capture.
ALTER TABLE payment_intents
  ADD COLUMN fee             BIGINT,
  ADD COLUMN settlement_mode TEXT CHECK (settlement_mode IN ('instant', 'standard', 'per_installment')),
  ADD COLUMN captured_at     TIMESTAMPTZ;
UPDATE payment_intents SET captured_at = updated_at
  WHERE captured_at IS NULL AND status IN ('captured', 'partially_refunded', 'refunded');
CREATE INDEX payment_intents_captured ON payment_intents (captured_at) WHERE captured_at IS NOT NULL;

-- One signed root per Brasília business day, each naming the previous one.
CREATE TABLE transparency_roots (
  log_date      DATE        PRIMARY KEY,
  event_id      CHAR(64)    NOT NULL UNIQUE,
  root          CHAR(64)    NOT NULL,
  tree_size     INT         NOT NULL CHECK (tree_size > 0),
  prev_event_id CHAR(64),
  event         JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A merchant's day: what the statement committed to, and where its leaf sits in the log.
-- The dummy leaves are not kept: each statement carries its own audit path.
CREATE TABLE settlements (
  id                 TEXT        PRIMARY KEY,
  tenant_id          UUID        NOT NULL,
  merchant_id        TEXT        NOT NULL REFERENCES merchants (id),
  settle_date        DATE        NOT NULL,
  currency           CHAR(3)     NOT NULL,
  gross              BIGINT      NOT NULL,
  fees               BIGINT      NOT NULL,
  refunds            BIGINT      NOT NULL,
  chargebacks        BIGINT      NOT NULL,
  net                BIGINT      NOT NULL,
  transaction_count  INT         NOT NULL,
  receipts           TEXT[]      NOT NULL,          -- receipt event ids in capture order: the receipts tree's leaves
  receipts_root      CHAR(64)    NOT NULL,
  commitment         CHAR(64)    NOT NULL,
  leaf_salt          CHAR(64)    NOT NULL,
  leaf_index         INT         NOT NULL,
  audit_path         TEXT[]      NOT NULL,
  log_date           DATE        NOT NULL REFERENCES transparency_roots (log_date),
  statement_event_id CHAR(64)    NOT NULL UNIQUE,
  statement_event    JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, settle_date)
);
CREATE INDEX settlements_by_merchant ON settlements (tenant_id, merchant_id, settle_date DESC);
