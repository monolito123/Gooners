package authswitch

import (
	"context"
	"sort"
	"sync"
	"time"
)

// MemStore is an in-memory Store for tests and the simulator stack.
type MemStore struct {
	mu        sync.Mutex
	recs      map[string]*Record
	byKey     map[string]string
	reversals []*Reversal
	nextID    int64
}

// NewMemStore returns an empty store.
func NewMemStore() *MemStore {
	return &MemStore{recs: map[string]*Record{}, byKey: map[string]string{}}
}

func idemKey(r *Record) string {
	return r.TenantID + "|" + r.TerminalID + "|" + r.TerminalSTAN + "|" + r.LocalDate
}

func (s *MemStore) Begin(_ context.Context, rec *Record) (*Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.byKey[idemKey(rec)]; ok {
		c := *s.recs[id]
		return &c, nil
	}
	c := *rec
	c.CreatedAt, c.UpdatedAt = time.Now(), time.Now()
	s.recs[rec.AuthID] = &c
	s.byKey[idemKey(rec)] = rec.AuthID
	return nil, nil
}

func (s *MemStore) MarkSent(_ context.Context, authID, route, stan, rrn, de7 string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.recs[authID]
	if !ok {
		return ErrNotFound
	}
	r.Route, r.NetworkSTAN, r.RRN, r.TransmissionDT, r.Status = route, stan, rrn, de7, StatusSent
	return nil
}

func (s *MemStore) Complete(_ context.Context, authID string, st Status, rc, code, ntid string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.recs[authID]
	if !ok {
		return ErrNotFound
	}
	r.Status, r.ResponseCode, r.AuthCode, r.NetworkTxnID, r.UpdatedAt = st, rc, code, ntid, time.Now()
	return nil
}

func (s *MemStore) Get(_ context.Context, authID string) (*Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.recs[authID]
	if !ok {
		return nil, ErrNotFound
	}
	c := *r
	return &c, nil
}

func (s *MemStore) AddReversed(_ context.Context, authID string, amount int64, st Status) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.recs[authID]
	if !ok {
		return ErrNotFound
	}
	r.ReversedAmount += amount
	r.Status = st
	return nil
}

func (s *MemStore) EnqueueReversal(_ context.Context, rv Reversal) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextID++
	rv.ID = s.nextID
	if rv.CreatedAt.IsZero() {
		rv.CreatedAt = time.Now()
	}
	s.reversals = append(s.reversals, &rv)
	return nil
}

func (s *MemStore) DueReversals(_ context.Context, now time.Time, limit int) ([]Reversal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Reversal
	for _, r := range s.reversals {
		if !r.Done && !r.NextAt.After(now) {
			out = append(out, *r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *MemStore) UpdateReversal(_ context.Context, id int64, done bool, attempts int, next time.Time, lastErr string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.reversals {
		if r.ID == id {
			r.Done, r.Attempts, r.NextAt, r.LastError = done, attempts, next, lastErr
			return nil
		}
	}
	return ErrNotFound
}

// Reversals returns a snapshot of the queue (tests).
func (s *MemStore) Reversals() []Reversal {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Reversal, len(s.reversals))
	for i, r := range s.reversals {
		out[i] = *r
	}
	return out
}
