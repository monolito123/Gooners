-- Fraud shield (docs/07 §3): one assessment per card-present authorization attempt, recorded
-- before the issuer sees it. The rows are also the history the next assessment reads
-- (card velocity across terminals and tenants, card testing on a terminal, ATC continuity).

CREATE TABLE risk_assessments (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  merchant_id       TEXT        NOT NULL REFERENCES merchants (id),
  terminal_id       CHAR(8)     NOT NULL REFERENCES terminals (id),
  payment_intent_id TEXT        NOT NULL,
  card_fingerprint  TEXT        NOT NULL,
  card_bin          TEXT        NOT NULL,
  card_instance     TEXT        NOT NULL,                    -- fingerprint, expiry and PAN sequence: one physical card
  atc               INTEGER,
  amount            BIGINT      NOT NULL,
  device_score      SMALLINT,                                -- thousandths, as reported
  device_model      TEXT,
  device_signals    TEXT[]      NOT NULL DEFAULT '{}',
  device_level      TEXT        NOT NULL,
  server_score      SMALLINT    NOT NULL,                    -- thousandths
  server_signals    TEXT[]      NOT NULL DEFAULT '{}',
  server_level      TEXT        NOT NULL,
  action            TEXT        NOT NULL CHECK (action IN ('allow', 'allow_hold', 'step_up', 'step_up_hold', 'decline', 'decline_freeze')),
  enforced          BOOLEAN     NOT NULL,                    -- false in shadow mode
  outcome           TEXT,                                    -- approved, declined, pin_required, timeout, risk_declined
  review_status     TEXT        NOT NULL DEFAULT 'none' CHECK (review_status IN ('none', 'open', 'released', 'fraud')),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       TEXT,
  review_note       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX risk_by_card ON risk_assessments (card_fingerprint, created_at DESC);
CREATE INDEX risk_by_terminal ON risk_assessments (terminal_id, created_at DESC);
CREATE INDEX risk_open_reviews ON risk_assessments (tenant_id, created_at) WHERE review_status = 'open';

-- A held receivable neither settles nor backs an advance until its review releases it.
ALTER TABLE receivables ADD COLUMN held BOOLEAN NOT NULL DEFAULT false;
DROP INDEX receivables_pending;
CREATE INDEX receivables_pending ON receivables (tenant_id, merchant_id, settles_on) WHERE status = 'pending' AND NOT held;

-- A frozen terminal cannot sell until a review releases it; revoking it stays possible.
ALTER TABLE terminals ADD COLUMN frozen_reason TEXT;
