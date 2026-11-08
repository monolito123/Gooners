-- Partner tokens (docs/02 §3.1): OAuth 2.0 client credentials with certificate-bound access
-- tokens (RFC 8705). A client authenticates with a TLS client certificate whose SHA-256
-- thumbprint is registered here; its tokens are opaque, short-lived, stored hashed, and valid
-- only over a connection presenting the same certificate.
CREATE TABLE oauth_clients (
  id               TEXT        PRIMARY KEY,                -- cli_…
  tenant_id        UUID        NOT NULL,
  name             TEXT        NOT NULL,
  scopes           TEXT[]      NOT NULL,
  cert_thumbprints TEXT[]      NOT NULL,                   -- x5t#S256, base64url
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_reason   TEXT
);
CREATE INDEX oauth_clients_by_tenant ON oauth_clients (tenant_id, created_at DESC);

CREATE TABLE oauth_tokens (
  token_hash      TEXT        PRIMARY KEY,                 -- SHA-256 of the token; the token is never stored
  client_id       TEXT        NOT NULL REFERENCES oauth_clients (id),
  tenant_id       UUID        NOT NULL,
  scopes          TEXT[]      NOT NULL,
  cert_thumbprint TEXT        NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_by_client ON oauth_tokens (client_id, expires_at);
