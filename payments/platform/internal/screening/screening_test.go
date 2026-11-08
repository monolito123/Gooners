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

func TestNames(t *testing.T) {
	for a, b := range map[string]string{
		"AL-ZAWAHIRI, Ayman":   "Ayman al-Zawahiri",
		"SILVA, João da":       "Joao Da Silva",
		"BANCO NACIONAL, S.A.": "banco nacional s a",
	} {
		if NameKey(a) == "" || NameKey(a) != NameKey(b) {
			t.Errorf("%q and %q: %q vs %q", a, b, NameKey(a), NameKey(b))
		}
	}
	if NameKey("Ana") != "" || NameKey("de da") != "" || NameKey("Maria Souza") == NameKey("Maria Souza Lima") {
		t.Fatal("short or partial names compared")
	}
	// The SDN list's names, individuals and entities, not vessels; an address list has none.
	sdn := sdnLine + "\n" + `88888,"EXAMPLE TRADING CO",-0- ,"SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ` + "\n" + `77777,"SEA EXAMPLE","vessel","IRAN",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ` + "\n"
	ns, _ := ParseNames(strings.NewReader(sdn), "OFAC SDN")
	if len(ns) != 2 || ns[NameKey("Person Example")] == "" || ns[NameKey("Example Trading Co")] == "" {
		t.Fatalf("%v", ns)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "SDN.CSV")
	_ = os.WriteFile(path, []byte(sdn), 0o600)
	l := &List{Sources: []string{path}}
	if err := l.Load(ctx); err != nil || !l.HasNames() {
		t.Fatalf("%v %v", err, l.HasNames())
	}
	set := Set{l, &List{Sources: []string{path}}}
	if hit, m, err := l.ScreenName(ctx, "Person EXAMPLE"); err != nil || !hit || !strings.Contains(m, "EXAMPLE, Person") {
		t.Fatalf("%v %q %v", hit, m, err)
	}
	if r, err := set.ScreenName(ctx, "Pessoa Comum da Silva"); err == nil && (r.Hit || len(r.Sources) != 1) {
		t.Fatalf("an unrelated name, one source with names consulted: %+v", r)
	}
	if r, err := (Set{SandboxAddresses}).ScreenName(ctx, "Person Example"); err != nil || len(r.Sources) != 0 {
		t.Fatalf("no names to screen against is no screening: %+v %v", r, err)
	}
	if r, _ := (Set{SandboxNames}).ScreenName(ctx, "sandbox sanctioned PERSON"); !r.Hit {
		t.Fatal("the sandbox's test name")
	}
	l.Now = func() time.Time { return time.Now().Add(100 * time.Hour) }
	if _, _, err := l.ScreenName(ctx, "Person Example"); !errors.Is(err, ErrStale) {
		t.Fatalf("a stale list: %v", err)
	}
}

