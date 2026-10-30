// Package registrar keeps card receivables registered at a receivables registrar (CERC,
// Núclea, B3, TAG), as Res. BCB 264/2022 requires (docs/00 §7, docs/07 §1.6): every
// receivable unit (UR) — a merchant, a payment arrangement and a settlement date — is
// registered with its total, and an advance first registers its contract effect on the URs,
// which is what makes financing the same receivable twice impossible across the market.
package registrar

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
)

// ErrUnavailable means a UR has less free amount than an effect needs: it is committed to
// another contract (here or at another institution).
var ErrUnavailable = errors.New("registrar: the receivable unit is committed")

// UnitKey identifies a receivable unit.
type UnitKey struct {
	Document    string `json:"document"`    // the merchant's CNPJ or CPF
	Arrangement string `json:"arrangement"` // payment arrangement code (VCC, MCC, ECD…)
	SettlesOn   string `json:"settles_on"`  // YYYY-MM-DD
}

func (k UnitKey) String() string { return k.Document + "/" + k.Arrangement + "/" + k.SettlesOn }

// Unit is a UR and its total: what the acquirer will pay the merchant for it.
type Unit struct {
	UnitKey
	Total int64 `json:"total"`
}

// Availability of a UR across every institution's contracts.
type Availability struct {
	Total     int64 `json:"total"`
	Committed int64 `json:"committed"`
	Free      int64 `json:"free"`
}

// EffectLine commits part of one UR.
type EffectLine struct {
	UnitKey
	Amount int64 `json:"amount"`
}

// Effect is a contract effect (an assignment to the platform for an advance) on URs.
type Effect struct {
	ID          string       `json:"id"` // idempotency: registering the same ID twice changes nothing
	Type        string       `json:"type"`
	Beneficiary string       `json:"beneficiary"`
	Lines       []EffectLine `json:"lines"`
}

// Registrar is a receivables registrar. Production plugs in the chosen registrar's API
// (CERC first, docs/00 A5); Memory and the HTTP contract here serve the sandbox and tests.
type Registrar interface {
	// Register sets the totals of URs (absolute, idempotent).
	Register(ctx context.Context, units []Unit) error
	// Availability reports how much of each UR is free.
	Availability(ctx context.Context, keys []UnitKey) (map[UnitKey]Availability, error)
	// RegisterEffect commits every line or none; ErrUnavailable when a UR lacks the free amount.
	RegisterEffect(ctx context.Context, e Effect) error
	// CancelEffect frees what an effect committed (the advanced sale was reversed). Cancelling
	// an unknown or cancelled effect changes nothing.
	CancelEffect(ctx context.Context, id string) error
}

// Memory is an in-process registrar: the sandbox's, and the test double.
type Memory struct {
	mu        sync.Mutex
	totals    map[UnitKey]int64
	committed map[UnitKey]int64
	effects   map[string]Effect
}

// NewMemory returns an empty registrar.
func NewMemory() *Memory {
	return &Memory{totals: map[UnitKey]int64{}, committed: map[UnitKey]int64{}, effects: map[string]Effect{}}
}

// Register implements Registrar.
func (m *Memory) Register(_ context.Context, units []Unit) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range units {
		if u.Total < 0 {
			return fmt.Errorf("registrar: negative total for %s", u.UnitKey)
		}
		m.totals[u.UnitKey] = u.Total
	}
	return nil
}

// Availability implements Registrar.
func (m *Memory) Availability(_ context.Context, keys []UnitKey) (map[UnitKey]Availability, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[UnitKey]Availability, len(keys))
	for _, k := range keys {
		a := Availability{Total: m.totals[k], Committed: m.committed[k]}
		if a.Free = a.Total - a.Committed; a.Free < 0 {
			a.Free = 0
		}
		out[k] = a
	}
	return out, nil
}

// RegisterEffect implements Registrar.
func (m *Memory) RegisterEffect(_ context.Context, e Effect) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.effects[e.ID]; ok {
		return nil
	}
	need := map[UnitKey]int64{}
	for _, l := range e.Lines {
		if l.Amount <= 0 {
			return fmt.Errorf("registrar: effect line on %s must be positive", l.UnitKey)
		}
		need[l.UnitKey] += l.Amount
	}
	keys := make([]UnitKey, 0, len(need))
	for k := range need {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].String() < keys[j].String() })
	for _, k := range keys {
		if m.totals[k]-m.committed[k] < need[k] {
			return fmt.Errorf("%w: %s has %d free, the effect needs %d", ErrUnavailable, k, m.totals[k]-m.committed[k], need[k])
		}
	}
	for _, k := range keys {
		m.committed[k] += need[k]
	}
	m.effects[e.ID] = e
	return nil
}

// CancelEffect implements Registrar.
func (m *Memory) CancelEffect(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.effects[id]
	if !ok {
		return nil
	}
	for _, l := range e.Lines {
		m.committed[l.UnitKey] -= l.Amount
	}
	delete(m.effects, id)
	return nil
}

// Pledge commits amount of a UR to another institution, as a competing lender would.
func (m *Memory) Pledge(k UnitKey, amount int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.committed[k] += amount
}

// Totals is a copy of the registered totals, for tests and the reconciliation.
func (m *Memory) Totals() map[UnitKey]int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[UnitKey]int64, len(m.totals))
	for k, v := range m.totals {
		out[k] = v
	}
	return out
}
