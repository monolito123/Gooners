-- Indexes for lookups the hot paths make, found by reviewing every query against the
-- indexes: without them each of these scans its whole table.

-- Reversals (the authorization timeout path), hold releases and review resolutions find a
-- payment's receivables; the balance sums what a review holds; the nightly release reads
-- what falls due.
CREATE INDEX receivables_by_intent ON receivables (payment_intent_id);
CREATE INDEX receivables_held ON receivables (tenant_id, merchant_id) WHERE held AND status = 'pending';
CREATE INDEX receivables_due ON receivables (settles_on) WHERE status = 'pending' AND NOT held;

-- A Pix devolução notification finds its refund by payment.
CREATE INDEX refunds_by_intent ON refunds (payment_intent_id);

-- Reviews are listed by status (open, released, fraud) a page at a time.
DROP INDEX risk_open_reviews;
CREATE INDEX risk_reviews ON risk_assessments (tenant_id, review_status, created_at, id) WHERE review_status <> 'none';

-- Expired sessions are purged every minute; without this each purge scans every session
-- (a phone logs in every 15 minutes).
CREATE INDEX sessions_expiry ON sessions (expires_at);
