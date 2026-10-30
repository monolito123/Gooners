package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// KindJournal is a terminal journal entry (docs/03 §7.1).
const KindJournal = 7714

// MaxJournalBatch caps one upload; a device that was offline longer sends several.
const MaxJournalBatch = 500

var journalTypes = map[string]bool{"session_start": true, "tap_started": true, "auth_result": true, "receipt_shown": true,
	"pix_static_shown": true, "cash_sale": true, "config_change": true, "attestation": true, "session_end": true}

var hex32 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// JournalHead is the last entry the platform holds for a device.
type JournalHead struct {
	Seq     int64  `json:"seq"`
	EventID string `json:"event_id"`
}

// JournalStatus answers a device's upload or reconciliation (the HTTPS form of the 27711 /
// 27712 exchange, docs/03 §9): consistent, platform_behind (it lacks the missing ranges, which
// the device republishes) or fork_detected (the terminal is frozen).
type JournalStatus struct {
	Status     string       `json:"status"`
	Accepted   int          `json:"accepted"`
	Duplicates int          `json:"duplicates"`
	Head       *JournalHead `json:"head"`
	Missing    [][2]int64   `json:"missing"` // inclusive seq ranges
	Forks      int          `json:"forks"`
}

type journalContent struct {
	V               int     `json:"v"`
	Seq             *int64  `json:"seq"`
	Prev            *string `json:"prev"`
	Type            string  `json:"type"`
	PaymentIntentID string  `json:"payment_intent_id"`
	LocalTime       string  `json:"local_time"`
	App             *struct {
		Version string `json:"version"`
	} `json:"app"`
}

type journalEntry struct {
	ev      nostr.Event
	c       journalContent
	payload []byte
}

// checkJournalEntry verifies one entry: the device's signature, the merchant, and the
// fields every entry must carry (nostr/schemas/kind-7714).
func checkJournalEntry(ev nostr.Event, devicePub, merchantRoot string, now time.Time) (*journalEntry, error) {
	if err := ev.Verify(); err != nil {
		return nil, invalid("entry %s: %v", ev.ID, err)
	}
	if ev.Kind != KindJournal {
		return nil, invalid("entry %s: kind %d is not a journal entry (%d)", ev.ID, ev.Kind, KindJournal)
	}
	if ev.PubKey != devicePub {
		return nil, invalid("entry %s is not signed by this device's key", ev.ID)
	}
	if merchantRoot != "" {
		if t := ev.Tag("merchant"); len(t) < 2 || t[1] != merchantRoot {
			return nil, invalid("entry %s does not name the merchant's root key", ev.ID)
		}
	}
	if time.Unix(ev.CreatedAt, 0).After(now.Add(10 * time.Minute)) {
		return nil, invalid("entry %s is dated in the future", ev.ID)
	}
	var c journalContent
	dec := json.NewDecoder(strings.NewReader(ev.Content))
	if err := dec.Decode(&c); err != nil {
		return nil, invalid("entry %s: content is not JSON: %v", ev.ID, err)
	}
	switch {
	case c.V != 1:
		return nil, invalid("entry %s: v must be 1", ev.ID)
	case c.Seq == nil || *c.Seq < 0:
		return nil, invalid("entry %s: seq must be a non-negative integer", ev.ID)
	case !journalTypes[c.Type]:
		return nil, invalid("entry %s: unknown type %q", ev.ID, c.Type)
	case c.LocalTime == "" || c.App == nil || c.App.Version == "":
		return nil, invalid("entry %s: local_time and app.version are required", ev.ID)
	case c.Prev == nil && *c.Seq > 1:
		return nil, invalid("entry %s: only the first entry may have no prev", ev.ID)
	case c.Prev != nil && !hex32.MatchString(*c.Prev):
		return nil, invalid("entry %s: prev must be an event id", ev.ID)
	}
	payload, _ := json.Marshal(ev)
	return &journalEntry{ev: ev, c: c, payload: payload}, nil
}

