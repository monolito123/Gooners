-- 0009: receivable units registered at a receivables registrar and the contract effects the
-- platform registers on them before advancing (docs/07 §1.6, Res. BCB 264/2022).

ALTER TABLE receivables ADD COLUMN arrangement TEXT;
UPDATE receivables r SET arrangement = CASE r.brand
    WHEN 'visa' THEN 'V' WHEN 'mastercard' THEN 'M' WHEN 'elo' THEN 'E' WHEN 'hipercard' THEN 'H' WHEN 'amex' THEN 'A' ELSE upper(left(r.brand, 1)) END
  || CASE WHEN p.card_funding IN ('debit', 'prepaid') THEN 'CD' ELSE 'CC' END -- VCC, VCD, MCC, MCD, ECC, ECD…
  FROM payment_intents p WHERE p.id = r.payment_intent_id AND r.arrangement IS NULL;

-- What the platform last registered for each UR (merchant document, arrangement, date).
CREATE TABLE receivable_units (
  document         TEXT        NOT NULL,
  arrangement      TEXT        NOT NULL,
  settles_on       DATE        NOT NULL,
  tenant_id        UUID        NOT NULL,
  merchant_id      TEXT        NOT NULL REFERENCES merchants (id),
  registered_total BIGINT      NOT NULL,
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document, arrangement, settles_on)
);

-- Contract effects (assignments to the platform) registered before each advance.
CREATE TABLE receivable_effects (
  id          TEXT        PRIMARY KEY,           -- the registrar's idempotency key
  tenant_id   UUID        NOT NULL,
  merchant_id TEXT        NOT NULL REFERENCES merchants (id),
  reason      TEXT        NOT NULL CHECK (reason IN ('instant_release', 'payout_advance')),
  reference   TEXT        NOT NULL,              -- payment intent or payout quote
  lines       JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
