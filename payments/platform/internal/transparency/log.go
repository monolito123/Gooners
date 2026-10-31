package transparency

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

const (
	// KindStatement is the daily settlement statement (docs/03 §2.1).
	KindStatement = 7713
	// KindRoot is the public settlement transparency root.
	KindRoot = 7715
	// LogName names the log in every root.
	LogName = "goonerspay-settlement-v1"
	// DefaultPadTo is the production tree size granularity (docs/03 §6.4).
	DefaultPadTo = 4096
	leafPrefix   = "goonerspay/v1/statement-leaf"
	receiptsTree = "rfc6962-sha256, leaves = receipt event ids (32 bytes) in capture order"
)

// Line is one receipt of a statement.
type Line struct {
	ReceiptEventID string `json:"receipt_event_id"`
	Amount         int64  `json:"amount"`
	Fee            int64  `json:"fee"`
	Settles        string `json:"settles"` // instant, standard, per_installment
}

// Totals are a statement's day totals. Net = gross − fees − refunds − chargebacks.
type Totals struct {
	Gross       int64 `json:"gross"`
	Fees        int64 `json:"fees"`
	Refunds     int64 `json:"refunds"`
	Chargebacks int64 `json:"chargebacks"`
	Net         int64 `json:"net"`
}

// Statement is one merchant's day before it is committed to the log.
type Statement struct {
	MerchantID  string
	Date        string // YYYY-MM-DD, Brasília business day
	Currency    string
	Lines       []Line // in capture order
	Refunds     int64
	Chargebacks int64
}

// Body is the committed statement body (docs/03 §6.2) as canonical-JSON-ready values.
func (s Statement) Body() (map[string]any, error) {
	leaves, err := s.receiptLeaves()
	if err != nil {
		return nil, err
	}
	var gross, fees int64
	lines := make([]any, len(s.Lines))
	for i, l := range s.Lines {
		gross += l.Amount
		fees += l.Fee
		lines[i] = map[string]any{"receipt_event_id": l.ReceiptEventID, "amount": l.Amount, "fee": l.Fee, "settles": l.Settles}
	}
	return map[string]any{
		"v":             1,
		"merchant_id":   s.MerchantID,
		"date":          s.Date,
		"currency":      s.Currency,
		"totals":        map[string]any{"gross": gross, "fees": fees, "refunds": s.Refunds, "chargebacks": s.Chargebacks, "net": gross - fees - s.Refunds - s.Chargebacks},
		"count":         len(s.Lines),
		"receipts_root": hex.EncodeToString(MTH(leaves)),
		"receipts_tree": receiptsTree,
		"lines":         lines,
	}, nil
}

func (s Statement) receiptLeaves() ([][]byte, error) {
	out := make([][]byte, len(s.Lines))
	for i, l := range s.Lines {
		b, err := hex.DecodeString(l.ReceiptEventID)
		if err != nil || len(b) != 32 {
			return nil, fmt.Errorf("transparency: receipt event id %q is not 32-byte hex", l.ReceiptEventID)
		}
		out[i] = b
	}
	return out, nil
}

// Commitment is SHA-256 of the body's canonical JSON.
func Commitment(body map[string]any) (string, error) {
	c, err := nostr.CanonicalJSON(body)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256([]byte(c))
	return hex.EncodeToString(h[:]), nil
}

// LeafData is "goonerspay/v1/statement-leaf" ‖ salt ‖ commitment.
func LeafData(saltHex, commitmentHex string) ([]byte, error) {
	salt, err1 := hex.DecodeString(saltHex)
	c, err2 := hex.DecodeString(commitmentHex)
	if err1 != nil || err2 != nil || len(salt) != 32 || len(c) != 32 {
		return nil, errors.New("transparency: salt and commitment are 32-byte hex")
	}
	return append(append([]byte(leafPrefix), salt...), c...), nil
}

// Log is one day's tree: leaves sorted by leaf hash, so a position reveals nothing.
type Log struct {
	Leaves [][]byte
	Root   []byte
}

// BuildLog sorts the statement leaves together with random dummy leaves that pad the tree
// to a multiple of padTo (docs/03 §6.4). Dummies have the length of a real leaf.
func BuildLog(leaves [][]byte, padTo int) (*Log, error) {
	if padTo < 1 {
		padTo = DefaultPadTo
	}
	all := append([][]byte(nil), leaves...)
	size := (len(all) + padTo - 1) / padTo * padTo
	if size == 0 {
		size = padTo
	}
	for len(all) < size {
		d := make([]byte, len(leafPrefix)+64)
		if _, err := rand.Read(d); err != nil {
			return nil, err
		}
		all = append(all, d)
	}
	return SortedLog(all), nil
}

// SortedLog orders leaves by SHA-256(leaf), as docs/03 §6.2 specifies, and computes the root.
func SortedLog(leaves [][]byte) *Log {
	type item struct {
		data []byte
		h    [32]byte
	}
	items := make([]item, len(leaves))
	for i, l := range leaves {
		items[i] = item{l, sha256.Sum256(l)}
	}
	sort.Slice(items, func(a, b int) bool { return bytes.Compare(items[a].h[:], items[b].h[:]) < 0 })
	out := &Log{Leaves: make([][]byte, len(items))}
	for i, it := range items {
		out.Leaves[i] = it.data
	}
	out.Root = MTH(out.Leaves)
	return out
}

// Index finds a leaf in the log.
func (l *Log) Index(leaf []byte) int {
	for i, x := range l.Leaves {
		if bytes.Equal(x, leaf) {
			return i
		}
	}
	return -1
}

// RootEvent is the unsigned kind 7715 root for date, chained to the previous root.
func RootEvent(date string, l *Log, prevEventID, relay, padding string, at time.Time) (*nostr.Event, error) {
	var prev any
	tags := [][]string{{"log", LogName}, {"date", date}}
	if prevEventID != "" {
		prev = prevEventID
		tags = append(tags, []string{"e", prevEventID, relay, "prev"})
	}
	content, err := nostr.CanonicalJSON(map[string]any{
		"v": 1, "log": LogName, "date": date, "tree_size": len(l.Leaves), "root": hex.EncodeToString(l.Root), "prev": prev, "padding": padding,
	})
	if err != nil {
		return nil, err
	}
	return &nostr.Event{CreatedAt: at.Unix(), Kind: KindRoot, Tags: tags, Content: content}, nil
}

// Padding describes the padding rule in the root's content.
func Padding(padTo int) string {
	return "dummy leaves to a multiple of " + strconv.Itoa(padTo)
}

// StatementEvent is the unsigned kind 7713: the body, its commitment and where its leaf
// sits in the day's log.
func StatementEvent(body map[string]any, commitment, saltHex string, rootEventID string, index int, l *Log,
	merchantRootPub, relay string, at time.Time) (*nostr.Event, error) {
	content := make(map[string]any, len(body)+2)
	for k, v := range body {
		content[k] = v
	}
	content["statement_commitment"] = commitment
	content["transparency"] = map[string]any{
		"root_event_id": rootEventID, "leaf_salt": saltHex, "leaf_index": index, "tree_size": len(l.Leaves),
		"audit_path": anySlice(HexPath(AuditPath(index, l.Leaves))),
	}
	c, err := nostr.CanonicalJSON(content)
	if err != nil {
		return nil, err
	}
	tags := [][]string{{"merchant", merchantRootPub}, {"e", rootEventID, relay, "transparency"}}
	return &nostr.Event{CreatedAt: at.Unix(), Kind: KindStatement, Tags: tags, Content: c}, nil
}

func anySlice(s []string) []any {
	out := make([]any, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}
