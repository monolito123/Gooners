package authswitch

// Retry policies attached to response codes (docs/01-acquiring-engine.md §3.7).
type Retry string

const (
	RetryNever   Retry = "never"
	RetryLater   Retry = "later"   // merchant-initiated retries only, after ≥ 24 h
	RetryCorrect Retry = "correct" // customer must correct the data (PIN, CVC, expiry)
	RetryCascade Retry = "cascade" // technical: one cascade to an alternate route is allowed
	RetryStepUp  Retry = "step_up" // authenticate (online PIN, 3DS) and resubmit
	RetryNone    Retry = ""        // approved
)

// Decline describes a non-approval for the API and the routing engine.
type Decline struct {
	Code            string // normalized decline_code of the public API
	VisaCategory    string // "1", "2", "3" or "" (Visa reattempt categories)
	Retry           Retry
	RiskSignal      bool
	CustomerMessage string
}

const genericMessage = "Pagamento recusado. Tente outro cartão ou use Pix."

var responseCodes = map[string]Decline{
	"04": {"do_not_honor", "1", RetryNever, true, genericMessage},
	"05": {"do_not_honor", "", RetryNever, false, genericMessage},
	"07": {"do_not_honor", "1", RetryNever, true, genericMessage},
	"12": {"processing_error", "1", RetryNever, false, genericMessage},
	"14": {"invalid_number", "1", RetryNever, false, "Número do cartão inválido."},
	"15": {"invalid_number", "1", RetryNever, false, "Número do cartão inválido."},
	"41": {"do_not_honor", "1", RetryNever, true, genericMessage},
	"43": {"do_not_honor", "1", RetryNever, true, genericMessage},
	"46": {"do_not_honor", "1", RetryNever, false, genericMessage},
	"51": {"insufficient_funds", "2", RetryLater, false, "Saldo ou limite insuficiente."},
	"54": {"expired_card", "3", RetryCorrect, false, "Cartão vencido."},
	"55": {"incorrect_pin", "3", RetryCorrect, false, "Senha incorreta. Tente de novo."},
	"57": {"not_permitted", "1", RetryNever, false, genericMessage},
	"59": {"do_not_honor", "2", RetryNever, true, genericMessage},
	"61": {"limit_exceeded", "2", RetryLater, false, "Valor acima do limite do cartão."},
	"65": {"authentication_required", "2", RetryStepUp, false, "Digite a senha do cartão."},
	"1A": {"authentication_required", "", RetryStepUp, false, "Digite a senha do cartão."},
	"91": {"issuer_unavailable", "2", RetryCascade, false, "Emissor indisponível. Tente de novo em instantes."},
	"96": {"processing_error", "2", RetryCascade, false, "Falha no processamento. Tente de novo."},
	"N7": {"incorrect_cvc", "3", RetryCorrect, false, "Código de segurança incorreto."},
	"R0": {"stop_recurring", "1", RetryNever, false, genericMessage},
	"R1": {"stop_recurring", "1", RetryNever, false, genericMessage},
}

// Classify maps an ISO 8583 response code to a decline. ok is true for an approval.
func Classify(rc string) (d Decline, ok bool) {
	if rc == "00" || rc == "10" || rc == "11" {
		return Decline{}, true
	}
	if d, found := responseCodes[rc]; found {
		return d, false
	}
	return Decline{Code: "do_not_honor", Retry: RetryNever, CustomerMessage: genericMessage}, false
}

// MerchantAdvice applies a Mastercard merchant advice code (DE 48 SE 84), which overrides
// the platform's own policy: 01 update account data, 02 retry later, 03 never retry,
// 21 cancel the recurring mandate, 24–30 retry after a stated interval.
func MerchantAdvice(d Decline, mac string) Decline {
	switch mac {
	case "01":
		d.Retry = RetryCorrect
	case "02":
		d.Retry = RetryLater
	case "03":
		d.Retry = RetryNever
	case "21":
		d.Retry = RetryNever
		d.Code = "stop_recurring"
	case "24", "25", "26", "27", "28", "29", "30":
		d.Retry = RetryLater
	}
	return d
}
