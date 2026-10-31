package transparency

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// The specification's examples (generated in JavaScript) are reproduced here byte for byte.

func load(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "nostr", "examples", name))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func det(label string) []byte {
	h := sha256.Sum256([]byte("goonerspay-spec/det/" + label))
	return h[:]
}

func aux(label string) *[32]byte { var a [32]byte; copy(a[:], det("aux/"+label)); return &a }

func testKey(t *testing.T, role string) nostr.Keys {
	h := sha256.Sum256([]byte("goonerspay-spec/test-key/" + role))
	k, err := nostr.KeysFromSecret(h[:])
	if err != nil {
		t.Fatal(err)
	}
	return k
}

type statementContent struct {
	MerchantID   string `json:"merchant_id"`
	Date         string `json:"date"`
	Currency     string `json:"currency"`
	Totals       Totals `json:"totals"`
	Lines        []Line `json:"lines"`
	Commitment   string `json:"statement_commitment"`
	Transparency struct {
		RootEventID string   `json:"root_event_id"`
		Salt        string   `json:"leaf_salt"`
		Index       int      `json:"leaf_index"`
		TreeSize    int      `json:"tree_size"`
		AuditPath   []string `json:"audit_path"`
	} `json:"transparency"`
}

func TestReproducesTheSpecStatementAndRoot(t *testing.T) {
	var stmt, root, genesis nostr.Event
	load(t, "7713-settlement-statement.json", &stmt)
	load(t, "7715-transparency-root.json", &root)
	load(t, "7715-transparency-root-2026-10-28.json", &genesis)
	var c statementContent
	if err := json.Unmarshal([]byte(stmt.Content), &c); err != nil {
		t.Fatal(err)
	}
	s := Statement{MerchantID: c.MerchantID, Date: c.Date, Currency: c.Currency, Lines: c.Lines, Refunds: c.Totals.Refunds, Chargebacks: c.Totals.Chargebacks}
	body, err := s.Body()
	if err != nil {
		t.Fatal(err)
	}
	commitment, err := Commitment(body)
	if err != nil || commitment != c.Commitment {
		t.Fatalf("commitment %s, want %s (%v)", commitment, c.Commitment, err)
	}
	if body["totals"].(map[string]any)["net"].(int64) != c.Totals.Net {
		t.Fatalf("net %v, want %d", body["totals"], c.Totals.Net)
	}

	// The day's log: seven dummies and our leaf, sorted by hash.
	leaf, err := LeafData(c.Transparency.Salt, commitment)
	if err != nil {
		t.Fatal(err)
	}
	leaves := [][]byte{leaf}
	for i := 0; i < 7; i++ {
		leaves = append(leaves, det("dummy/2026-10-29/"+itoa(i)))
	}
	l := SortedLog(leaves)
	if l.Index(leaf) != c.Transparency.Index || len(l.Leaves) != c.Transparency.TreeSize {
		t.Fatalf("leaf at %d of %d, want %d of %d", l.Index(leaf), len(l.Leaves), c.Transparency.Index, c.Transparency.TreeSize)
	}
	if got := HexPath(AuditPath(l.Index(leaf), l.Leaves)); !equal(got, c.Transparency.AuditPath) {
		t.Fatalf("audit path %v, want %v", got, c.Transparency.AuditPath)
	}

	// The signed root, chained to the genesis root, and the signed statement.
	tk := testKey(t, "platform-transparency")
	padding := "dummy leaves to a multiple of 8 (production: 4096)"
	re, err := RootEvent("2026-10-29", l, genesis.ID, root.Tags[2][2], padding, time.Unix(root.CreatedAt, 0))
	if err != nil {
		t.Fatal(err)
	}
	if err := re.Sign(tk, aux("root-2026-10-29")); err != nil {
		t.Fatal(err)
	}
	if re.ID != root.ID || re.Sig != root.Sig {
		t.Fatalf("root event differs:\n%s\n%s", re.Content, root.Content)
	}
	se, err := StatementEvent(body, commitment, c.Transparency.Salt, re.ID, l.Index(leaf), l, stmt.Tags[0][1], stmt.Tags[1][2], time.Unix(stmt.CreatedAt, 0))
	if err != nil {
		t.Fatal(err)
	}
	if err := se.Sign(testKey(t, "platform-receipts"), aux("statement")); err != nil {
		t.Fatal(err)
	}
	if se.ID != stmt.ID || se.Sig != stmt.Sig {
		t.Fatalf("statement event differs:\n%s\n%s", se.Content, stmt.Content)
	}

	// The genesis root has no prev.
	gl := SortedLog(func() [][]byte {
		var d [][]byte
		for i := 0; i < 8; i++ {
			d = append(d, det("dummy/2026-10-28/"+itoa(i)))
		}
		return d
	}())
	ge, _ := RootEvent("2026-10-28", gl, "", "", padding, time.Unix(genesis.CreatedAt, 0))
	_ = ge.Sign(tk, aux("root-2026-10-28"))
	if ge.ID != genesis.ID {
		t.Fatalf("genesis root differs:\n%s\n%s", ge.Content, genesis.Content)
	}
}

