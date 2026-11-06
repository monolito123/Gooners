-- Assets other than reais (docs/09): crypto-assets held at exchanges and foreign currencies
-- held at FX providers. Ledger currency codes grow to eight characters (USDT, USDC).
ALTER TABLE ledger_accounts ALTER COLUMN currency TYPE VARCHAR(8);
ALTER TABLE postings ALTER COLUMN currency TYPE VARCHAR(8);

-- A payment intent paid in crypto: the quote the customer saw and the transfer it waits for.
-- The amount is made unique among pending charges on the same address, which is how a
-- deposit finds its payment.
CREATE TABLE crypto_charges (
  payment_intent_id TEXT        PRIMARY KEY REFERENCES payment_intents (id),
  tenant_id         UUID        NOT NULL,
  merchant_id       TEXT        NOT NULL REFERENCES merchants (id),
  exchange          TEXT        NOT NULL,
  asset             VARCHAR(8)  NOT NULL,
  network           TEXT        NOT NULL,
  address           TEXT        NOT NULL,
  memo              TEXT        NOT NULL DEFAULT '',
  units             BIGINT      NOT NULL CHECK (units > 0),
  price             TEXT        NOT NULL,          -- reais per whole asset, as quoted
  status            TEXT        NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'late')),
  expires_at        TIMESTAMPTZ NOT NULL,
  deposit_id        TEXT,
  txid              TEXT,
  proceeds          BIGINT,                         -- centavos the sale raised
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ
);
CREATE UNIQUE INDEX crypto_charges_match ON crypto_charges (exchange, asset, network, address, memo, units) WHERE status = 'pending';
CREATE INDEX crypto_charges_pending ON crypto_charges (exchange, asset, created_at) WHERE status = 'pending';

-- Deposits already handled, so a poll seeing one again does nothing.
CREATE TABLE crypto_deposits (
  exchange    TEXT        NOT NULL,
  deposit_id  TEXT        NOT NULL,
  asset       VARCHAR(8)  NOT NULL,
  units       BIGINT      NOT NULL,
  matched_to  TEXT,                                 -- the payment intent, or NULL: an exception for operations
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, deposit_id)
);

-- Conversions between a merchant's reais and another asset (crypto or foreign currency):
-- the quote, then its execution.
CREATE TABLE conversions (
  id           TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL,
  merchant_id  TEXT        NOT NULL REFERENCES merchants (id),
  kind         TEXT        NOT NULL CHECK (kind IN ('crypto', 'fx')),
  venue        TEXT        NOT NULL,
  side         TEXT        NOT NULL CHECK (side IN ('buy', 'sell')),  -- buy: reais into the asset
  asset        VARCHAR(8)  NOT NULL,
  asset_units  BIGINT      NOT NULL CHECK (asset_units > 0),
  brl_units    BIGINT      NOT NULL CHECK (brl_units > 0),           -- before fee and tax
  fee          BIGINT      NOT NULL DEFAULT 0,                       -- centavos
  tax          BIGINT      NOT NULL DEFAULT 0,                       -- IOF, centavos
  price        TEXT        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('quoted', 'executed', 'expired', 'failed')),
  expires_at   TIMESTAMPTZ NOT NULL,
  venue_ref    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at  TIMESTAMPTZ
);
CREATE INDEX conversions_by_merchant ON conversions (tenant_id, merchant_id, created_at DESC);

-- Transfers out of a merchant's holdings: crypto to an address, foreign currency to a bank.
CREATE TABLE asset_transfers (
  id           TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL,
  merchant_id  TEXT        NOT NULL REFERENCES merchants (id),
  kind         TEXT        NOT NULL CHECK (kind IN ('crypto', 'fx')),
  venue        TEXT        NOT NULL,
  asset        VARCHAR(8)  NOT NULL,
  units        BIGINT      NOT NULL CHECK (units > 0),
  fee_units    BIGINT      NOT NULL DEFAULT 0,
  destination  JSONB       NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('sent', 'failed')),
  venue_ref    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX asset_transfers_by_merchant ON asset_transfers (tenant_id, merchant_id, created_at DESC);
