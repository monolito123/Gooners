package screening

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var ctx = context.Background()

// A line in the shape of OFAC's SDN.CSV (name, type, program, …, remarks); the addresses are
// synthetic.
const sdnLine = `99999,"EXAMPLE, Person","individual","CYBER2",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 01 Jan 1980; Digital Currency Address - XBT bc1qexampleexampleexampleexample0000; Digital Currency Address - ETH 0xAbCdEf0000000000000000000000000000001234; Digital Currency Address - TRX TExampleExampleExampleExampleExam; alt. Digital Currency Address - USDT TExampleExampleExampleExampleExam."`

func TestParse(t *testing.T) {
	m, err := Parse(strings.NewReader("header\n"+sdnLine+"\n"), "OFAC SDN")
	if err != nil || len(m) != 3 {
		t.Fatalf("%v %v", m, err)
	}
	if m["0xabcdef0000000000000000000000000000001234"] != "OFAC SDN (ETH)" || m["TExampleExampleExampleExampleExam"] == "" {
		t.Fatalf("%v", m)
	}
	// One address per line, comments and blanks ignored.
	m, _ = Parse(strings.NewReader("# extracted list\n\n0xDEADbeef00000000000000000000000000000001\nTAbc  some note\n"), "list")
	if len(m) != 2 || m["0xdeadbeef00000000000000000000000000000001"] != "list" || m["TAbc"] != "list" {
		t.Fatalf("%v", m)
	}
}

func TestNormalize(t *testing.T) {
	for in, want := range map[string]string{
		"0xAbC":     "0xabc",
		"BC1QXYZ":   "bc1qxyz", // bech32 is case-insensitive
		"TAbCd":     "TAbCd",   // base58 is not
		" 1AbC \n":  "1AbC",
		"So1anaAbC": "So1anaAbC",
	} {
		if got := Normalize(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}

func TestListLoadsRefusesWhenStaleAndKeepsTheOldListOnFailure(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sdn.csv")
	if err := os.WriteFile(path, []byte(sdnLine), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	l := &List{Sources: []string{path}, Now: func() time.Time { return now }}
	if _, _, err := l.Screen(ctx, "ethereum", "0x1"); !errors.Is(err, ErrStale) {
		t.Fatal("an unloaded list cannot clear anything")
	}
	if err := l.Load(ctx); err != nil {
		t.Fatal(err)
	}
	if hit, src, err := l.Screen(ctx, "ethereum", "0xABCDEF0000000000000000000000000000001234"); err != nil || !hit || src != path+" (ETH)" {
		t.Fatalf("%v %s %v", hit, src, err)
	}
	if hit, _, err := l.Screen(ctx, "tron", "texampleexampleexampleexampleexam"); err != nil || hit {
		t.Fatal("base58 addresses compare exactly")
	}
	l.Sources = append(l.Sources, filepath.Join(dir, "missing.txt"))
	if err := l.Load(ctx); err == nil || l.Size() != 3 {
		t.Fatalf("a failed reload keeps the old lists: %v, %d", err, l.Size())
	}
	now = now.Add(73 * time.Hour)
	if _, _, err := l.Screen(ctx, "ethereum", "0x1"); !errors.Is(err, ErrStale) {
		t.Fatal("a list older than 72 hours is not used")
	}
	// Over HTTPS (here a test server) the same.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("0xFeed000000000000000000000000000000000001\n"))
	}))
	defer srv.Close()
	h := &List{Sources: []string{srv.URL + "/sanctioned_addresses_ETH.txt"}}
	if err := h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	if hit, _, _ := h.Screen(ctx, "ethereum", "0xfeed000000000000000000000000000000000001"); !hit {
		t.Fatal("list over HTTP")
	}
}

func TestServiceAndSet(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Query().Get("address") {
		case "bad":
			_, _ = w.Write([]byte(`{"sanctioned": true, "matches": [{"list": "OFAC SDN", "name": "EXAMPLE"}]}`))
		case "odd":
			_, _ = w.Write([]byte(`{"matches": []}`))
		default:
			_, _ = w.Write([]byte(`{"sanctioned": false, "matches": []}`))
		}
	}))
	defer srv.Close()
	svc := &Service{URL: srv.URL + "/screen", Token: "tok", Label: "provider"}
	if hit, m, err := svc.Screen(ctx, "tron", "bad"); err != nil || !hit || m != "OFAC SDN EXAMPLE" {
		t.Fatalf("%v %s %v", hit, m, err)
	}
	if _, _, err := svc.Screen(ctx, "tron", "odd"); err == nil {
		t.Fatal("an answer without \"sanctioned\" is an error, never a pass")
	}
	if _, _, err := (&Service{URL: srv.URL}).Screen(ctx, "tron", "x"); err == nil {
		t.Fatal("unauthorized")
	}
	set := Set{SandboxAddresses, svc}
	r, err := set.Screen(ctx, "ethereum", "0x0000000000000000000000000000000000000BAD")
	if err != nil || !r.Hit || len(r.Sources) != 2 || r.Matches[0] != "static: sandbox test list" {
		t.Fatalf("%+v %v", r, err)
	}
	if r, err := set.Screen(ctx, "tron", "clean"); err != nil || r.Hit {
		t.Fatalf("%+v %v", r, err)
	}
	if _, err := (Set{SandboxAddresses, &Service{URL: srv.URL}}).Screen(ctx, "tron", "clean"); err == nil {
		t.Fatal("one source failing fails the screening (closed)")
	}
	if _, err := (Set{}).Screen(ctx, "tron", "x"); err == nil {
		t.Fatal("no source is not a pass")
	}
}
