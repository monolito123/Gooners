package pixsim_test

import (
	"context"
	"crypto/tls"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/pixout"
	"github.com/monolito123/Gooners/payments/platform/internal/pixsim"
	"github.com/monolito123/Gooners/payments/platform/internal/testpki"
	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
	"github.com/monolito123/Gooners/payments/platform/pkg/brcode"
)

const key = "12345678000195"

type world struct {
	client   *apipix.Client
	pspURL   string
	sim      *pixsim.Sim
	received chan apipix.Pix
	hookURL  string
	ca       *testpki.CA
	platCert *testpki.Leaf
}

// Two mTLS servers: the PSP (verifies the platform's client cert) and the platform's
// webhook receiver (verifies the PSP's client cert), as API Pix requires.
func newWorld(t *testing.T) *world {
	t.Helper()
	ca, _ := testpki.NewCA("test-ca")
	pspServer, _ := ca.Server("psp", "127.0.0.1")
	pspClient, _ := ca.Client("psp-webhook-caller")
	platServer, _ := ca.Server("platform", "127.0.0.1")
	platClient, _ := ca.Client("platform")

	w := &world{received: make(chan apipix.Pix, 10), ca: ca, platCert: platClient}
	hook := httptest.NewUnstartedServer(http.NewServeMux())
	mux := http.NewServeMux()
	var mu sync.Mutex
	seen := map[string]bool{}
	mux.Handle("/hooks/pix", apipix.WebhookHandler(func(_ context.Context, p apipix.Pix) error {
		mu.Lock()
		defer mu.Unlock()
		if !seen[p.EndToEndID+p.Valor+devStatus(p)] {
			seen[p.EndToEndID+p.Valor+devStatus(p)] = true
			w.received <- p
		}
		return nil
	}, nil))
	hook.Config.Handler = mux
	hook.TLS = &tls.Config{Certificates: []tls.Certificate{platServer.TLS}, ClientCAs: ca.Pool(), ClientAuth: tls.RequireAndVerifyClientCert, MinVersion: tls.VersionTLS12}
	hook.StartTLS()
	t.Cleanup(hook.Close)
	w.hookURL = hook.URL + "/hooks"

	w.sim = pixsim.New(pixsim.Config{ClientID: "plat", ClientSecret: "s3cret", Keys: []string{key}, FailKey: "fail@example.com",
		WebhookTLS: &tls.Config{Certificates: []tls.Certificate{pspClient.TLS}, RootCAs: ca.Pool()}})
	psp := httptest.NewUnstartedServer(w.sim.Handler())
	psp.TLS = &tls.Config{Certificates: []tls.Certificate{pspServer.TLS}, ClientCAs: ca.Pool(), ClientAuth: tls.RequireAndVerifyClientCert}
	psp.StartTLS()
	t.Cleanup(psp.Close)
	w.pspURL = psp.URL

	w.client = apipix.New(apipix.Config{
		BaseURL: psp.URL + "/api/v2", TokenURL: psp.URL + "/oauth/token", ClientID: "plat", ClientSecret: "s3cret",
		Scopes: []string{"cob.write", "cob.read", "pix.read", "pix.write", "webhook.write"},
		TLS:    &tls.Config{Certificates: []tls.Certificate{platClient.TLS}, RootCAs: ca.Pool(), MinVersion: tls.VersionTLS13},
	})
	return w
}

func devStatus(p apipix.Pix) string {
	if len(p.Devolucoes) == 0 {
		return ""
	}
	return p.Devolucoes[len(p.Devolucoes)-1].Status
}

func (w *world) control(t *testing.T, path string) {
	t.Helper()
	hc := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{Certificates: []tls.Certificate{w.platCert.TLS}, RootCAs: w.ca.Pool()}}}
	resp, err := hc.Post(w.pspURL+path, "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("%s: HTTP %d", path, resp.StatusCode)
	}
}

