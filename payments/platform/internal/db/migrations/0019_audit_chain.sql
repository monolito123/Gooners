-- 0019: the audit trail as a hash chain, append-only, whose head each day's signed
-- transparency root publishes (runbook §6). Each row's hash covers the previous row's hash
-- and the row itself, so a row edited, removed or inserted out of order breaks every hash
-- after it; rewriting the whole chain no longer matches the heads already published.

ALTER TABLE ops_audit ADD COLUMN seq BIGINT, ADD COLUMN prev_hash TEXT, ADD COLUMN hash TEXT;

-- The digest of a row: SHA-256 over its fields joined by "|", the time in UTC to the
-- microsecond and the detail as PostgreSQL prints JSONB (keys in its canonical order).
CREATE FUNCTION ops_audit_digest(prev TEXT, seq BIGINT, tenant UUID, actor TEXT, action TEXT, target TEXT, detail JSONB, at TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|', prev, seq::text, COALESCE(tenant::text, ''), actor, action, target, COALESCE(detail::text, 'null'),
    to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8')), 'hex')
$$;

-- The rows already there, chained in the order they were written.
DO $$
DECLARE
  r    RECORD;
  prev TEXT := repeat('0', 64);
  n    BIGINT := 0;
BEGIN
  FOR r IN SELECT id FROM ops_audit ORDER BY id LOOP
    n := n + 1;
    UPDATE ops_audit SET seq = n, prev_hash = prev WHERE id = r.id;
    UPDATE ops_audit SET hash = ops_audit_digest(prev_hash, seq, tenant_id, actor, action, target, detail, at) WHERE id = r.id RETURNING hash INTO prev;
  END LOOP;
END $$;

-- Each new row takes the next place in the chain. The lock orders concurrent writers: the
-- chain's order is the order the rows were committed in.
CREATE FUNCTION ops_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_seq  BIGINT;
  last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(771500);
  SELECT seq, hash INTO last_seq, last_hash FROM ops_audit ORDER BY seq DESC LIMIT 1;
  NEW.seq := COALESCE(last_seq, 0) + 1;
  NEW.prev_hash := COALESCE(last_hash, repeat('0', 64));
  NEW.hash := ops_audit_digest(NEW.prev_hash, NEW.seq, NEW.tenant_id, NEW.actor, NEW.action, NEW.target, NEW.detail, NEW.at);
  RETURN NEW;
END $$;
CREATE TRIGGER ops_audit_chain BEFORE INSERT ON ops_audit FOR EACH ROW EXECUTE FUNCTION ops_audit_chain();

-- Nothing in the trail is changed or removed through the application's role.
CREATE FUNCTION ops_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ops_audit is append-only';
END $$;
CREATE TRIGGER ops_audit_append_only BEFORE UPDATE OR DELETE ON ops_audit FOR EACH ROW EXECUTE FUNCTION ops_audit_append_only();

ALTER TABLE ops_audit ALTER COLUMN seq SET NOT NULL, ALTER COLUMN prev_hash SET NOT NULL, ALTER COLUMN hash SET NOT NULL;
CREATE UNIQUE INDEX ops_audit_seq ON ops_audit (seq);
