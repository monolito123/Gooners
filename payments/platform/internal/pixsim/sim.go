// Package pixsim simulates a PSP for Pix: the Banco Central's API Pix standard for
// receiving (OAuth2, cob, pix, devolução, webhook with mutual TLS) plus the generic
// partner-bank transfer contract used by internal/pixout. It is what the platform is
// tested against before a real bank's homologation (sandbox) environment.
//
// Control endpoints (not part of any standard) drive scenarios:
//
//	POST /sim/pagar/{txid}                    a payer pays an ATIVA charge → webhook
//	POST /sim/devolucao/{e2eid}/{id}/liquidar settle a devolução → webhook
package pixsim

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/monolito123/Gooners/payments/platform/pkg/apipix"
	"github.com/monolito123/Gooners/payments/platform/pkg/brcode"
)

// Config of the simulator.
type Config struct {
	ClientID, ClientSecret string
	Keys                   []string // Pix keys owned by the simulated receiving user
	ISPB                   string   // 8 digits, used in endToEndIds
	LocationHost           string   // host used in payload locations, e.g. pix.sim.example
	MerchantName           string
	MerchantCity           string
	// WebhookTLS is the client configuration used to call the user's webhook (mutual TLS).
	WebhookTLS *tls.Config
	// FailKey makes transfers to this key end NAO_REALIZADO.
	FailKey string
	Logger  *slog.Logger
	Now     func() time.Time
}

// Sim is an in-memory PSP.
type Sim struct {
	cfg      Config
	mu       sync.Mutex
	tokens   map[string]time.Time
	cobs     map[string]*apipix.Cob
	pix      map[string]*apipix.Pix
	webhooks map[string]string // chave → webhookUrl
	xfers    map[string]map[string]string
	locID    int64
	hc       *http.Client
	// Deliveries counts successful webhook calls (tests).
	Deliveries int
}

// New returns a simulator.
func New(cfg Config) *Sim {
	if cfg.ISPB == "" {
		cfg.ISPB = "99999999"
	}
	if cfg.LocationHost == "" {
		cfg.LocationHost = "pix.sim.example"
	}
	if cfg.MerchantName == "" {
		cfg.MerchantName = "CAFE AURORA"
	}
	if cfg.MerchantCity == "" {
		cfg.MerchantCity = "SAO PAULO"
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = cfg.WebhookTLS
	return &Sim{cfg: cfg, tokens: map[string]time.Time{}, cobs: map[string]*apipix.Cob{}, pix: map[string]*apipix.Pix{},
		webhooks: map[string]string{}, xfers: map[string]map[string]string{}, hc: &http.Client{Transport: tr, Timeout: 10 * time.Second}}
}

// Handler serves the PSP API under /api/v2, OAuth at /oauth/token and control under /sim.
func (s *Sim) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth/token", s.token)
	api := func(pattern string, h http.HandlerFunc) { mux.HandleFunc(pattern, s.auth(h)) }
	api("PUT /api/v2/cob/{txid}", s.putCob)
	api("GET /api/v2/cob/{txid}", s.getCob)
	api("GET /api/v2/pix/{e2eid}", s.getPix)
	api("PUT /api/v2/pix/{e2eid}/devolucao/{id}", s.putDevolucao)
	api("GET /api/v2/pix/{e2eid}/devolucao/{id}", s.getDevolucao)
	api("PUT /api/v2/webhook/{chave}", s.putWebhook)
	api("GET /api/v2/webhook/{chave}", s.getWebhook)
	api("POST /api/v2/pagamentos/pix", s.postTransfer)
	api("GET /api/v2/pagamentos/pix/{id}", s.getTransfer)
	mux.HandleFunc("POST /sim/pagar/{txid}", s.simPay)
	mux.HandleFunc("POST /sim/devolucao/{e2eid}/{id}/liquidar", s.simSettleDevolucao)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func problem(w http.ResponseWriter, code int, typ, title, detail string, v ...apipix.Violacao) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(apipix.Error{Status: code, Type: "https://pix.bcb.gov.br/api/v2/error/" + typ, Title: title, Detail: detail, Violacoes: v})
}

