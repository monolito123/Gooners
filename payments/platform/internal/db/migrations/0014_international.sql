-- International accounts (docs/09): the payment reference that routes money arriving from
-- abroad to its merchant (the same function as fx.Reference), and the credits seen.
ALTER TABLE merchants ADD COLUMN fx_reference TEXT;

CREATE FUNCTION merchant_fx_reference(id TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT 'GP' || upper(substr(encode(sha256(convert_to('goonerspay/v1/fx-reference:' || id, 'UTF8')), 'hex'), 1, 10))
$$;

CREATE FUNCTION merchants_set_fx_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.fx_reference := merchant_fx_reference(NEW.id);
  RETURN NEW;
END
$$;

CREATE TRIGGER merchants_fx_reference BEFORE INSERT ON merchants FOR EACH ROW EXECUTE FUNCTION merchants_set_fx_reference();
UPDATE merchants SET fx_reference = merchant_fx_reference(id);
CREATE UNIQUE INDEX merchants_by_fx_reference ON merchants (fx_reference);

CREATE TABLE fx_credits (
  provider    TEXT        NOT NULL,
  credit_id   TEXT        NOT NULL,
  currency    VARCHAR(8)  NOT NULL,
  units       BIGINT      NOT NULL,
  reference   TEXT        NOT NULL,
  payer       TEXT        NOT NULL DEFAULT '',
  merchant_id TEXT        REFERENCES merchants (id),   -- NULL: no merchant has the reference; an exception for operations
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, credit_id)
);
