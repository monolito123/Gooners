-- 0002: authorization switch. No clear card data: the PAN lives in the vault (pan_ref).

CREATE TABLE authorizations (
  auth_id           TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  payment_intent_id TEXT,
  kind              TEXT        NOT NULL CHECK (kind IN ('purchase', 'refund', 'verification')),
  terminal_id       TEXT        NOT NULL,
  terminal_stan     CHAR(6)     NOT NULL,
  local_date        CHAR(8)     NOT NULL,
  amount            BIGINT      NOT NULL CHECK (amount >= 0),
  currency_numeric  CHAR(3)     NOT NULL,
  route             TEXT,
  network_stan      CHAR(6),
  rrn               CHAR(12),
  transmission_dt   CHAR(10),
  processing_code   CHAR(6)     NOT NULL,
  entry_mode        TEXT,
  pan_ref           TEXT,
  merchant_mid      TEXT        NOT NULL,
  mcc               CHAR(4)     NOT NULL,
  merchant_name     TEXT,
  merchant_city     TEXT,
  acquirer_id       TEXT,
  status            TEXT        NOT NULL,
  response_code     TEXT,
  auth_code         TEXT,
  network_txn_id    TEXT,
  reversed_amount   BIGINT      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, terminal_id, terminal_stan, local_date)
);
CREATE INDEX authorizations_by_intent ON authorizations (payment_intent_id);
CREATE INDEX authorizations_by_rrn ON authorizations (rrn);

CREATE TABLE reversal_queue (
  id           BIGSERIAL   PRIMARY KEY,
  auth_id      TEXT        NOT NULL REFERENCES authorizations (auth_id),
  route        TEXT        NOT NULL,
  amount       BIGINT      NOT NULL DEFAULT 0,
  reason       TEXT        NOT NULL,
  network_stan CHAR(6)     NOT NULL,
  de7          CHAR(10)    NOT NULL,
  attempts     INT         NOT NULL DEFAULT 0,
  next_at      TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  done         BOOLEAN     NOT NULL DEFAULT false,
  last_error   TEXT
);
CREATE INDEX reversal_queue_due ON reversal_queue (next_at) WHERE NOT done;
