-- The travel rule's personal data sealed under the vault's KEK and kept only for the
-- record-keeping period; names in travel-rule messages screened; webhook secrets rotated with
-- an overlap; API keys that expire (docs/09 §6.6, docs/02 §3.1 and §10).

-- IVMS101 payloads and payers' declarations name people and their documents: they are
-- stored sealed (vault.SealSecret, bound to the record's id) and redacted once kept long enough.
ALTER TABLE travel_rule_messages ALTER COLUMN ivms101 DROP NOT NULL;
ALTER TABLE travel_rule_messages ADD COLUMN ivms101_sealed TEXT, ADD COLUMN redacted_at TIMESTAMPTZ;
ALTER TABLE crypto_charges ADD COLUMN payer_sealed TEXT;

-- A name in a travel-rule message that matches a sanctions list entry is reviewed.
ALTER TABLE compliance_cases DROP CONSTRAINT compliance_cases_reason_check;
ALTER TABLE compliance_cases ADD CONSTRAINT compliance_cases_reason_check
  CHECK (reason IN ('sanctions_hit', 'screening_failed', 'originator_missing', 'beneficiary_mismatch', 'name_match'));

-- A rotated webhook secret keeps signing beside the new one until previous_until, so the
-- partner can switch without losing a delivery.
ALTER TABLE webhook_endpoints ADD COLUMN previous_secret TEXT, ADD COLUMN previous_until TIMESTAMPTZ;

-- An API key may expire; an expired key authenticates nothing.
ALTER TABLE api_clients ADD COLUMN expires_at TIMESTAMPTZ;
