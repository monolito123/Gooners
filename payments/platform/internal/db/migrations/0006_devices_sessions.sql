-- 0006: merchant devices, app enrollment, and DPoP-bound sessions (docs/02 §3.2, §8.2; docs/03 §4).

-- The newest kind 17710 the platform accepted for the merchant (replaceable: newest created_at wins).
ALTER TABLE merchants ADD COLUMN device_list JSONB, ADD COLUMN device_list_at BIGINT;

CREATE TABLE devices (
  id          TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  merchant_id TEXT        NOT NULL REFERENCES merchants (id),
  pubkey      CHAR(64)    NOT NULL,              -- x-only secp256k1 key the device signs Nostr events with
  platform    TEXT        NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  label       TEXT,
  model       TEXT,
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  integrity   JSONB       NOT NULL,              -- the attestation verdict
  attestation JSONB,                             -- the evidence as received
  terminal_id CHAR(8)     REFERENCES terminals (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  UNIQUE (merchant_id, pubkey)
);
CREATE INDEX devices_by_pubkey ON devices (pubkey);
ALTER TABLE terminals ADD COLUMN device_id TEXT;

-- Single-use codes a partner (or the owner's app) creates so a phone can enroll itself
-- without ever holding an API key.
CREATE TABLE enrollment_codes (
  code_hash   TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  merchant_id TEXT        NOT NULL REFERENCES merchants (id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash  TEXT        PRIMARY KEY,           -- SHA-256 of the session token
  id          TEXT        NOT NULL UNIQUE,
  tenant_id   UUID        NOT NULL,
  merchant_id TEXT        NOT NULL REFERENCES merchants (id),
  device_id   TEXT        NOT NULL REFERENCES devices (id),
  jkt         TEXT        NOT NULL,              -- RFC 7638 thumbprint of the DPoP key the session is bound to
  scopes      TEXT[]      NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX sessions_by_device ON sessions (device_id) WHERE revoked_at IS NULL;

-- NIP-98 event IDs and DPoP jti values, each accepted once across every replica.
CREATE TABLE auth_nonces (
  nonce      TEXT        PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_nonces_expiry ON auth_nonces (expires_at);
