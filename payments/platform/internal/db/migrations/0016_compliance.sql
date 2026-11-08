-- Custody reconciliation, sanctions screening of withdrawal addresses, and the monthly
-- DeCripto report (docs/09 §6 and §8).

-- The nightly comparison of each venue's balances with the ledger's custody accounts runs for
-- the platform as a whole (the venue accounts are shared by every tenant).
ALTER TABLE recon_runs DROP CONSTRAINT recon_runs_kind_check;
ALTER TABLE recon_runs ADD CONSTRAINT recon_runs_kind_check CHECK (kind IN ('card_settlement', 'pix_daily', 'custody'));

-- A withdrawal's value in reais when it was sent (the best price to sell then): the DeCripto
-- reports it, and the price cannot be looked up again later.
ALTER TABLE asset_transfers ADD COLUMN value_brl BIGINT;

-- Every screening of a withdrawal address, clear or not: the evidence that it was done.
CREATE TABLE address_screenings (
  id          BIGSERIAL   PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  merchant_id TEXT        NOT NULL REFERENCES merchants (id),
  network     TEXT        NOT NULL,
  address     TEXT        NOT NULL,
  result      TEXT        NOT NULL CHECK (result IN ('clear', 'hit', 'error')),
  sources     TEXT        NOT NULL,                 -- the lists and services consulted
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX address_screenings_hits ON address_screenings (created_at) WHERE result = 'hit';
CREATE INDEX address_screenings_by_merchant ON address_screenings (tenant_id, merchant_id, created_at DESC);

-- The monthly DeCripto files (IN RFB 2.291/2025, leiaute 1.0 of ADE COPES 2/2025), as
-- generated, and when operations filed each one at the Coleta Nacional.
CREATE TABLE decripto_reports (
  period       DATE        PRIMARY KEY,             -- the first day of the month reported
  content      TEXT        NOT NULL,
  sha256       TEXT        NOT NULL,
  records      JSONB       NOT NULL,                -- count and total per record type
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filed_at     TIMESTAMPTZ,
  filed_by     TEXT,
  receipt      TEXT                                 -- the receipt the Coleta Nacional gives
);
