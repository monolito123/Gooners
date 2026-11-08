-- 0025: the audit trail's daily copies in WORM storage (S3 Object Lock, compliance mode): each
-- row is a contiguous stretch of the hash chain, closed at the end of a Brasília day.
CREATE TABLE audit_exports (
  day          DATE        PRIMARY KEY,
  object_key   TEXT        NOT NULL,
  store        TEXT        NOT NULL,                -- s3://bucket
  version      TEXT,                                -- the object's version in the bucket
  first_seq    BIGINT,                              -- NULL for a day without audit rows
  last_seq     BIGINT,
  last_hash    TEXT        NOT NULL,                -- the chain's head after the day
  rows         INT         NOT NULL,
  sha256       CHAR(64)    NOT NULL,                -- of the object written
  retain_until TIMESTAMPTZ NOT NULL,
  exported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
