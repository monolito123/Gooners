package metrics

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestExposition(t *testing.T) {
	r := NewRegistry()
	c := r.Counter("goonerspay_test_total", "Test counter.", "route", "code")
	c.Inc("POST /v1/refunds", "201")
	c.Add(2, "POST /v1/refunds", "201")
	c.Inc(`a"b`, "500")
	r.Gauge("goonerspay_backlog", "Backlog.", func(context.Context) ([]Sample, error) {
		return []Sample{{Value: 7}, {Labels: map[string]string{"kind": "x"}, Value: 1.5}}, nil
	})
	var b bytes.Buffer
	r.Write(context.Background(), &b)
	want := `# HELP goonerspay_test_total Test counter.
# TYPE goonerspay_test_total counter
goonerspay_test_total{code="201",route="POST /v1/refunds"} 3
goonerspay_test_total{code="500",route="a\"b"} 1
# HELP goonerspay_backlog Backlog.
# TYPE goonerspay_backlog gauge
goonerspay_backlog 7
goonerspay_backlog{kind="x"} 1.5
`
	if b.String() != want {
		t.Fatalf("got\n%s", b.String())
	}
	if !strings.Contains(b.String(), "# TYPE goonerspay_backlog gauge") {
		t.Fatal("gauge type missing")
	}
}
