-- 0026: transfers between merchants' accounts of one tenant (docs/02 §6.5): one ledger journal
-- each, identified by the tenant and the request's Idempotency-Key.
CREATE TABLE transfers (
  id            TEXT        PRIMARY KEY,
  tenant_id     UUID        NOT NULL,
  from_account  TEXT        NOT NULL,
  to_account    TEXT        NOT NULL,
  from_merchant TEXT        NOT NULL REFERENCES merchants (id),
  to_merchant   TEXT        NOT NULL REFERENCES merchants (id),
  amount        BIGINT      NOT NULL CHECK (amount > 0),
  currency      CHAR(3)     NOT NULL,
  description   TEXT,
  journal_id    TEXT        NOT NULL,
  actor         TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transfers_by_account ON transfers (tenant_id, from_account, created_at DESC);
CREATE INDEX transfers_by_to_account ON transfers (tenant_id, to_account, created_at DESC);