func (s *Sim) token(w http.ResponseWriter, r *http.Request) {
	id, secret, ok := r.BasicAuth()
	if !ok {
		_ = r.ParseForm()
		id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	if id != s.cfg.ClientID || secret != s.cfg.ClientSecret {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_client"})
		return
	}
	tok := randHex(24)
	s.mu.Lock()
	s.tokens[tok] = s.cfg.Now().Add(time.Hour)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"access_token": tok, "token_type": "Bearer", "expires_in": 3600, "scope": r.PostFormValue("scope")})
}

func (s *Sim) auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		s.mu.Lock()
		exp, ok := s.tokens[tok]
		s.mu.Unlock()
		if !ok || s.cfg.Now().After(exp) {
			problem(w, http.StatusUnauthorized, "AcessoNegado", "Não autorizado", "token ausente ou expirado")
			return
		}
		h(w, r)
	}
}

func (s *Sim) ownsKey(k string) bool {
	for _, own := range s.cfg.Keys {
		if own == k {
			return true
		}
	}
	return false
}

func (s *Sim) putCob(w http.ResponseWriter, r *http.Request) {
	txid := r.PathValue("txid")
	var req apipix.CobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		problem(w, http.StatusBadRequest, "CobPayloadNaoRespeitaSchema", "Payload inválido", err.Error())
		return
	}
	switch {
	case !apipix.ValidTxID(txid):
		problem(w, http.StatusBadRequest, "CobOperacaoInvalida", "Cobrança inválida", "txid inválido", apipix.Violacao{Razao: "txid deve ter 26 a 35 caracteres alfanuméricos", Propriedade: "txid"})
		return
	case !s.ownsKey(req.Chave):
		problem(w, http.StatusBadRequest, "CobOperacaoInvalida", "Cobrança inválida", "a chave não pertence ao usuário recebedor", apipix.Violacao{Razao: "chave não pertence ao usuário", Propriedade: "cob.chave"})
		return
	}
	if _, err := apipix.ParseValor(req.Valor.Original); err != nil {
		problem(w, http.StatusBadRequest, "CobOperacaoInvalida", "Cobrança inválida", err.Error(), apipix.Violacao{Razao: "valor inválido", Propriedade: "cob.valor.original"})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.cobs[txid]; ok && old.Status != apipix.CobAtiva {
		problem(w, http.StatusBadRequest, "CobOperacaoInvalida", "Cobrança inválida", "cobrança não está ATIVA")
		return
	}
	s.locID++
	now := s.cfg.Now().UTC().Format(time.RFC3339)
	location := fmt.Sprintf("%s/qr/v2/%s", s.cfg.LocationHost, randHex(16))
	code, _ := brcode.Encode(brcode.Payload{Dynamic: true, URL: location, MerchantName: s.cfg.MerchantName, MerchantCity: s.cfg.MerchantCity})
	exp := req.Calendario.Expiracao
	if exp == 0 {
		exp = 86400
	}
	cob := &apipix.Cob{
		Calendario: apipix.Calendario{Criacao: now, Expiracao: exp}, TxID: txid, Revisao: 0,
		Loc: &apipix.Loc{ID: s.locID, Location: location, TipoCob: "cob", Criacao: now}, Location: location, Status: apipix.CobAtiva,
		Devedor: req.Devedor, Valor: req.Valor, Chave: req.Chave, SolicitacaoPagador: req.SolicitacaoPagador, InfoAdicionais: req.InfoAdicionais,
		PixCopiaECola: code,
	}
	s.cobs[txid] = cob
	writeJSON(w, http.StatusCreated, cob)
}