// The UN Security Council Consolidated List, in its XML's shape (the names are synthetic).
const unXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<CONSOLIDATED_LIST xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" dateGenerated="2026-11-08T00:00:00.869Z">
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>1</DATAID><FIRST_NAME>EXAMPLO</FIRST_NAME><SECOND_NAME>PERSONA</SECOND_NAME><THIRD_NAME>SINTETICA</THIRD_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE><REFERENCE_NUMBER>QDi.999</REFERENCE_NUMBER>
      <INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Abu Exemplo</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_ALIAS><QUALITY>Low</QUALITY><ALIAS_NAME>Ahmed</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_ALIAS><QUALITY>Low</QUALITY><ALIAS_NAME>Mohamed Ali Hassan</ALIAS_NAME></INDIVIDUAL_ALIAS>
      <INDIVIDUAL_ALIAS><QUALITY/><ALIAS_NAME/></INDIVIDUAL_ALIAS>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>2</DATAID><FIRST_NAME>EXAMPLE FRONT COMPANY</FIRST_NAME><REFERENCE_NUMBER>QDe.999</REFERENCE_NUMBER>
      <ENTITY_ALIAS><QUALITY>a.k.a.</QUALITY><ALIAS_NAME>Front Trading Example</ALIAS_NAME></ENTITY_ALIAS>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`

func TestUNList(t *testing.T) {
	ns, err := ParseUNNames(strings.NewReader(unXML), "UN SC")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{"Examplo Persona Sintetica", "abu exemplo", "Example Front Company", "FRONT TRADING EXAMPLE"} {
		if ns[NameKey(n)] == "" {
			t.Errorf("%q not listed: %v", n, ns)
		}
	}
	if ns[NameKey("Mohamed Ali Hassan")] != "" || len(ns) != 4 {
		t.Errorf("a low-quality alias listed: %v", ns)
	}
	if !strings.Contains(ns[NameKey("Abu Exemplo")], "QDi.999 EXAMPLO PERSONA SINTETICA") {
		t.Errorf("the match does not name the entry: %q", ns[NameKey("Abu Exemplo")])
	}
	// Loaded as a list: names, and no XML line taken for an address.
	path := filepath.Join(t.TempDir(), "consolidated.xml")
	_ = os.WriteFile(path, []byte(unXML), 0o600)
	l := &List{Sources: []string{path}}
	if err := l.Load(ctx); err != nil || !l.HasNames() || l.Size() != 0 {
		t.Fatalf("%v names %v addresses %d", err, l.HasNames(), l.Size())
	}
	if hit, m, _ := l.ScreenName(ctx, "Front Trading Example"); !hit || !strings.Contains(m, "QDe.999") {
		t.Fatalf("%v %q", hit, m)
	}
	if _, err := ParseUNNames(strings.NewReader("<CONSOLIDATED_LIST><INDIVIDUAL><FIRST_NAME>x"), "UN"); err == nil {
		t.Fatal("a truncated list accepted")
	}
}

// Possible matches: other spellings and partial names of a listed name, never namesakes of
// one word or unrelated people.
func TestPossibleMatches(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		want bool
	}{
		{"Muhammad Example Rahman", "Mohammed Example Rahman", true},  // transliteration
		{"Mohamed Exemplo Rahmani", "MUHAMMAD Exemplo Rahmani", true}, // skeleton MMD
		{"Ayman Zawahiri", "Ayman Muhammad Rabi al-Zawahiri", true},   // partial: 2 of 4
		{"Muammar Qadhafi", "Muammar Gaddafi", true},                  // Q/G and DH/DD
		{"Osama Laden", "Usama bin Laden", true},                      // initial vowel, one edit
		{"Joao Silva", "Joao Silva", false},                           // equal: a hit, not a resemblance
		{"Ayman", "Ayman Zawahiri", false},                            // one word is never enough
		{"Maria Silva", "Maria Silva Santos Oliveira Costa", false},   // 2 of 5: too partial
		{"Ana Souza", "Ana Sousa", true},                              // one surname, two spellings
		{"Ana Lima", "Ana Luna", false},                               // words of four letters must be equal
		{"Ana Souza", "Ana Silva", false},                             // another surname

		{"Pedro Almeida Prado", "Paulo Almeida Prado", false},            // a different first name
		{"Exemplo Trading Company", "Example Trading Company", true},     // one edit
		{"Front Trading Example", "Example Front Company Trading", true}, // word order is irrelevant
	} {
		if got := Resembles(tc.a, tc.b); got != tc.want {
			t.Errorf("%q ~ %q = %v, want %v (keys %q %q)", tc.a, tc.b, got, tc.want, NameKey(tc.a), NameKey(tc.b))
		}
	}
	// Through a list and a Set: the possible match is reported beside the (absent) hit.
	path := filepath.Join(t.TempDir(), "consolidated.xml")
	_ = os.WriteFile(path, []byte(unXML), 0o600)
	l := &List{Sources: []string{path}}
	if err := l.Load(ctx); err != nil {
		t.Fatal(err)
	}
	r, err := Set{l}.ScreenName(ctx, "Exemplo Persona Sintetica")
	if err != nil || r.Hit || len(r.Possible) != 1 || !strings.Contains(r.Possible[0], "QDi.999") {
		t.Fatalf("%+v %v", r, err)
	}
	if r, _ := (Set{l}).ScreenName(ctx, "Examplo Persona Sintetica"); !r.Hit || len(r.Possible) != 0 {
		t.Fatalf("the listed name itself is a hit, not a possible match: %+v", r)
	}
	if r, _ := (Set{SandboxNames}).ScreenName(ctx, "Sandbox Sanctioned Persson"); r.Hit || len(r.Possible) != 1 {
		t.Fatalf("the sandbox's test name misspelled: %+v", r)
	}
	l.Now = func() time.Time { return time.Now().Add(100 * time.Hour) }
	if _, err := l.PossibleNames(ctx, "Exemplo Persona"); !errors.Is(err, ErrStale) {
		t.Fatalf("a stale list: %v", err)
	}
}
