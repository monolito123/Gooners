package scheme_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/dialects"
	"github.com/monolito123/Gooners/payments/platform/internal/scheme"
	"github.com/monolito123/Gooners/payments/platform/internal/schemesim"
	"github.com/monolito123/Gooners/payments/platform/pkg/iso8583"
)

func setup(t *testing.T, cfgMod func(*scheme.Config)) (*schemesim.Sim, *scheme.Session, context.CancelFunc) {
	t.Helper()
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	sim := schemesim.New(codec)
	sim.RequireSignOn = true
	sim.LateDelay = 400 * time.Millisecond
	addr, err := sim.Listen("127.0.0.1:0", nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg := scheme.Config{Name: "test", Addr: addr, Codec: codec, AcquirerID: "12345678", SignOn: true, EchoInterval: 200 * time.Millisecond}
	if cfgMod != nil {
		cfgMod(&cfg)
	}
	sess := scheme.NewSession(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	go sess.Run(ctx)
	pool := scheme.NewPool("test", sess)
	wctx, wcancel := context.WithTimeout(ctx, 3*time.Second)
	defer wcancel()
	if err := pool.WaitReady(wctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cancel(); sim.Close() })
	return sim, sess, cancel
}

var stan atomic.Uint32

func auth(cents string) *iso8583.Message {
	return iso8583.NewMessage("0100").
		Set(2, "4111111111111111").Set(3, "003000").Set(4, "0000000129"+cents).
		Set(7, time.Now().UTC().Format("0102150405")).Set(11, fmt.Sprintf("%06d", stan.Add(1))).
		Set(37, "630217004211").Set(41, "TP000418").Set(42, "000000004127731").Set(49, "986")
}

func TestSignOnAndApprove(t *testing.T) {
	sim, sess, _ := setup(t, nil)
	if len(sim.ReceivedMTI("0800")) == 0 || sim.ReceivedMTI("0800")[0].Get(70) != "001" {
		t.Fatal("no sign-on received")
	}
	resp, err := sess.Exchange(context.Background(), auth("90"), 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if resp.MTI != "0110" || resp.Get(39) != "00" || len(resp.Get(38)) != 6 {
		t.Fatalf("unexpected response %s", resp.Dump(nil))
	}
}

func TestDeclineCodes(t *testing.T) {
	_, sess, _ := setup(t, nil)
	for _, rc := range []string{"05", "51", "54", "91"} {
		resp, err := sess.Exchange(context.Background(), auth(rc), 2*time.Second)
		if err != nil || resp.Get(39) != rc {
			t.Errorf("cents %s: %v %v", rc, resp, err)
		}
	}
}

func TestTimeoutAndLateResponse(t *testing.T) {
	var late atomic.Int32
	_, sess, _ := setup(t, func(c *scheme.Config) { c.OnLate = func(*iso8583.Message) { late.Add(1) } })
	_, err := sess.Exchange(context.Background(), auth("98"), 300*time.Millisecond)
	if !errors.Is(err, scheme.ErrTimeout) {
		t.Fatalf("want timeout, got %v", err)
	}
	_, err = sess.Exchange(context.Background(), auth("99"), 150*time.Millisecond)
	if !errors.Is(err, scheme.ErrTimeout) {
		t.Fatalf("want timeout for late response, got %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for late.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if late.Load() != 1 {
		t.Fatal("late response was not reported")
	}
}

func TestReconnectAfterDrop(t *testing.T) {
	sim, sess, _ := setup(t, nil)
	before := len(sim.ReceivedMTI("0800"))
	sim.DropConnections()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if sess.State() == scheme.SignedOn && len(sim.ReceivedMTI("0800")) > before {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if sess.State() != scheme.SignedOn {
		t.Fatalf("session did not recover: %s", sess.State())
	}
	if _, err := sess.Exchange(context.Background(), auth("10"), 2*time.Second); err != nil {
		t.Fatal(err)
	}
}

func TestEchoWhenIdleAndHostEcho(t *testing.T) {
	sim, sess, _ := setup(t, nil)
	time.Sleep(700 * time.Millisecond)
	echoes := 0
	for _, m := range sim.ReceivedMTI("0800") {
		if m.Get(70) == "301" {
			echoes++
		}
	}
	if echoes == 0 {
		t.Fatal("no idle echo sent")
	}
	if err := sim.SendEcho(context.Background()); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for len(sim.ReceivedMTI("0810")) == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if len(sim.ReceivedMTI("0810")) == 0 {
		t.Fatal("host echo not answered")
	}
	if sess.State() != scheme.SignedOn {
		t.Fatal("session lost")
	}
}

func TestNotSignedOnIsNotSent(t *testing.T) {
	codec := iso8583.NewCodec(dialects.MustLoad(dialects.Generic))
	sess := scheme.NewSession(scheme.Config{Name: "idle", Addr: "127.0.0.1:1", Codec: codec})
	_, err := sess.Exchange(context.Background(), auth("10"), time.Second)
	if !errors.Is(err, scheme.ErrNotSent) {
		t.Fatalf("want ErrNotSent, got %v", err)
	}
	pool := scheme.NewPool("idle", sess)
	if _, err := pool.Exchange(context.Background(), auth("10"), time.Second); !errors.Is(err, scheme.ErrNotSent) {
		t.Fatalf("pool: want ErrNotSent, got %v", err)
	}
}

func TestConcurrentExchanges(t *testing.T) {
	_, sess, _ := setup(t, nil)
	var wg sync.WaitGroup
	errs := make(chan error, 200)
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := auth("10")
			resp, err := sess.Exchange(context.Background(), req, 3*time.Second)
			if err != nil {
				errs <- err
				return
			}
			if resp.Get(11) != req.Get(11) {
				errs <- fmt.Errorf("correlation mismatch %s != %s", resp.Get(11), req.Get(11))
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestSTANWraps(t *testing.T) {
	s := scheme.NewSTANSource()
	seen := map[string]bool{}
	for i := 0; i < 1_000_100; i++ {
		v := s.Next()
		if v == "000000" || len(v) != 6 {
			t.Fatalf("bad STAN %q", v)
		}
		if i < 1000 {
			if seen[v] {
				t.Fatalf("duplicate STAN %s", v)
			}
			seen[v] = true
		}
	}
}
