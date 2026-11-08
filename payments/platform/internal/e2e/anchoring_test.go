package e2e

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/payments"
	"github.com/monolito123/Gooners/payments/platform/internal/tsa"
	"github.com/monolito123/Gooners/payments/platform/internal/tsa/tsatest"
)

// Each day's transparency root is time-stamped by independent RFC 3161 authorities over its
// event id; anyone can check the tokens against the root they read (integration point 20).
func TestRootTimestamps(t *testing.T) {
	icp, public := tsatest.New(), tsatest.New()
	defer icp.Close()
	defer public.Close()
	st := newStack(t, func(d *payments.Deps) {
		d.Timestamps = []*tsa.Client{{URL: icp.URL, Roots: icp.Roots()}, {URL: public.URL, Roots: public.Roots()}}
	})
	ctx := context.Background()
	merchant, _ := st.merchant(st.key)
	_, term := st.call("POST", "/v1/terminals", map[string]any{"merchant_id": merchant, "type": "mpoc_cots"}, 201)
	st.sale(merchant, term["terminal_id"].(string), 12990)
	root, err := st.svc.CloseDay(ctx, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	// One authority is down: the other stamps; the first is asked again on the next run.
	public.Down.Store(true)
	if n, err := st.svc.AnchorRoots(ctx); err != nil || n != 1 {
		t.Fatalf("anchoring with one authority down: %d %v", n, err)
	}
	public.Down.Store(false)
	if n, err := st.svc.AnchorRoots(ctx); err != nil || n != 1 {
		t.Fatalf("the authority back: %d %v", n, err)
	}
	if n, _ := st.svc.AnchorRoots(ctx); n != 0 {
		t.Fatalf("a root stamped twice by the same authority: %d", n)
	}

	resp, err := http.Get(st.api + "/v1/transparency/" + root.Date)
	if err != nil {
		t.Fatal(err)
	}
	var pub payments.TransparencyRoot
	_ = json.NewDecoder(resp.Body).Decode(&pub)
	resp.Body.Close()
	if len(pub.Timestamps) != 2 {
		t.Fatalf("timestamps %+v", pub.Timestamps)
	}
	digest, _ := hex.DecodeString(pub.Event.ID)
	for _, ts := range pub.Timestamps {
		der, _ := base64.StdEncoding.DecodeString(ts.Token)
		roots := icp.Roots()
		if ts.Authority == public.URL {
			roots = public.Roots()
		}
		tok, err := tsa.Verify(der, digest, roots)
		if err != nil || !tok.Trusted || !tok.Time.Equal(ts.Time) || time.Since(tok.Time) > time.Minute {
			t.Fatalf("%s: %+v %v", ts.Authority, tok, err)
		}
		// The token dates this root, not any other.
		other := sha256.Sum256([]byte("another day's root event"))
		if _, err := tsa.Verify(der, other[:], roots); err == nil {
			t.Fatal("a token verified for another root")
		}
	}
}
