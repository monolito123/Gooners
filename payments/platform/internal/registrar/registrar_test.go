package registrar

import (
	"context"
	"errors"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestRegistrarOverHTTP(t *testing.T) {
	mem := NewMemory()
	srv := httptest.NewServer(Handler(mem))
	defer srv.Close()
	var r Registrar = &Client{BaseURL: srv.URL}
	ctx := context.Background()
	k := UnitKey{Document: "12345678000195", Arrangement: "VCC", SettlesOn: "2026-11-30"}
	if err := r.Register(ctx, []Unit{{k, 10_000}}); err != nil {
		t.Fatal(err)
	}
	// Another institution pledges part of the UR.
	mem.Pledge(k, 3_000)
	av, err := r.Availability(ctx, []UnitKey{k})
	if err != nil || av[k] != (Availability{Total: 10_000, Committed: 3_000, Free: 7_000}) {
		t.Fatalf("availability: %v %v", av, err)
	}
	e := Effect{ID: "pq_1", Type: "assignment", Beneficiary: "99999999000191", Lines: []EffectLine{{k, 6_000}}}
	if err := r.RegisterEffect(ctx, e); err != nil {
		t.Fatal(err)
	}
	if err := r.RegisterEffect(ctx, e); err != nil {
		t.Fatalf("registering the same effect again: %v", err)
	}
	if err := r.RegisterEffect(ctx, Effect{ID: "pq_2", Type: "assignment", Lines: []EffectLine{{k, 1_001}}}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("an effect beyond the free amount: %v", err)
	}
	if av, _ := r.Availability(ctx, []UnitKey{k}); av[k].Free != 1_000 {
		t.Fatalf("free after one effect: %v", av[k])
	}
	if err := r.CancelEffect(ctx, "pq_1"); err != nil {
		t.Fatal(err)
	}
	if err := r.CancelEffect(ctx, "pq_1"); err != nil {
		t.Fatalf("cancelling twice: %v", err)
	}
	if av, _ := r.Availability(ctx, []UnitKey{k}); av[k].Free != 7_000 {
		t.Fatalf("free after cancelling the effect: %v", av[k])
	}
}

// An effect commits all its lines or none, and concurrent effects never overcommit a UR.
func TestEffectsAreAtomic(t *testing.T) {
	m := NewMemory()
	ctx := context.Background()
	a := UnitKey{"12345678000195", "VCC", "2026-11-30"}
	b := UnitKey{"12345678000195", "VCC", "2026-12-30"}
	_ = m.Register(ctx, []Unit{{a, 1_000}, {b, 500}})
	if err := m.RegisterEffect(ctx, Effect{ID: "x", Lines: []EffectLine{{a, 800}, {b, 600}}}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("partial effect: %v", err)
	}
	if av, _ := m.Availability(ctx, []UnitKey{a}); av[a].Free != 1_000 {
		t.Fatalf("a refused effect committed a line: %v", av[a])
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if m.RegisterEffect(ctx, Effect{ID: string(rune('A' + i)), Lines: []EffectLine{{a, 100}}}) == nil {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if ok != 10 {
		t.Fatalf("%d effects of 100 fit in a UR of 1000", ok)
	}
}
