package payments

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/metrics"
)

// Anchoring (integration point 20). Each daily transparency root (kind 7715) is time-stamped
// by every configured RFC 3161 authority over its event id, which is the SHA-256 of the
// signed event (NIP-01): the token proves the root existed at that time, from a party the
// platform does not control, so the platform cannot present another history for a published
// day. The tokens are served with the root (GET /v1/transparency/{date}); anyone checks one
// with tsa.Verify(token, event id, the authority's roots), or openssl ts -verify.

var mAnchors = metrics.Default.Counter("goonerspay_root_timestamps_total", "Time stamps of the daily transparency roots, by result (stamped, error).", "result")

// RootTimestamp is a root's time stamp by one authority.
type RootTimestamp struct {
	Authority string    `json:"authority"`
	Time      time.Time `json:"time"`
	Signer    string    `json:"signer"`
	Token     string    `json:"token"` // the TimeStampToken, base64 DER
}

// AnchorRoots time-stamps the roots of the last 30 days that an authority has not stamped yet,
// newest first, at most three per authority a run; an authority that fails is asked again on
// the next run.
func (s *Service) AnchorRoots(ctx context.Context) (int, error) {
	stamped := 0
	for _, a := range s.stamps {
		rows, err := s.pool.Query(ctx, `SELECT r.log_date, r.event_id FROM transparency_roots r
			WHERE r.log_date >= CURRENT_DATE - 30 AND NOT EXISTS (SELECT 1 FROM root_timestamps t WHERE t.log_date = r.log_date AND t.authority = $1)
			ORDER BY r.log_date DESC LIMIT 3`, a.URL)
		if err != nil {
			return stamped, err
		}
		type due struct {
			day time.Time
			id  string
		}
		var roots []due
		for rows.Next() {
			var d due
			if err := rows.Scan(&d.day, &d.id); err != nil {
				rows.Close()
				return stamped, err
			}
			roots = append(roots, d)
		}
		rows.Close()
		for _, r := range roots {
			digest, err := hex.DecodeString(r.id)
			if err != nil {
				return stamped, err
			}
			tok, err := a.Stamp(ctx, digest)
			if err != nil {
				mAnchors.Inc("error")
				s.log.Warn("time stamp of a root failed; asking again on the next run", "authority", a.URL, "day", r.day.Format("2006-01-02"), "err", err)
				break
			}
			if _, err := s.pool.Exec(ctx, `INSERT INTO root_timestamps (log_date, authority, token, gen_time, signer) VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (log_date, authority) DO NOTHING`, r.day, a.URL, tok.DER, tok.Time, tok.Signer.Subject.String()); err != nil {
				return stamped, err
			}
			mAnchors.Inc("stamped")
			stamped++
		}
	}
	return stamped, nil
}

// rootTimestamps reads a root's time stamps.
func (s *Service) rootTimestamps(ctx context.Context, day time.Time) ([]RootTimestamp, error) {
	rows, err := s.pool.Query(ctx, `SELECT authority, gen_time, signer, token FROM root_timestamps WHERE log_date = $1 ORDER BY authority`, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RootTimestamp{}
	for rows.Next() {
		var t RootTimestamp
		var der []byte
		if err := rows.Scan(&t.Authority, &t.Time, &t.Signer, &der); err != nil {
			return nil, err
		}
		t.Time, t.Token = t.Time.UTC(), base64.StdEncoding.EncodeToString(der)
		out = append(out, t)
	}
	return out, rows.Err()
}
