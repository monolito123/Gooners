package payments

import "testing"

func TestNormalizePixKey(t *testing.T) {
	ok := []struct{ kt, k, wantType, wantKey string }{
		{"CNPJ", "12.345.678/0001-95", "cnpj", "12345678000195"},
		{"cnpj", "12345678000195", "cnpj", "12345678000195"},
		{"cpf", "529.982.247-25", "cpf", "52998224725"},
		{"email", " Caixa@Padaria.com.br ", "email", "caixa@padaria.com.br"},
		{"phone", "+55 (11) 98765-4321", "phone", "+5511987654321"},
		{"evp", "123E4567-E89B-12D3-A456-426614174000", "evp", "123e4567-e89b-12d3-a456-426614174000"},
	}
	for _, c := range ok {
		kt, k, err := normalizePixKey(c.kt, c.k)
		if err != nil || kt != c.wantType || k != c.wantKey {
			t.Errorf("normalizePixKey(%q, %q) = %q, %q, %v", c.kt, c.k, kt, k, err)
		}
	}
	bad := [][2]string{
		{"cnpj", "12345678000194"}, {"cnpj", "11111111111111"}, {"cnpj", "1"}, {"cnpj", "12345678000195x"},
		{"cpf", "52998224724"}, {"cpf", "00000000000"}, {"cpf", "5299822472"},
		{"email", "not-an-email"}, {"email", "a@b"}, {"phone", "11987654321"}, {"phone", "+0123"},
		{"evp", "not-a-uuid"}, {"iban", "x"}, {"", "x"},
	}
	for _, b := range bad {
		if _, _, err := normalizePixKey(b[0], b[1]); err == nil {
			t.Errorf("normalizePixKey(%q, %q) accepted", b[0], b[1])
		}
	}
}