// IngestJournal stores a device's signed journal entries in seq order. Re-sent entries are
// duplicates; an entry that contradicts a stored one (same seq, or a prev that is not the
// entry before it) is kept as proof of a fork and freezes the device's terminal.
func (s *Service) IngestJournal(ctx context.Context, tenantID, merchantID, deviceID string, events []nostr.Event) (*JournalStatus, error) {
	if len(events) == 0 || len(events) > MaxJournalBatch {
		return nil, invalid("send 1 to %d journal entries", MaxJournalBatch)
	}
	var devicePub, merchantRoot string
	var terminal *string
	if err := s.pool.QueryRow(ctx, `SELECT d.pubkey, COALESCE(m.root_pubkey, ''), d.terminal_id FROM devices d JOIN merchants m ON m.id = d.merchant_id
		WHERE d.tenant_id = $1 AND d.id = $2 AND d.merchant_id = $3`, tenantID, deviceID, merchantID).Scan(&devicePub, &merchantRoot, &terminal); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	entries := make([]*journalEntry, 0, len(events))
	for _, ev := range events {
		e, err := checkJournalEntry(ev, devicePub, merchantRoot, s.cfg.Now())
		if err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	sort.Slice(entries, func(a, b int) bool { return *entries[a].c.Seq < *entries[b].c.Seq })

	out := &JournalStatus{}
	forked := false
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		fork := func(seq int64, reason string, kept, other []byte) error {
			forked = true
			_, err := tx.Exec(ctx, `INSERT INTO journal_forks (device_id, seq, reason, kept_event, other_event) VALUES ($1, $2, $3, $4, $5)`, deviceID, seq, reason, kept, other)
			return err
		}
		for _, e := range entries {
			seq := *e.c.Seq
			var pi *string
			if e.c.PaymentIntentID != "" {
				pi = &e.c.PaymentIntentID
			}
			tag, err := tx.Exec(ctx, `INSERT INTO terminal_journal (device_id, seq, event_id, prev_event_id, type, payment_intent_id, tenant_id, merchant_id, event)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
				deviceID, seq, e.ev.ID, e.c.Prev, e.c.Type, pi, tenantID, merchantID, e.payload)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				var storedID string
				var stored []byte
				if err := tx.QueryRow(ctx, `SELECT event_id, event FROM terminal_journal WHERE device_id = $1 AND seq = $2`, deviceID, seq).Scan(&storedID, &stored); err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						// The same event under another device or seq: a replay, not this device's entry.
						return invalid("entry %s is already in another journal", e.ev.ID)
					}
					return err
				}
				if storedID == e.ev.ID {
					out.Duplicates++
					continue
				}
				if err := fork(seq, "same_seq", stored, e.payload); err != nil {
					return err
				}
				continue
			}
			out.Accepted++
			// The chain, in both directions: this entry's prev, and the next entry's prev.
			var beforeID string
			var before []byte
			err = tx.QueryRow(ctx, `SELECT event_id, event FROM terminal_journal WHERE device_id = $1 AND seq = $2`, deviceID, seq-1).Scan(&beforeID, &before)
			if err == nil && (e.c.Prev == nil || *e.c.Prev != beforeID) {
				if err := fork(seq, "broken_chain", before, e.payload); err != nil {
					return err
				}
			} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			var afterPrev *string
			var after []byte
			err = tx.QueryRow(ctx, `SELECT prev_event_id, event FROM terminal_journal WHERE device_id = $1 AND seq = $2`, deviceID, seq+1).Scan(&afterPrev, &after)
			if err == nil && (afterPrev == nil || *afterPrev != e.ev.ID) {
				if err := fork(seq+1, "broken_chain", e.payload, after); err != nil {
					return err
				}
			} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		if forked && terminal != nil {
			// docs/03 §9: freeze the terminal; a risk analyst reviews the fork.
			if _, err := tx.Exec(ctx, `UPDATE terminals SET status = 'revoked', revoked_at = now(), revoked_reason = 'journal fork detected' WHERE id = $1 AND status = 'active'`, *terminal); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if forked {
		s.log.Error("terminal journal fork", "device", deviceID, "merchant", merchantID)
	}
	st, err := s.journalStatus(ctx, deviceID)
	if err != nil {
		return nil, err
	}
	st.Accepted, st.Duplicates = out.Accepted, out.Duplicates
	return st, nil
}

// JournalState is the platform's view of a device's journal.
func (s *Service) JournalState(ctx context.Context, tenantID, merchantID, deviceID string) (*JournalStatus, error) {
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM devices WHERE tenant_id = $1 AND id = $2 AND merchant_id = $3`, tenantID, deviceID, merchantID).Scan(&n); err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrNotFound
	}
	return s.journalStatus(ctx, deviceID)
}

func (s *Service) journalStatus(ctx context.Context, deviceID string) (*JournalStatus, error) {
	st := &JournalStatus{Missing: [][2]int64{}}
	var head JournalHead
	err := s.pool.QueryRow(ctx, `SELECT seq, event_id FROM terminal_journal WHERE device_id = $1 ORDER BY seq DESC LIMIT 1`, deviceID).Scan(&head.Seq, &head.EventID)
	switch {
	case err == nil:
		st.Head = &head
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}
	// Gaps: before the first stored entry (journals start at 0 or 1) and between entries.
	rows, err := s.pool.Query(ctx, `
		SELECT 1, min(seq) - 1 FROM terminal_journal WHERE device_id = $1 HAVING min(seq) > 1
		UNION ALL
		SELECT seq + 1, next - 1 FROM (SELECT seq, lead(seq) OVER (ORDER BY seq) AS next FROM terminal_journal WHERE device_id = $1) g WHERE next > seq + 1
		ORDER BY 1 LIMIT 100`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r [2]int64
		if err := rows.Scan(&r[0], &r[1]); err != nil {
			return nil, err
		}
		st.Missing = append(st.Missing, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM journal_forks WHERE device_id = $1`, deviceID).Scan(&st.Forks); err != nil {
		return nil, err
	}
	switch {
	case st.Forks > 0:
		st.Status = "fork_detected"
	case len(st.Missing) > 0:
		st.Status = "platform_behind"
	default:
		st.Status = "consistent"
	}
	return st, nil
}

// IntentJournal returns the devices' signed journal entries about a payment: dispute
// evidence independent of the platform's own logs (docs/03 §7.1).
func (s *Service) IntentJournal(ctx context.Context, tenantID, intentID string) ([]nostr.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT event FROM terminal_journal WHERE tenant_id = $1 AND payment_intent_id = $2 ORDER BY device_id, seq`, tenantID, intentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []nostr.Event{}
	for rows.Next() {
		var raw []byte
		var ev nostr.Event
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &ev); err != nil {
			return nil, fmt.Errorf("journal entry: %w", err)
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}
