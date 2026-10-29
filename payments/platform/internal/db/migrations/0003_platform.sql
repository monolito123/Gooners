-- 0003: platform services (merchants, terminals, payment intents, vault, Pix, payouts, webhooks, idempotency).

CREATE TABLE api_clients (
  key_hash   TEXT        PRIMARY KEY,           -- SHA-256 of the API key; the key itself is never stored
  tenant_id  UUID        NOT NULL,
  name       TEXT        NOT NULL,
  scopes     TEXT[]      NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE merchants (
  id                 TEXT        PRIMARY KEY,
  tenant_id          UUID        NOT NULL,
  account_id         TEXT        NOT NULL UNIQUE,
  legal_name         TEXT        NOT NULL,
  trade_name         TEXT        NOT NULL,
  document           TEXT        NOT NULL,
  mcc                CHAR(4)     NOT NULL,
  scheme_mid         TEXT        NOT NULL,
  city               TEXT        NOT NULL,
  root_pubkey        TEXT,
  pix_key            TEXT,
  pix_key_type       TEXT,
  plan               JSONB       NOT NULL,
  kyb                JSONB,                       -- representatives, address, contact (KYB evidence lives in the KYB system)
  status             TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE terminals (
  id               CHAR(8)     PRIMARY KEY,
  tenant_id        UUID        NOT NULL,
  merchant_id      TEXT        NOT NULL REFERENCES merchants (id),
  type             TEXT        NOT NULL,
  cert_fingerprint TEXT,
  status           TEXT        NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE card_vault (
  token        TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL,
  fingerprint  TEXT        NOT NULL,
  bin          CHAR(6)     NOT NULL,
  last4        CHAR(4)     NOT NULL,
  pan_ct       BYTEA       NOT NULL,              -- AES-256-GCM under a per-record DEK
  dek_wrapped  BYTEA       NOT NULL,              -- DEK wrapped by the tenant KEK
  kek_id       TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX card_vault_fingerprint ON card_vault (tenant_id, fingerprint);

CREATE TABLE payment_intents (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  merchant_id       TEXT        NOT NULL REFERENCES merchants (id),
  status            TEXT        NOT NULL,
  amount            BIGINT      NOT NULL CHECK (amount > 0),
  currency          CHAR(3)     NOT NULL,
  channel           TEXT        NOT NULL,
  capture_method    TEXT        NOT NULL,
  installments      INT         NOT NULL DEFAULT 1,
  installment_type  TEXT        NOT NULL DEFAULT 'none',
  description       TEXT,
  statement_descriptor TEXT,                      -- DE 43 merchant name override (≤ 22 characters)
  receipt_recipient TEXT,                         -- x-only pubkey of a customer who asked for the receipt in their own Nostr inbox
  metadata          JSONB,
  amount_captured   BIGINT      NOT NULL DEFAULT 0,
  amount_refunded   BIGINT      NOT NULL DEFAULT 0,
  auth_id           TEXT,
  card_brand        TEXT,
  card_last4        TEXT,
  card_funding      TEXT,
  pan_token         TEXT,
  pix_txid          TEXT,
  pix_e2e           TEXT,
  pix_copia_e_cola  TEXT,
  decline_code      TEXT,
  receipt_event_id  TEXT,
  receipt_claim_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_intents_by_merchant ON payment_intents (tenant_id, merchant_id, created_at DESC);
CREATE UNIQUE INDEX payment_intents_by_txid ON payment_intents (pix_txid) WHERE pix_txid IS NOT NULL;

-- Receivables awaiting scheme settlement: the inventory the liquidity engine advances.
CREATE TABLE receivables (
  id                BIGSERIAL   PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  merchant_id       TEXT        NOT NULL REFERENCES merchants (id),
  payment_intent_id TEXT        NOT NULL REFERENCES payment_intents (id),
  brand             TEXT        NOT NULL,
  settles_on        DATE        NOT NULL,
  amount            BIGINT      NOT NULL CHECK (amount > 0),  -- merchant payable (net of MDR)
  status            TEXT        NOT NULL CHECK (status IN ('pending', 'advanced', 'released', 'reversed')),
  advance_fee       BIGINT      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX receivables_pending ON receivables (tenant_id, merchant_id, settles_on) WHERE status = 'pending';

CREATE TABLE refunds (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  payment_intent_id TEXT        NOT NULL REFERENCES payment_intents (id),
  amount            BIGINT      NOT NULL CHECK (amount > 0),
  status            TEXT        NOT NULL,
  method            TEXT        NOT NULL,
  auth_id           TEXT,
  devolucao_id      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payout_quotes (
  id          TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  merchant_id TEXT        NOT NULL REFERENCES merchants (id),
  amount      BIGINT      NOT NULL,
  fee_total   BIGINT      NOT NULL,
  detail      JSONB       NOT NULL,
  destination JSONB       NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id          TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  merchant_id TEXT        NOT NULL REFERENCES merchants (id),
  quote_id    TEXT        NOT NULL UNIQUE REFERENCES payout_quotes (id),
  amount      BIGINT      NOT NULL,
  status      TEXT        NOT NULL,
  transfer_id TEXT,
  e2e_id      TEXT,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_endpoints (
  id         TEXT        PRIMARY KEY,
  tenant_id  UUID        NOT NULL,
  url        TEXT        NOT NULL,
  secret     TEXT        NOT NULL,
  events     TEXT[]      NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id           BIGSERIAL   PRIMARY KEY,
  endpoint_id  TEXT        NOT NULL REFERENCES webhook_endpoints (id),
  message_id   TEXT        NOT NULL,
  type         TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  attempts     INT         NOT NULL DEFAULT 0,
  next_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,                       -- after 72 h of failures; replay with POST /v1/webhook-endpoints/{id}/replay
  last_status  INT,
  UNIQUE (endpoint_id, message_id)
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_at) WHERE delivered_at IS NULL AND abandoned_at IS NULL;

CREATE TABLE idempotency_keys (
  tenant_id     UUID        NOT NULL,
  key           TEXT        NOT NULL,
  request_hash  TEXT        NOT NULL,
  status_code   INT,
  response_body BYTEA,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