func (s *Sim) getCob(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	cob, ok := s.cobs[r.PathValue("txid")]
	var c apipix.Cob
	if ok {
		c = *cob
	}
	s.mu.Unlock()
	if !ok {
		problem(w, http.StatusNotFound, "CobNaoEncontrado", "Cobrança não encontrada", "txid desconhecido")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Sim) getPix(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	p, ok := s.pix[r.PathValue("e2eid")]
	var c apipix.Pix
	if ok {
		c = *p
	}
	s.mu.Unlock()
	if !ok {
		problem(w, http.StatusNotFound, "PixNaoEncontrado", "Pix não encontrado", "endToEndId desconhecido")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Sim) putDevolucao(w http.ResponseWriter, r *http.Request) {
	e2e, id := r.PathValue("e2eid"), r.PathValue("id")
	var req apipix.DevolucaoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		problem(w, http.StatusBadRequest, "DevolucaoPayloadNaoRespeitaSchema", "Payload inválido", err.Error())
		return
	}
	amount, err := apipix.ParseValor(req.Valor)
	if err != nil {
		problem(w, http.StatusBadRequest, "DevolucaoOperacaoInvalida", "Devolução inválida", err.Error())
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.pix[e2e]
	if !ok {
		problem(w, http.StatusNotFound, "PixNaoEncontrado", "Pix não encontrado", "endToEndId desconhecido")
		return
	}
	for _, d := range p.Devolucoes {
		if d.ID == id {
			writeJSON(w, http.StatusCreated, d) // idempotent: same id, same devolução
			return
		}
	}
	original, _ := apipix.ParseValor(p.Valor)
	var refunded int64
	for _, d := range p.Devolucoes {
		if d.Status != apipix.DevolucaoNaoRealizado {
			v, _ := apipix.ParseValor(d.Valor)
			refunded += v
		}
	}
	if refunded+amount > original {
		problem(w, http.StatusBadRequest, "DevolucaoOperacaoInvalida", "Devolução inválida", "valor excede o saldo disponível para devolução")
		return
	}
	d := apipix.Devolucao{ID: id, RtrID: s.e2e("D"), Valor: req.Valor, Natureza: req.Natureza, Descricao: req.Descricao, Status: apipix.DevolucaoEmProcessamento}
	d.Horario.Solicitacao = s.cfg.Now().UTC().Format(time.RFC3339)
	p.Devolucoes = append(p.Devolucoes, d)
	writeJSON(w, http.StatusCreated, d)
}

func (s *Sim) getDevolucao(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.pix[r.PathValue("e2eid")]; ok {
		for _, d := range p.Devolucoes {
			if d.ID == r.PathValue("id") {
				writeJSON(w, http.StatusOK, d)
				return
			}
		}
	}
	problem(w, http.StatusNotFound, "DevolucaoNaoEncontrada", "Devolução não encontrada", "")
}

func (s *Sim) putWebhook(w http.ResponseWriter, r *http.Request) {
	var cfg apipix.WebhookConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil || !strings.HasPrefix(cfg.WebhookURL, "https://") {
		problem(w, http.StatusBadRequest, "WebhookOperacaoInvalida", "Webhook inválido", "webhookUrl deve ser https")
		return
	}
	chave := r.PathValue("chave")
	if !s.ownsKey(chave) {
		problem(w, http.StatusBadRequest, "WebhookOperacaoInvalida", "Webhook inválido", "a chave não pertence ao usuário recebedor")
		return
	}
	s.mu.Lock()
	s.webhooks[chave] = strings.TrimRight(cfg.WebhookURL, "/")
	s.mu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func (s *Sim) getWebhook(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	u, ok := s.webhooks[r.PathValue("chave")]
	s.mu.Unlock()
	if !ok {
		problem(w, http.StatusNotFound, "WebhookNaoEncontrado", "Webhook não encontrado", "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"webhookUrl": u, "chave": r.PathValue("chave")})
}

// ---- partner-bank transfer contract (internal/pixout) ----

func (s *Sim) postTransfer(w http.ResponseWriter, r *http.Request) {
	var in map[string]string
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad payload", http.StatusBadRequest)
		return
	}
	if _, err := apipix.ParseValor(in["valor"]); err != nil || in["chave"] == "" || in["idempotencia"] == "" {
		http.Error(w, "valor, chave e idempotencia são obrigatórios", http.StatusUnprocessableEntity)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.xfers[in["idempotencia"]]; ok {
		writeJSON(w, http.StatusOK, t)
		return
	}
	status, motivo := "REALIZADO", ""
	if in["chave"] == s.cfg.FailKey && s.cfg.FailKey != "" {
		status, motivo = "NAO_REALIZADO", "Conta de destino encerrada"
	}
	t := map[string]string{"id": in["idempotencia"], "endToEndId": s.e2e("E"), "status": status, "motivo": motivo, "valor": in["valor"], "chave": in["chave"]}
	s.xfers[in["idempotencia"]] = t
	writeJSON(w, http.StatusCreated, t)
}

func (s *Sim) getTransfer(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	t, ok := s.xfers[r.PathValue("id")]
	s.mu.Unlock()
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

// ---- control ----

func (s *Sim) simPay(w http.ResponseWriter, r *http.Request) {
	txid := r.PathValue("txid")
	var in struct {
		Valor       string `json:"valor"`
		InfoPagador string `json:"infoPagador"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	s.mu.Lock()
	cob, ok := s.cobs[txid]
	if !ok || cob.Status != apipix.CobAtiva {
		s.mu.Unlock()
		http.Error(w, "no ATIVA charge with this txid", http.StatusNotFound)
		return
	}
	valor := cob.Valor.Original
	if in.Valor != "" {
		valor = in.Valor
	}
	p := &apipix.Pix{EndToEndID: s.e2e("E"), TxID: txid, Valor: valor, Chave: cob.Chave, Horario: s.cfg.Now().UTC().Format(time.RFC3339), InfoPagador: in.InfoPagador}
	s.pix[p.EndToEndID] = p
	cob.Status = apipix.CobConcluida
	cob.Pix = append(cob.Pix, *p)
	hook := s.webhooks[cob.Chave]
	pc := *p
	s.mu.Unlock()
	if hook != "" {
		if err := s.deliver(r.Context(), hook, pc); err != nil {
			s.cfg.Logger.Warn("pixsim webhook failed", "err", err)
		}
	}
	writeJSON(w, http.StatusOK, pc)
}

func (s *Sim) simSettleDevolucao(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	p, ok := s.pix[r.PathValue("e2eid")]
	if !ok {
		s.mu.Unlock()
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	found := false
	for i := range p.Devolucoes {
		if p.Devolucoes[i].ID == r.PathValue("id") {
			p.Devolucoes[i].Status = apipix.DevolucaoDevolvido
			p.Devolucoes[i].Horario.Liquidacao = s.cfg.Now().UTC().Format(time.RFC3339)
			found = true
		}
	}
	hook := s.webhooks[p.Chave]
	pc := *p
	s.mu.Unlock()
	if !found {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if hook != "" {
		_ = s.deliver(r.Context(), hook, pc)
	}
	writeJSON(w, http.StatusOK, pc)
}

// deliver POSTs {webhookUrl}/pix with mutual TLS, retrying a few times like a PSP would.
func (s *Sim) deliver(ctx context.Context, hook string, p apipix.Pix) error {
	body, _ := json.Marshal(apipix.WebhookPayload{Pix: []apipix.Pix{p}})
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, hook+"/pix", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := s.hc.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				s.mu.Lock()
				s.Deliveries++
				s.mu.Unlock()
				return nil
			}
			err = fmt.Errorf("webhook HTTP %d", resp.StatusCode)
		}
		last = err
		time.Sleep(time.Duration(100*(attempt+1)) * time.Millisecond)
	}
	return last
}

// e2e builds an endToEndId: prefix + ISPB(8) + yyyyMMddHHmm + 11 alphanumerics = 32.
func (s *Sim) e2e(prefix string) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	var sb strings.Builder
	sb.WriteString(prefix + s.cfg.ISPB + s.cfg.Now().UTC().Format("200601021504"))
	for sb.Len() < 32 {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		sb.WriteByte(alphabet[n.Int64()])
	}
	return sb.String()
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
