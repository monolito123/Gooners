// Package webhooks delivers platform events to partner endpoints following the Standard
// Webhooks specification (webhook-id, webhook-timestamp, webhook-signature: v1,<HMAC-SHA256>),
// at least once, with retries (docs/02-api-reference.md §10).
package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
)

// NewSecret returns a "whsec_" secret with 24 random bytes.
func NewSecret() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return "whsec_" + base64.StdEncoding.EncodeToString(b)
}

// Sign returns the v1 signature over id.timestamp.body.
func Sign(secret, id string, ts int64, body []byte) (string, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil {
		return "", fmt.Errorf("webhooks: secret: %w", err)
	}
	m := hmac.New(sha256.New, key)
	fmt.Fprintf(m, "%s.%d.", id, ts)
	m.Write(body)
	return "v1," + base64.StdEncoding.EncodeToString(m.Sum(nil)), nil
}

// Verify checks a delivery the way a receiver must: timestamp within tolerance and any of
// the space-separated signatures matching in constant time.
func Verify(secret, id, tsHeader, sigHeader string, body []byte, tolerance time.Duration, now time.Time) error {
	ts, err := strconv.ParseInt(tsHeader, 10, 64)
	if err != nil {
		return fmt.Errorf("webhooks: bad timestamp")
	}
	if d := now.Sub(time.Unix(ts, 0)); d > tolerance || d < -tolerance {
		return fmt.Errorf("webhooks: timestamp outside tolerance")
	}
	want, err := Sign(secret, id, ts, body)
	if err != nil {
		return err
	}
	for _, s := range strings.Fields(sigHeader) {
		if hmac.Equal([]byte(s), []byte(want)) {
			return nil
		}
	}
	return fmt.Errorf("webhooks: no valid signature")
}

// Event is the delivered payload.
type Event struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Data      any    `json:"data"`
}

// Enqueue records one delivery per subscribed endpoint, inside the caller's transaction,
// so a webhook exists if and only if the business change committed.
func Enqueue(ctx context.Context, tx pgx.Tx, tenantID, eventType string, data any) error {
	body, err := json.Marshal(Event{Type: eventType, Timestamp: time.Now().UTC().Format(time.RFC3339), Data: data})
	if err != nil {
		return err
	}
	msgID := ids.New("msg")
	_, err = tx.Exec(ctx, `INSERT INTO webhook_deliveries (endpoint_id, message_id, type, body)
		SELECT id, $3, $2, $4 FROM webhook_endpoints WHERE tenant_id = $1 AND ($2 = ANY(events) OR '*' = ANY(events))`,
		tenantID, eventType, msgID, string(body))
	return err
}

// Dispatcher sends due deliveries.
type Dispatcher struct {
	Pool   *pgxpool.Pool
	Client *http.Client
	Logger *slog.Logger
}

var schedule = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute, 10 * time.Minute, time.Hour, 3 * time.Hour}

const maxAge = 72 * time.Hour

// Run delivers until ctx ends.
func (d *Dispatcher) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := d.Once(ctx); err != nil && ctx.Err() == nil {
				d.log().Error("webhook dispatch", "err", err)
			}
		}
	}
}

func (d *Dispatcher) log() *slog.Logger {
	if d.Logger == nil {
		return slog.Default()
	}
	return d.Logger
}

// Once makes one pass and returns the number of successful deliveries.
func (d *Dispatcher) Once(ctx context.Context) (int, error) {
	type job struct {
		id                    int64
		url, secret, msg, typ string
		body                  string
		attempts              int
		created               time.Time
	}
	var jobs []job
	err := pgx.BeginFunc(ctx, d.Pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT w.id, e.url, e.secret, w.message_id, w.type, w.body, w.attempts, w.next_at
			FROM webhook_deliveries w JOIN webhook_endpoints e ON e.id = w.endpoint_id
			WHERE w.delivered_at IS NULL AND w.next_at <= now() ORDER BY w.id LIMIT 50 FOR UPDATE OF w SKIP LOCKED`)
		if err != nil {
			return err
		}
		for rows.Next() {
			var j job
			if err := rows.Scan(&j.id, &j.url, &j.secret, &j.msg, &j.typ, &j.body, &j.attempts, &j.created); err != nil {
				rows.Close()
				return err
			}
			jobs = append(jobs, j)
		}
		rows.Close()
		for _, j := range jobs { // lease for a minute while we deliver outside the transaction
			if _, err := tx.Exec(ctx, `UPDATE webhook_deliveries SET next_at = now() + interval '1 minute' WHERE id = $1`, j.id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	client := d.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	ok := 0
	for _, j := range jobs {
		ts := time.Now().Unix()
		sig, err := Sign(j.secret, j.msg, ts, []byte(j.body))
		if err != nil {
			return ok, err
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, j.url, bytes.NewReader([]byte(j.body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("webhook-id", j.msg)
		req.Header.Set("webhook-timestamp", strconv.FormatInt(ts, 10))
		req.Header.Set("webhook-signature", sig)
		status := 0
		resp, err := client.Do(req)
		if err == nil {
			status = resp.StatusCode
			resp.Body.Close()
		}
		if status >= 200 && status < 300 {
			ok++
			_, _ = d.Pool.Exec(ctx, `UPDATE webhook_deliveries SET delivered_at = now(), attempts = attempts + 1, last_status = $2 WHERE id = $1`, j.id, status)
			continue
		}
		next := schedule[min(j.attempts, len(schedule)-1)]
		_, _ = d.Pool.Exec(ctx, `UPDATE webhook_deliveries SET attempts = attempts + 1, last_status = $2, next_at = now() + $3::interval WHERE id = $1`,
			j.id, status, fmt.Sprintf("%d seconds", int(next.Seconds())))
		d.log().Warn("webhook delivery failed", "url", j.url, "type", j.typ, "status", status, "err", err)
	}
	return ok, nil
}
