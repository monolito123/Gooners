-- 0004: operations. Merchant lifecycle, revocations and their audit trail, disputes,
-- and reconciliation of card settlement reports and of Pix received at the PSP.

ALTER TABLE merchants ADD CONSTRAINT merchants_status CHECK (status IN ('kyb_in_review', 'active', 'restricted', 'closed'));
ALTER TABLE merchants ADD COLUMN status_reason TEXT;
ALTER TABLE terminals ADD COLUMN revoked_at TIMESTAMPTZ, ADD COLUMN revoked_reason TEXT;
ALTER TABLE api_clients ADD COLUMN revoked_reason TEXT;

-- Every operator action, and every partner action that changes access, is recorded here.
CREATE TABLE ops_audit (
  id        BIGSERIAL   PRIMARY KEY,
  tenant_id UUID,
  actor     TEXT        NOT NULL,                 -- operator identity (SSO subject) or api:<key id>
  action    TEXT        NOT NULL,
  target    TEXT        NOT NULL,
  detail    JSONB,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ops_audit_by_target ON ops_audit (target, at);

CREATE TABLE disputes (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  merchant_id       TEXT        NOT NULL REFERENCES merchants (id),
  payment_intent_id TEXT        NOT NULL REFERENCES payment_intents (id),
  scheme            TEXT        NOT NULL,
  network_case_id   TEXT        NOT NULL,
  reason_code       TEXT        NOT NULL,
  category          TEXT        NOT NULL CHECK (category IN ('fraud', 'authorization', 'processing_error', 'consumer_dispute')),
  amount            BIGINT      NOT NULL CHECK (amount > 0),
  currency          CHAR(3)     NOT NULL,
  status            TEXT        NOT NULL CHECK (status IN ('evidence_required', 'represented', 'pre_arbitration', 'accepted', 'won', 'lost')),
  evidence_due_at   TIMESTAMPTZ NOT NULL,
  evidence          JSONB,
  submitted_at      TIMESTAMPTZ,
  held_wallet       BIGINT      NOT NULL DEFAULT 0, -- debited from the wallet when the chargeback arrived
  held_recoverable  BIGINT      NOT NULL DEFAULT 0, -- shortfall booked as owed by the merchant
  due_soon_notified BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scheme, network_case_id)
);
CREATE INDEX disputes_by_intent ON disputes (payment_intent_id);
CREATE INDEX disputes_by_merchant ON disputes (tenant_id, merchant_id, created_at DESC);
CREATE INDEX disputes_due ON disputes (evidence_due_at) WHERE status = 'evidence_required';

-- Lifecycle notices from the sponsor or the scheme, applied once each.
CREATE TABLE dispute_events (
  dispute_id TEXT        NOT NULL REFERENCES disputes (id),
  event      TEXT        NOT NULL,
  source     TEXT        NOT NULL,                -- file name and line, or api
  detail     JSONB,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dispute_id, event)
);

CREATE TABLE recon_runs (
  id            TEXT        PRIMARY KEY,
  tenant_id     UUID        NOT NULL,
  kind          TEXT        NOT NULL CHECK (kind IN ('card_settlement', 'pix_daily')),
  source        TEXT        NOT NULL,             -- settlement report ID, or the Pix business date
  business_date DATE        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('balanced', 'exceptions')),
  summary       JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recon_runs_by_source ON recon_runs (tenant_id, kind, source, created_at DESC);

CREATE TABLE recon_exceptions (
  id          BIGSERIAL   PRIMARY KEY,
  run_id      TEXT        NOT NULL REFERENCES recon_runs (id),
  tenant_id   UUID        NOT NULL,
  kind        TEXT        NOT NULL,
  reference   TEXT        NOT NULL,
  expected    BIGINT,
  actual      BIGINT,
  detail      JSONB,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recon_exceptions_open ON recon_exceptions (tenant_id, created_at) WHERE resolved_at IS NULL;

-- Card settlement report lines. A line is applied once, and a sale settles once.
CREATE TABLE settlement_records (
  tenant_id   UUID        NOT NULL,
  report_id   TEXT        NOT NULL,
  line        INT         NOT NULL,
  record_type TEXT        NOT NULL CHECK (record_type IN ('sale', 'refund', 'chargeback', 'chargeback_reversal')),
  brand       TEXT        NOT NULL,
  rrn         TEXT        NOT NULL,
  auth_code   TEXT,
  amount      BIGINT      NOT NULL,
  interchange BIGINT      NOT NULL DEFAULT 0,
  scheme_fees BIGINT      NOT NULL DEFAULT 0,
  net         BIGINT      NOT NULL,
  matched_ref TEXT,                                -- payment intent, refund or dispute
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, report_id, line)
);
CREATE UNIQUE INDEX settlement_records_once ON settlement_records (tenant_id, record_type, matched_ref) WHERE matched_ref IS NOT NULL;

-- Periodic jobs (releases, sweeps, reconciliation) run on one replica at a time. A lease
-- table instead of advisory locks keeps this portable to CockroachDB.
CREATE TABLE job_leases (
  name       TEXT        PRIMARY KEY,
  holder     TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
