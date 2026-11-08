-- 0023: the KYB check of each new merchant (docs/04 §5): the registry's data compared with
-- what was declared, and the names screened.
ALTER TABLE merchants
  ADD COLUMN kyb_result     JSONB,                       -- kyb.Result: outcome, findings, the registry's data
  ADD COLUMN kyb_checked_at TIMESTAMPTZ,                 -- the last attempt (a failed one is retried after ten minutes)
  ADD COLUMN kyb_attempts   INT         NOT NULL DEFAULT 0;
CREATE INDEX merchants_kyb_due ON merchants (created_at) WHERE status = 'kyb_in_review' AND kyb_result IS NULL;

-- A name on a sanctions list among a merchant's company, partners or representatives is a
-- compliance case.
ALTER TABLE compliance_cases DROP CONSTRAINT compliance_cases_kind_check;
ALTER TABLE compliance_cases ADD CONSTRAINT compliance_cases_kind_check CHECK (kind IN ('deposit_screening', 'travel_rule', 'merchant_kyb'));

-- Possible name matches compliance cleared (screening/fuzzy.go): the same name is not flagged
-- again for the same list entry in the tenant. A name that is on a list is never cleared.
CREATE TABLE name_clearances (
  tenant_id  UUID        NOT NULL,
  name_key   TEXT        NOT NULL,                       -- screening.NameKey of the screened name
  entry      TEXT        NOT NULL,                       -- the list entry it resembled, as screening reported it
  case_id    TEXT        NOT NULL REFERENCES compliance_cases (id),
  cleared_by TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name_key, entry)
);
