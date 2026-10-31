-- Investments at B3 (docs/09). The securities are the merchant's, held at B3's depository
-- through the broker: positions here mirror the broker's, they are not platform liabilities.

-- Suitability (Resolução CVM 30): the profile the merchant's answers give.
CREATE TABLE investor_profiles (
  tenant_id    UUID        NOT NULL,
  merchant_id  TEXT        PRIMARY KEY REFERENCES merchants (id),
  profile      TEXT        NOT NULL CHECK (profile IN ('conservador', 'moderado', 'arrojado')),
  answers      JSONB       NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE positions (
  tenant_id    UUID        NOT NULL,
  merchant_id  TEXT        NOT NULL REFERENCES merchants (id),
  ticker       TEXT        NOT NULL,
  quantity     BIGINT      NOT NULL CHECK (quantity >= 0),
  cost         BIGINT      NOT NULL CHECK (cost >= 0),    -- centavos paid for what is held, fees included
  PRIMARY KEY (merchant_id, ticker)
);

CREATE TABLE investment_orders (
  id           TEXT        PRIMARY KEY,
  tenant_id    UUID        NOT NULL,
  merchant_id  TEXT        NOT NULL REFERENCES merchants (id),
  broker       TEXT        NOT NULL,
  ticker       TEXT        NOT NULL,
  side         TEXT        NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity     BIGINT      NOT NULL CHECK (quantity > 0),
  price        TEXT        NOT NULL,                       -- average, reais
  gross        BIGINT      NOT NULL,
  fees         BIGINT      NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('executed', 'settled')),
  trade_date   DATE        NOT NULL,
  settles_on   DATE        NOT NULL,
  broker_refs  TEXT[]      NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX investment_orders_by_merchant ON investment_orders (tenant_id, merchant_id, created_at DESC);
CREATE INDEX investment_orders_due ON investment_orders (settles_on) WHERE status = 'executed';
