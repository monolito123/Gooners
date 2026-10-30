-- 0001: ledger core. Identical to docs/04-serverless-backend.md §3.2 (checked by payments/tools).
-- PostgreSQL-compatible SQL that also runs on CockroachDB.

CREATE TABLE ledger_accounts (
  tenant_id      UUID        NOT NULL,
  account_id     TEXT        NOT NULL,
  code           TEXT        NOT NULL,
  currency       CHAR(3)     NOT NULL,
  normal_side    TEXT        NOT NULL CHECK (normal_side IN ('debit', 'credit')),
  allow_negative BOOLEAN     NOT NULL DEFAULT false,
  shard_count    SMALLINT    NOT NULL DEFAULT 1 CHECK (shard_count BETWEEN 1 AND 256),
  status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id)
);

CREATE TABLE journals (
  tenant_id       UUID        NOT NULL,
  journal_id      TEXT        NOT NULL,
  idempotency_key TEXT        NOT NULL,
  type            TEXT        NOT NULL,
  reference       TEXT,
  effective_date  DATE        NOT NULL,
  reverses        TEXT,
  posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB,
  PRIMARY KEY (tenant_id, journal_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE postings (
  tenant_id  UUID     NOT NULL,
  journal_id TEXT     NOT NULL,
  seq        SMALLINT NOT NULL,
  account_id TEXT     NOT NULL,
  shard      SMALLINT NOT NULL DEFAULT 0,
  direction  TEXT     NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount     BIGINT   NOT NULL CHECK (amount > 0),
  currency   CHAR(3)  NOT NULL,
  PRIMARY KEY (tenant_id, journal_id, seq),
  FOREIGN KEY (tenant_id, journal_id) REFERENCES journals (tenant_id, journal_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES ledger_accounts (tenant_id, account_id)
);
CREATE INDEX postings_by_account ON postings (tenant_id, account_id, journal_id);

CREATE TABLE balances (
  tenant_id  UUID        NOT NULL,
  account_id TEXT        NOT NULL,
  shard      SMALLINT    NOT NULL DEFAULT 0,
  balance    BIGINT      NOT NULL DEFAULT 0,
  version    BIGINT      NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id, shard),
  FOREIGN KEY (tenant_id, account_id) REFERENCES ledger_accounts (tenant_id, account_id)
);

CREATE TABLE outbox (
  tenant_id  UUID        NOT NULL,
  event_id   UUID        NOT NULL DEFAULT gen_random_uuid(),
  topic      TEXT        NOT NULL,
  key        TEXT        NOT NULL,
  payload    JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);

-- The ledger role can only append. Corrections are reversing journals.
-- GRANT SELECT, INSERT ON journals, postings, outbox TO ledger_service;
-- GRANT SELECT, INSERT, UPDATE ON balances TO ledger_service;
-- (no UPDATE or DELETE on journals or postings for any application role)
