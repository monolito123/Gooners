// Package apipix is a client for the Banco Central's API Pix standard (bacen/pix-api,
// v2.x): the API every PSP (bank or payment institution) exposes to its receiving users
// for immediate charges (cob), Pix received, devoluções and webhooks.
//
// Field names follow the standard exactly (Portuguese), so payloads round-trip with any
// conforming PSP. Outgoing Pix transfers are NOT part of API Pix; see internal/pixout.
package apipix

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// Calendario of a charge.
type Calendario struct {
	Criacao   string `json:"criacao,omitempty"`
	Expiracao int    `json:"expiracao,omitempty"` // seconds; default 86400
}

// Devedor (payer) of a charge: CPF or CNPJ plus name.
type Devedor struct {
	CPF  string `json:"cpf,omitempty"`
	CNPJ string `json:"cnpj,omitempty"`
	Nome string `json:"nome"`
}

// Valor of a charge; Original is "123.45".
type Valor struct {
	Original            string `json:"original"`
	ModalidadeAlteracao *int   `json:"modalidadeAlteracao,omitempty"`
}

// InfoAdicional is a name/value pair shown to the payer.
type InfoAdicional struct {
	Nome  string `json:"nome"`
	Valor string `json:"valor"`
}

// CobRequest is the body of PUT /cob/{txid}.
type CobRequest struct {
	Calendario         Calendario      `json:"calendario"`
	Devedor            *Devedor        `json:"devedor,omitempty"`
	Valor              Valor           `json:"valor"`
	Chave              string          `json:"chave"`
	SolicitacaoPagador string          `json:"solicitacaoPagador,omitempty"`
	InfoAdicionais     []InfoAdicional `json:"infoAdicionais,omitempty"`
}

// Loc is the payload location of a dynamic charge.
type Loc struct {
	ID       int64  `json:"id"`
	Location string `json:"location"`
	TipoCob  string `json:"tipoCob"`
	Criacao  string `json:"criacao,omitempty"`
}

// Cob statuses.
const (
	CobAtiva     = "ATIVA"
	CobConcluida = "CONCLUIDA"
)

// Cob is an immediate charge as returned by the PSP.
type Cob struct {
	Calendario         Calendario      `json:"calendario"`
	TxID               string          `json:"txid"`
	Revisao            int             `json:"revisao"`
	Loc                *Loc            `json:"loc,omitempty"`
	Location           string          `json:"location,omitempty"`
	Status             string          `json:"status"`
	Devedor            *Devedor        `json:"devedor,omitempty"`
	Valor              Valor           `json:"valor"`
	Chave              string          `json:"chave"`
	SolicitacaoPagador string          `json:"solicitacaoPagador,omitempty"`
	InfoAdicionais     []InfoAdicional `json:"infoAdicionais,omitempty"`
	PixCopiaECola      string          `json:"pixCopiaECola,omitempty"`
	Pix                []Pix           `json:"pix,omitempty"`
}

// Pix is a received Pix.
type Pix struct {
	EndToEndID  string      `json:"endToEndId"`
	TxID        string      `json:"txid,omitempty"`
	Valor       string      `json:"valor"`
	Chave       string      `json:"chave,omitempty"`
	Horario     string      `json:"horario"`
	InfoPagador string      `json:"infoPagador,omitempty"`
	Devolucoes  []Devolucao `json:"devolucoes,omitempty"`
}

// Paginacao is the paging block of list responses.
type Paginacao struct {
	PaginaAtual            int `json:"paginaAtual"`
	ItensPorPagina         int `json:"itensPorPagina"`
	QuantidadeDePaginas    int `json:"quantidadeDePaginas"`
	QuantidadeTotalDeItens int `json:"quantidadeTotalDeItens"`
}

// PixList is the response of GET /pix (PixConsultados).
type PixList struct {
	Parametros struct {
		Inicio    string    `json:"inicio"`
		Fim       string    `json:"fim"`
		Paginacao Paginacao `json:"paginacao"`
	} `json:"parametros"`
	Pix []Pix `json:"pix"`
}

// DevolucaoRequest is the body of PUT /pix/{e2eid}/devolucao/{id}.
type DevolucaoRequest struct {
	Valor     string `json:"valor"`
	Natureza  string `json:"natureza,omitempty"` // ORIGINAL or RETIRADA
	Descricao string `json:"descricao,omitempty"`
}

// Devolução natures. MED returns are initiated by the payer's PSP under the Mecanismo
// Especial de Devolução (BE08 operational failure, FR01 well-founded suspicion of fraud),
// not by the receiver, and arrive in the devolucoes of the original Pix.
const (
	NaturezaOriginal       = "ORIGINAL"
	NaturezaRetirada       = "RETIRADA"
	NaturezaMEDOperacional = "MED_OPERACIONAL"
	NaturezaMEDFraude      = "MED_FRAUDE"
)

// Devolução statuses.
const (
	DevolucaoEmProcessamento = "EM_PROCESSAMENTO"
	DevolucaoDevolvido       = "DEVOLVIDO"
	DevolucaoNaoRealizado    = "NAO_REALIZADO"
)

// Devolucao is a refund of a received Pix.
type Devolucao struct {
	ID        string `json:"id"`
	RtrID     string `json:"rtrId"`
	Valor     string `json:"valor"`
	Natureza  string `json:"natureza,omitempty"`
	Descricao string `json:"descricao,omitempty"`
	Horario   struct {
		Solicitacao string `json:"solicitacao,omitempty"`
		Liquidacao  string `json:"liquidacao,omitempty"`
	} `json:"horario"`
	Status string `json:"status"`
	Motivo string `json:"motivo,omitempty"`
}

// WebhookConfig is the body of PUT /webhook/{chave}.
type WebhookConfig struct {
	WebhookURL string `json:"webhookUrl"`
}

// WebhookPayload is what the PSP POSTs to {webhookUrl}/pix (over mTLS).
type WebhookPayload struct {
	Pix []Pix `json:"pix"`
}

var (
	reTxID  = regexp.MustCompile(`^[a-zA-Z0-9]{26,35}$`)
	reE2E   = regexp.MustCompile(`^[a-zA-Z0-9]{32}$`)
	reValor = regexp.MustCompile(`^[0-9]{1,10}\.[0-9]{2}$`)
	reDevID = regexp.MustCompile(`^[a-zA-Z0-9]{1,35}$`)
)

// ValidTxID reports whether s is a valid txid for /cob (26–35 alphanumerics).
func ValidTxID(s string) bool { return reTxID.MatchString(s) }

// ValidEndToEndID reports whether s is a valid endToEndId (32 alphanumerics).
func ValidEndToEndID(s string) bool { return reE2E.MatchString(s) }

// NewTxID returns a random 32-character txid.
func NewTxID() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	var sb strings.Builder
	for i := 0; i < 32; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		sb.WriteByte(alphabet[n.Int64()])
	}
	return sb.String()
}

// FormatValor turns centavos into the API's decimal string: 12990 → "129.90".
func FormatValor(cents int64) string {
	if cents < 0 {
		cents = 0
	}
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

// ParseValor turns "129.90" into 12990.
func ParseValor(s string) (int64, error) {
	if !reValor.MatchString(s) {
		return 0, fmt.Errorf("apipix: valor %q is not in the 123.45 format", s)
	}
	i := strings.IndexByte(s, '.')
	whole, err := strconv.ParseInt(s[:i], 10, 64)
	if err != nil {
		return 0, err
	}
	frac, _ := strconv.ParseInt(s[i+1:], 10, 64)
	return whole*100 + frac, nil
}
