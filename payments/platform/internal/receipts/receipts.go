// Package receipts issues the signed, gift-wrapped payment receipts of
// docs/03-nostr-layer.md §3 and publishes them to Nostr relays.
package receipts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// KindReceipt is the platform's receipt kind (provisional, docs/03 §2.1).
const KindReceipt = 7711

// Receipt is the data shown on a payment voucher. It never contains a PAN.
type Receipt struct {
	PaymentIntentID string
	MerchantID      string
	MerchantName    string
	MerchantCNPJ    string
	MerchantAddress string
	MerchantNIP05   string
	MerchantRootPub string // hex
	Amount          int64
	Currency        string
	Method          map[string]any // type, brand, funding, last4, application_label, aid, entry_mode, cvm, end_to_end_id
	Authorization   map[string]any // code, rrn, stan, terminal_id, approved_at
	Installments    int
	InstallmentType string // none, merchant, issuer
	SettlementDate  string // YYYY-MM-DD
	JournalEventID  string // device-signed journal entry for the same tap, if any
	RelayURL        string
	CreatedAt       time.Time
}

var forbidden = []string{"pan", "number", "track2", "cvc", "cvv", "pin"}

// Build returns the unsigned kind 7711 event with canonical JSON content.
func Build(r Receipt) (*nostr.Event, error) {
	for _, k := range forbidden {
		if _, bad := r.Method[k]; bad {
			return nil, fmt.Errorf("receipts: field %q must never appear on a receipt", k)
		}
	}
	if r.PaymentIntentID == "" || r.MerchantID == "" || r.Amount <= 0 {
		return nil, errors.New("receipts: payment intent, merchant and amount are required")
	}
	inst := r.InstallmentType
	if inst == "" {
		inst = "none"
	}
	count := r.Installments
	if count < 1 {
		count = 1
	}
	merchant := map[string]any{"id": r.MerchantID, "name": r.MerchantName}
	for k, v := range map[string]string{"cnpj": r.MerchantCNPJ, "address": r.MerchantAddress, "nip05": r.MerchantNIP05} {
		if v != "" {
			merchant[k] = v
		}
	}
	content := map[string]any{
		"v":                 1,
		"receipt_id":        "rcpt_" + trimPrefix(r.PaymentIntentID),
		"payment_intent_id": r.PaymentIntentID,
		"merchant":          merchant,
		"amount":            map[string]any{"value": r.Amount, "currency": r.Currency, "exponent": 2},
		"method":            r.Method,
		"installments":      map[string]any{"count": count, "type": inst},
		"settlement_date":   r.SettlementDate,
		"fiscal_note":       "Comprovante de pagamento. Não é documento fiscal.",
	}
	if r.Authorization != nil {
		content["authorization"] = r.Authorization
	}
	body, err := nostr.CanonicalJSON(content)
	if err != nil {
		return nil, err
	}
	tags := [][]string{{"merchant", r.MerchantRootPub}}
	if r.JournalEventID != "" {
		tags = append(tags, []string{"e", r.JournalEventID, r.RelayURL, "journal"})
	}
	created := r.CreatedAt
	if created.IsZero() {
		created = time.Now()
	}
	return &nostr.Event{CreatedAt: created.Unix(), Kind: KindReceipt, Tags: tags, Content: body}, nil
}

func trimPrefix(id string) string {
	for i := 0; i < len(id); i++ {
		if id[i] == '_' {
			return id[i+1:]
		}
	}
	return id
}

// Issued is a signed receipt and its deliveries.
type Issued struct {
	Receipt      *nostr.Event
	ClaimWrap    *nostr.Event // to the one-time claim key shown as a QR code
	MerchantWrap *nostr.Event // to the merchant's root key
	ClaimURL     string       // https://r.example/c#k=<claim secret>; the fragment never reaches a server
}

// Issuer signs receipts. In production the Author is the attested enclave signer.
type Issuer struct {
	Author      nostr.Author
	ClaimBase   string        // e.g. https://r.goonerspay.example/c
	ClaimExpiry time.Duration // NIP-40 expiration on claim wraps (default 90 days)
}

// Issue signs r and gift-wraps it to a fresh claim key and to the merchant root key.
func (is *Issuer) Issue(r Receipt) (Issued, error) {
	ev, err := Build(r)
	if err != nil {
		return Issued{}, err
	}
	if err := is.Author.SignEvent(ev, nil); err != nil {
		return Issued{}, err
	}
	claim, err := nostr.GenerateKeys()
	if err != nil {
		return Issued{}, err
	}
	exp := is.ClaimExpiry
	if exp == 0 {
		exp = 90 * 24 * time.Hour
	}
	_, cw, err := nostr.Wrap(ev, is.Author, claim.PubHex, nostr.WrapOptions{
		WrapTags: [][]string{{"expiration", strconv.FormatInt(time.Unix(ev.CreatedAt, 0).Add(exp).Unix(), 10)}},
	})
	if err != nil {
		return Issued{}, err
	}
	out := Issued{Receipt: ev, ClaimWrap: cw, ClaimURL: is.ClaimBase + "#k=" + claim.SecretHex()}
	if r.MerchantRootPub != "" {
		_, mw, err := nostr.Wrap(ev, is.Author, r.MerchantRootPub, nostr.WrapOptions{})
		if err != nil {
			return Issued{}, err
		}
		out.MerchantWrap = mw
	}
	return out, nil
}

// Publisher sends events to relays and waits for NIP-01 OK acknowledgements.
type Publisher struct {
	Relays  []string
	MinAcks int // relays that must accept every event (default 2, or all if fewer)
	Timeout time.Duration
}

// Publish returns the number of relays that accepted every event.
func (p *Publisher) Publish(ctx context.Context, events ...*nostr.Event) (int, error) {
	timeout := p.Timeout
	if timeout == 0 {
		timeout = 5 * time.Second
	}
	need := p.MinAcks
	if need == 0 {
		need = 2
	}
	if need > len(p.Relays) {
		need = len(p.Relays)
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	acks := 0
	var lastErr error
	for _, url := range p.Relays {
		wg.Add(1)
		go func(url string) {
			defer wg.Done()
			c, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()
			err := publishOne(c, url, events)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				lastErr = fmt.Errorf("%s: %w", url, err)
				return
			}
			acks++
		}(url)
	}
	wg.Wait()
	if acks < need {
		return acks, fmt.Errorf("receipts: %d of %d required relays acknowledged: %v", acks, need, lastErr)
	}
	return acks, nil
}

func publishOne(ctx context.Context, url string, events []*nostr.Event) error {
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		return err
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	pending := map[string]bool{}
	for _, ev := range events {
		msg, _ := json.Marshal([]any{"EVENT", ev})
		if err := conn.Write(ctx, websocket.MessageText, msg); err != nil {
			return err
		}
		pending[ev.ID] = true
	}
	for len(pending) > 0 {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		var frame []json.RawMessage
		if json.Unmarshal(data, &frame) != nil || len(frame) < 3 {
			continue
		}
		var typ, id string
		var ok bool
		_ = json.Unmarshal(frame[0], &typ)
		if typ != "OK" {
			continue
		}
		_ = json.Unmarshal(frame[1], &id)
		_ = json.Unmarshal(frame[2], &ok)
		if !pending[id] {
			continue
		}
		if !ok {
			reason := ""
			if len(frame) > 3 {
				_ = json.Unmarshal(frame[3], &reason)
			}
			return fmt.Errorf("relay rejected %s: %s", id, reason)
		}
		delete(pending, id)
	}
	return nil
}