func TestChargePayWebhookRefund(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	if err := w.client.ConfigureWebhook(ctx, key, w.hookURL); err != nil {
		t.Fatal(err)
	}
	txid := apipix.NewTxID()
	cob, err := w.client.CreateCob(ctx, txid, apipix.CobRequest{
		Calendario: apipix.Calendario{Expiracao: 1800}, Valor: apipix.Valor{Original: apipix.FormatValor(12990)}, Chave: key, SolicitacaoPagador: "Pedido 8812",
	})
	if err != nil {
		t.Fatal(err)
	}
	if cob.Status != apipix.CobAtiva || cob.Loc == nil {
		t.Fatalf("cob %+v", cob)
	}
	qr, err := brcode.Decode(cob.PixCopiaECola)
	if err != nil || !qr.Dynamic || qr.URL != cob.Location {
		t.Fatalf("pixCopiaECola does not decode to the location: %+v %v", qr, err)
	}

	w.control(t, "/sim/pagar/"+txid)
	var got apipix.Pix
	select {
	case got = <-w.received:
	case <-time.After(3 * time.Second):
		t.Fatal("webhook not received")
	}
	if got.TxID != txid || got.Valor != "129.90" || !apipix.ValidEndToEndID(got.EndToEndID) {
		t.Fatalf("webhook pix %+v", got)
	}
	confirmed, err := w.client.GetPix(ctx, got.EndToEndID)
	if err != nil || confirmed.Valor != "129.90" {
		t.Fatalf("GetPix: %+v %v", confirmed, err)
	}
	after, _ := w.client.GetCob(ctx, txid)
	if after.Status != apipix.CobConcluida {
		t.Fatalf("charge status %s", after.Status)
	}

	dev, err := w.client.Devolver(ctx, got.EndToEndID, "re01", apipix.DevolucaoRequest{Valor: "49.90", Natureza: "ORIGINAL"})
	if err != nil || dev.Status != apipix.DevolucaoEmProcessamento || len(dev.RtrID) != 32 {
		t.Fatalf("devolução: %+v %v", dev, err)
	}
	again, err := w.client.Devolver(ctx, got.EndToEndID, "re01", apipix.DevolucaoRequest{Valor: "49.90"})
	if err != nil || again.RtrID != dev.RtrID {
		t.Fatal("devolução with the same id must be idempotent")
	}
	if _, err := w.client.Devolver(ctx, got.EndToEndID, "re02", apipix.DevolucaoRequest{Valor: "90.00"}); err == nil {
		t.Fatal("refunding more than received must fail")
	}
	w.control(t, "/sim/devolucao/"+got.EndToEndID+"/re01/liquidar")
	select {
	case p := <-w.received:
		if devStatus(p) != apipix.DevolucaoDevolvido {
			t.Fatalf("devolução webhook status %q", devStatus(p))
		}
	case <-time.After(3 * time.Second):
		t.Fatal("devolução webhook not received")
	}
}

func TestProblemDetails(t *testing.T) {
	w := newWorld(t)
	_, err := w.client.CreateCob(context.Background(), apipix.NewTxID(), apipix.CobRequest{Valor: apipix.Valor{Original: "1.00"}, Chave: "someone-else@example.com"})
	var pe *apipix.Error
	if !errors.As(err, &pe) || pe.Status != 400 || len(pe.Violacoes) == 0 || pe.Violacoes[0].Propriedade != "cob.chave" {
		t.Fatalf("want a 400 with violacoes, got %v", err)
	}
	if _, err := w.client.GetPix(context.Background(), "E99999999202610291742aaaaaaaaaaa"); !apipix.IsNotFound(err) {
		t.Fatalf("want 404, got %v", err)
	}
	if _, err := w.client.CreateCob(context.Background(), "short", apipix.CobRequest{}); err == nil {
		t.Fatal("invalid txid accepted client-side")
	}
}

func TestWebhookRequiresMutualTLS(t *testing.T) {
	h := apipix.WebhookHandler(func(context.Context, apipix.Pix) error { return nil }, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/pix", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("plain request got %d", rec.Code)
	}
}

func TestTransfers(t *testing.T) {
	w := newWorld(t)
	sender := pixout.NewHTTPSender(pixout.HTTPConfig{
		BaseURL: w.pspURL + "/api/v2",
		Token: func(ctx context.Context) (string, error) {
			// reuse the API Pix OAuth flow of the same PSP
			c := apipix.New(apipix.Config{BaseURL: w.pspURL + "/api/v2", TokenURL: w.pspURL + "/oauth/token", ClientID: "plat", ClientSecret: "s3cret",
				TLS: &tls.Config{Certificates: []tls.Certificate{w.platCert.TLS}, RootCAs: w.ca.Pool()}})
			return c.Token(ctx)
		},
		TLS: &tls.Config{Certificates: []tls.Certificate{w.platCert.TLS}, RootCAs: w.ca.Pool()},
	})
	ctx := context.Background()
	res, err := sender.Send(ctx, pixout.Transfer{IdempotencyKey: "po_1", Amount: 397813, KeyType: "CNPJ", Key: key})
	if err != nil || res.Status != pixout.StatusDone || len(res.EndToEndID) != 32 {
		t.Fatalf("send: %+v %v", res, err)
	}
	dup, err := sender.Send(ctx, pixout.Transfer{IdempotencyKey: "po_1", Amount: 397813, KeyType: "CNPJ", Key: key})
	if err != nil || dup.EndToEndID != res.EndToEndID {
		t.Fatal("resending the same idempotency key must return the same transfer")
	}
	failed, err := sender.Send(ctx, pixout.Transfer{IdempotencyKey: "po_2", Amount: 100, KeyType: "EMAIL", Key: "fail@example.com"})
	if err != nil || failed.Status != pixout.StatusFailed {
		t.Fatalf("failing destination: %+v %v", failed, err)
	}
	got, err := sender.Get(ctx, "po_1")
	if err != nil || got.Status != pixout.StatusDone {
		t.Fatalf("get: %+v %v", got, err)
	}
}
