package webhooks

import (
	"testing"
	"time"
)

// The test vector published in docs/02-api-reference.md §10.1.
func TestSpecVector(t *testing.T) {
	secret := "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
	body := `{"type":"payment_intent.captured","timestamp":"2026-10-29T17:42:11Z","data":{"id":"pi_01JBK3T2W8C9M4N5P6Q7R8S9TA","object":"payment_intent","status":"captured","amount":12990,"currency":"BRL","merchant_id":"mer_01JB8Z2K5D6F7G8H9J0K1M2N3P"}}`
	sig, err := Sign(secret, "msg_01JBK40ZQ8P7Y6X5W4V3U2T1S0", 1793295731, []byte(body))
	if err != nil || sig != "v1,AJC7y+Vo6KPncZvxSaIyjKWow3yceaSP8LoJqQbbhUQ=" {
		t.Fatalf("signature %s %v", sig, err)
	}
	now := time.Unix(1793295731, 0)
	if err := Verify(secret, "msg_01JBK40ZQ8P7Y6X5W4V3U2T1S0", "1793295731", "v1,old "+sig, []byte(body), 5*time.Minute, now); err != nil {
		t.Fatal(err)
	}
	if Verify(secret, "msg_01JBK40ZQ8P7Y6X5W4V3U2T1S0", "1793295731", sig, []byte(body), 5*time.Minute, now.Add(10*time.Minute)) == nil {
		t.Fatal("stale timestamp accepted")
	}
	if Verify(secret, "msg_other", "1793295731", sig, []byte(body), 5*time.Minute, now) == nil {
		t.Fatal("signature for another id accepted")
	}
}
