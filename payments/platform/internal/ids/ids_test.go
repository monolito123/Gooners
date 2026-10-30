package ids

import (
	"strings"
	"testing"
	"time"
)

func TestULID(t *testing.T) {
	a := ULIDAt(time.UnixMilli(1793295730000))
	if !Valid(a) || !strings.HasPrefix(a, "01") {
		t.Fatalf("invalid %s", a)
	}
	b := ULIDAt(time.UnixMilli(1793295730001))
	if a[:10] >= b[:10] {
		t.Fatalf("not time-sortable: %s %s", a, b)
	}
	seen := map[string]bool{}
	for i := 0; i < 10000; i++ {
		u := ULID()
		if seen[u] || !Valid(u) {
			t.Fatalf("duplicate or invalid %s", u)
		}
		seen[u] = true
	}
	if Valid("01JBK3Z9Y8X7W6V5U4T3S2R1Q0") {
		t.Fatal("U is not a Crockford character")
	}
}
