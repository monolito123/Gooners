-- 0022: terminal certificates the platform's terminal CA issues from terminals' own CSRs
-- (docs/05 §2.4).
ALTER TABLE terminals
  ADD COLUMN cert_expires_at       TIMESTAMPTZ,
  -- The certificate a renewal replaced: it keeps working until the terminal first presents
  -- the new one, so a renewal whose response was lost cannot lock the terminal out.
  ADD COLUMN prev_cert_fingerprint TEXT,
  -- Where the terminal's key lives, from its Android hardware key attestation (strongbox or
  -- trusted_environment); NULL when the key was not attested.
  ADD COLUMN key_security_level    TEXT;

-- Every terminal request looks its certificate up, and no two terminals share one. A
-- certificate registered to two terminals authenticated as whichever row the lookup found
-- first; only its first registration keeps it.
UPDATE terminals t SET cert_fingerprint = NULL
WHERE cert_fingerprint IS NOT NULL AND EXISTS (
  SELECT 1 FROM terminals o WHERE o.cert_fingerprint = t.cert_fingerprint AND (o.created_at, o.id) < (t.created_at, t.id));
CREATE UNIQUE INDEX terminals_by_cert ON terminals (cert_fingerprint) WHERE cert_fingerprint IS NOT NULL;
CREATE INDEX terminals_by_prev_cert ON terminals (prev_cert_fingerprint) WHERE prev_cert_fingerprint IS NOT NULL;