func TestSpecProofVerifies(t *testing.T) {
	var proof struct {
		Receipt   string `json:"receipt_event_id"`
		Statement struct {
			Index, Size int
			Path        []string `json:"audit_path"`
			Root        string
		} `json:"statement_inclusion"`
	}
	b, _ := os.ReadFile(filepath.Join("..", "..", "..", "nostr", "examples", "proof-receipt-0.json"))
	var raw map[string]map[string]any
	_ = json.Unmarshal(b, &raw)
	_ = json.Unmarshal(b, &proof)
	si := raw["statement_inclusion"]
	path, err := ParsePath(toStrings(si["audit_path"]))
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := hex.DecodeString(proof.Receipt)
	root, _ := hex.DecodeString(si["root"].(string))
	if !VerifyInclusion(leaf, int(si["leaf_index"].(float64)), int(si["tree_size"].(float64)), path, root) {
		t.Fatal("the spec's receipt proof does not verify")
	}
	if VerifyInclusion(leaf, 1, int(si["tree_size"].(float64)), path, root) {
		t.Fatal("a proof verified at the wrong index")
	}
}

// Every leaf of trees of many sizes proves its inclusion, and only its own.
func TestInclusionProofsForManySizes(t *testing.T) {
	for n := 1; n <= 33; n++ {
		var leaves [][]byte
		for i := 0; i < n; i++ {
			leaves = append(leaves, det("leaf/"+itoa(n)+"/"+itoa(i)))
		}
		root := MTH(leaves)
		for i := range leaves {
			p := AuditPath(i, leaves)
			if !VerifyInclusion(leaves[i], i, n, p, root) {
				t.Fatalf("n=%d leaf %d does not verify", n, i)
			}
			if n > 1 && VerifyInclusion(leaves[(i+1)%n], i, n, p, root) {
				t.Fatalf("n=%d leaf %d verified another leaf", n, i)
			}
		}
	}
}

func TestBuildLogPadsAndHidesOrder(t *testing.T) {
	a, _ := LeafData(hex.EncodeToString(det("s1")), hex.EncodeToString(det("c1")))
	b, _ := LeafData(hex.EncodeToString(det("s2")), hex.EncodeToString(det("c2")))
	l, err := BuildLog([][]byte{a, b}, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Leaves) != 8 || l.Index(a) < 0 || l.Index(b) < 0 {
		t.Fatalf("log of %d leaves, a at %d, b at %d", len(l.Leaves), l.Index(a), l.Index(b))
	}
	for _, x := range l.Leaves {
		if len(x) != len(a) {
			t.Fatal("a dummy leaf has a different length from a real one")
		}
	}
	empty, _ := BuildLog(nil, 8)
	if len(empty.Leaves) != 8 {
		t.Fatalf("an empty day has %d leaves", len(empty.Leaves))
	}
	nine, _ := BuildLog(make([][]byte, 9), 8)
	if len(nine.Leaves) != 16 {
		t.Fatalf("9 leaves padded to %d", len(nine.Leaves))
	}
}

func itoa(i int) string { return strconv.Itoa(i) }

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func toStrings(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}
