-- Screening of who sends each crypto deposit, compliance cases, and the travel rule: the
-- identification of originator and beneficiary that travels with transfers between providers
-- (docs/09 §6.5 to §6.7).

-- What the platform learnt about each deposit: where it came from, the screening of its
-- senders, and the travel-rule data that came with it. Deposits recorded before this
-- migration were not screened.
ALTER TABLE crypto_deposits
  ADD COLUMN tenant_id   UUID,                                   -- the charge's, or the platform's
  ADD COLUMN network     TEXT,
  ADD COLUMN address     TEXT,
  ADD COLUMN memo        TEXT NOT NULL DEFAULT '',
  ADD COLUMN txid        TEXT,
  ADD COLUMN value_brl   BIGINT,                                 -- when it arrived, at the best price to sell
  ADD COLUMN senders     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN screening   TEXT NOT NULL DEFAULT 'unscreened'
    CHECK (screening IN ('unscreened', 'pending', 'clear', 'held', 'released', 'blocked')),
  ADD COLUMN travel_rule TEXT NOT NULL DEFAULT 'not_required'
    CHECK (travel_rule IN ('not_required', 'received', 'self_declared', 'missing'));
ALTER TABLE crypto_deposits ALTER COLUMN screening SET DEFAULT 'pending';
CREATE INDEX crypto_deposits_txid ON crypto_deposits (txid) WHERE txid IS NOT NULL;
CREATE INDEX crypto_deposits_held ON crypto_deposits (screening) WHERE screening IN ('pending', 'held');

-- A charge whose deposit screening held waits for compliance; one it blocked is never paid.
ALTER TABLE crypto_charges DROP CONSTRAINT crypto_charges_status_check;
ALTER TABLE crypto_charges ADD CONSTRAINT crypto_charges_status_check CHECK (status IN ('pending', 'paid', 'expired', 'late', 'held', 'blocked'));
-- Who the customer said they are, when the checkout asked (Resolução BCB 521/2025 lets the
-- provider rely on documented self-declarations).
ALTER TABLE crypto_charges ADD COLUMN payer JSONB;

-- Address screenings now cover deposit senders too, which may belong to no merchant (a
-- deposit nobody can match).
ALTER TABLE address_screenings ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE address_screenings ADD COLUMN purpose TEXT NOT NULL DEFAULT 'withdrawal' CHECK (purpose IN ('withdrawal', 'deposit_sender'));
ALTER TABLE address_screenings ADD COLUMN reference TEXT;   -- the deposit (venue/id) a sender screening was for

-- What compliance must decide. A case holding funds ends released or blocked; a review ends
-- closed. The decision is kept with who made it and why.
CREATE TABLE compliance_cases (
  id                TEXT        PRIMARY KEY,
  tenant_id         UUID        NOT NULL,
  merchant_id       TEXT        REFERENCES merchants (id),
  kind              TEXT        NOT NULL CHECK (kind IN ('deposit_screening', 'travel_rule')),
  reason            TEXT        NOT NULL CHECK (reason IN ('sanctions_hit', 'screening_failed', 'originator_missing', 'beneficiary_mismatch')),
  subject           TEXT        NOT NULL,                     -- "deposit:<venue>/<id>"
  payment_intent_id TEXT,
  holds_funds       BOOLEAN     NOT NULL,
  asset             VARCHAR(8),
  units             BIGINT,
  status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'released', 'blocked', 'closed')),
  detail            JSONB       NOT NULL DEFAULT '{}',
  decided_by        TEXT,
  decision_note     TEXT,
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, reason, subject)
);
CREATE INDEX compliance_cases_open ON compliance_cases (tenant_id, created_at DESC) WHERE status = 'open';
CREATE INDEX compliance_cases_by_tenant ON compliance_cases (tenant_id, created_at DESC);

-- Every travel-rule message, sent or received: the IVMS101 payload as exchanged, the other
-- provider, and how it ended. Kept as the record the BCB may ask for.
CREATE TABLE travel_rule_messages (
  id               TEXT        PRIMARY KEY,
  direction        TEXT        NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  tenant_id        UUID        NOT NULL,
  merchant_id      TEXT        REFERENCES merchants (id),
  transfer_id      TEXT,                                      -- outbound: the withdrawal
  deposit_exchange TEXT,                                      -- inbound, once matched
  deposit_id       TEXT,
  asset            VARCHAR(8)  NOT NULL,
  network          TEXT        NOT NULL,
  address          TEXT        NOT NULL,
  memo             TEXT        NOT NULL DEFAULT '',
  units            BIGINT      NOT NULL,
  txid             TEXT,
  counterparty     JSONB       NOT NULL,                      -- the other provider, or {"self_hosted": true}
  ivms101          JSONB       NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('accepted', 'rejected', 'unreachable', 'self_declared', 'received', 'matched', 'refused')),
  reference        TEXT,                                      -- the network's id for the message
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX travel_rule_inbound_reference ON travel_rule_messages (reference) WHERE direction = 'inbound';
CREATE INDEX travel_rule_by_transfer ON travel_rule_messages (transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX travel_rule_unmatched ON travel_rule_messages (asset, network, address, units) WHERE direction = 'inbound' AND status = 'received';
CREATE INDEX travel_rule_by_tenant ON travel_rule_messages (tenant_id, created_at DESC);
