-- 0024: independent dates for the daily transparency roots (integration point 20): RFC 3161
-- time-stamp tokens over each root event's id, one per authority.
CREATE TABLE root_timestamps (
  log_date   DATE        NOT NULL REFERENCES transparency_roots (log_date),
  authority  TEXT        NOT NULL,                        -- the authority's URL
  token      BYTEA       NOT NULL,                        -- the TimeStampToken (DER), as the authority returned it
  gen_time   TIMESTAMPTZ NOT NULL,                        -- when the authority says the root existed
  signer     TEXT        NOT NULL,                        -- the authority certificate's subject
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (log_date, authority)
);
