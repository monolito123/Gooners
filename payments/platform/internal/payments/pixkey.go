package payments

import (
	"regexp"
	"strings"
)

var (
	pixPhone = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
	pixEmail = regexp.MustCompile(`^[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$`)
	pixEVP   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// normalizePixKey checks a Pix key the way DICT stores it and returns the canonical form:
// key_type lowercase (as in the API), CPF and CNPJ as bare digits with valid check digits,
// e-mail lowercase (at most 77 characters), phone in E.164, EVP a lowercase UUID. A key that
// cannot exist never reaches the PSP, where it would cost a refused transfer.
func normalizePixKey(keyType, key string) (string, string, error) {
	kt := strings.ToLower(strings.TrimSpace(keyType))
	k := strings.TrimSpace(key)
	switch kt {
	case "cpf", "cnpj":
		digits := strings.Map(func(r rune) rune {
			switch {
			case r >= '0' && r <= '9':
				return r
			case r == '.' || r == '-' || r == '/':
				return -1
			}
			return 'x'
		}, k)
		if (kt == "cpf" && !ValidCPF(digits)) || (kt == "cnpj" && !ValidCNPJ(digits)) {
			return "", "", invalid("destination.key is not a valid %s", strings.ToUpper(kt))
		}
		return kt, digits, nil
	case "email":
		k = strings.ToLower(k)
		if len(k) > 77 || !pixEmail.MatchString(k) {
			return "", "", invalid("destination.key is not a valid e-mail Pix key")
		}
		return kt, k, nil
	case "phone":
		k = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(k)
		if !pixPhone.MatchString(k) {
			return "", "", invalid("destination.key must be a phone number in E.164 (+5511987654321)")
		}
		return kt, k, nil
	case "evp":
		k = strings.ToLower(k)
		if !pixEVP.MatchString(k) {
			return "", "", invalid("destination.key is not a random (EVP) Pix key")
		}
		return kt, k, nil
	}
	return "", "", invalid("destination.key_type must be cpf, cnpj, email, phone or evp")
}

// ValidCPF reports whether s is 11 digits with valid check digits (and not all equal).
func ValidCPF(s string) bool {
	return len(s) == 11 && digitsOnly(s) && !allSame(s) &&
		mod11(s[:9], []int{10, 9, 8, 7, 6, 5, 4, 3, 2}) == s[9] && mod11(s[:10], []int{11, 10, 9, 8, 7, 6, 5, 4, 3, 2}) == s[10]
}

// ValidCNPJ reports whether s is 14 digits with valid check digits (and not all equal).
func ValidCNPJ(s string) bool {
	return len(s) == 14 && digitsOnly(s) && !allSame(s) &&
		mod11(s[:12], []int{5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2}) == s[12] && mod11(s[:13], []int{6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2}) == s[13]
}

func mod11(s string, weights []int) byte {
	sum := 0
	for i, w := range weights {
		sum += int(s[i]-'0') * w
	}
	if r := sum % 11; r >= 2 {
		return byte('0' + 11 - r)
	}
	return '0'
}

func digitsOnly(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func allSame(s string) bool { return strings.Count(s, s[:1]) == len(s) }
