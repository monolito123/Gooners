package authswitch_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/authswitch"
	"github.com/monolito123/Gooners/payments/platform/internal/testpg"
)

func TestMain(m *testing.M) { testpg.Main(m) }

// The same switch scenarios on the PostgreSQL store: approval, idempotent replay, timeout → SAF.
func TestPgStoreScenarios(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("PostgreSQL not available")
	}
	e := newEnv(t)
	store := authswitch.NewPgStore(testpg.Pool(t))
	sw := authswitch.New([]*authswitch.Route{e.route}, store, pans{"vault:1": "4111111111111111"},
		authswitch.Config{CardPresentTimeout: 400 * time.Millisecond, ReversalTimeout: 400 * time.Millisecond})
	ctx := context.Background()

	req := request(12990)
	req.TenantID = "00000000-0000-4000-8000-000000000001"
	res, err := sw.Authorize(ctx, req)
	if err != nil || !res.Approved {
		t.Fatalf("approve: %+v %v", res, err)
	}
	dup := req
	dup.AuthID = "auth_dup"
	again, err := sw.Authorize(ctx, dup)
	if err != nil || !again.Replayed || again.AuthCode != res.AuthCode {
		t.Fatalf("replay: %+v %v", again, err)
	}

	slow := request(12998)
	slow.TenantID = req.TenantID
	to, err := sw.Authorize(ctx, slow)
	if err != nil || to.Status != authswitch.StatusTimedOut {
		t.Fatalf("timeout: %+v %v", to, err)
	}
	before := len(e.sim.ReceivedMTI("0400"))
	sw.ProcessReversals(ctx)
	if len(e.sim.ReceivedMTI("0400")) != before+1 {
		t.Fatal("reversal not delivered from the PostgreSQL queue")
	}
	sw.ProcessReversals(ctx)
	if len(e.sim.ReceivedMTI("0400")) != before+1 {
		t.Fatal("a delivered reversal was sent again")
	}

	rev, err := sw.Reverse(ctx, res.AuthID, 0, "void")
	if err != nil || rev.Status != authswitch.StatusReversed {
		t.Fatalf("void: %+v %v", rev, err)
	}
	rec, _ := store.Get(ctx, res.AuthID)
	if rec.ReversedAmount != 12990 || rec.Status != authswitch.StatusReversed {
		t.Fatalf("record after void: %+v", rec)
	}
}
