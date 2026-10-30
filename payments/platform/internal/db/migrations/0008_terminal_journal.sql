-- 0008: the devices' hash-chained terminal journals (kind 7714, docs/03 §7) and the forks
-- they reveal (§9).

CREATE TABLE terminal_journal (
  device_id         TEXT        NOT NULL REFERENCES devices (id),
  seq               BIGINT      NOT NULL CHECK (seq >= 0),
  event_id          CHAR(64)    NOT NULL,
  prev_event_id     CHAR(64),
  type              TEXT        NOT NULL,
  payment_intent_id TEXT,
  tenant_id         UUID        NOT NULL,
  merchant_id       TEXT        NOT NULL REFERENCES merchants (id),
  event             JSONB       NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, seq)
);
CREATE UNIQUE INDEX terminal_journal_event ON terminal_journal (event_id);
CREATE INDEX terminal_journal_by_intent ON terminal_journal (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

-- Two signed entries that cannot both be true: the same seq with different events, or an
-- entry whose prev is not the entry before it. Either is the device's own signed proof that
-- its journal was forked (a cloned app or a manipulated device).
CREATE TABLE journal_forks (
  id          BIGSERIAL   PRIMARY KEY,
  device_id   TEXT        NOT NULL REFERENCES devices (id),
  seq         BIGINT      NOT NULL,
  reason      TEXT        NOT NULL CHECK (reason IN ('same_seq', 'broken_chain')),
  kept_event  JSONB       NOT NULL,
  other_event JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX journal_forks_by_device ON journal_forks (device_id);
