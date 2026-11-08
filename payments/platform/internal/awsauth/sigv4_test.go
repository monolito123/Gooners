package awsauth

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// AWS's published examples: the "get-vanilla" case of the Signature Version 4 test suite and
// the IAM ListUsers walk-through of the SigV4 documentation, with their example credentials.
func TestSignAWSExamples(t *testing.T) {
	creds := Credentials{AccessKeyID: "AKIDEXAMPLE", SecretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"}
	at := time.Date(2015, 8, 30, 12, 36, 0, 0, time.UTC)

	r, _ := http.NewRequest("GET", "https://example.amazonaws.com/", nil)
	Sign(r, nil, creds, "us-east-1", "service", at)
	want := "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
	if got := r.Header.Get("Authorization"); got != want {
		t.Errorf("get-vanilla:\n got %s\nwant %s", got, want)
	}

	r, _ = http.NewRequest("GET", "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", nil)
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
	Sign(r, nil, creds, "us-east-1", "iam", at)
	want = "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
	if got := r.Header.Get("Authorization"); got != want {
		t.Errorf("IAM ListUsers:\n got %s\nwant %s", got, want)
	}
}

// A key ARN in a path is sent encoded once and signed encoded twice (outside S3); a session
// token is sent and signed.
func TestSignPathsAndSessionTokens(t *testing.T) {
	r, _ := http.NewRequest("POST", "https://dataplane.payment-cryptography.us-east-1.amazonaws.com/keys/arn:aws:payment-cryptography:us-east-1:111122223333:key%2Fabc/decrypt", nil)
	Sign(r, []byte("{}"), Credentials{AccessKeyID: "AK", SecretAccessKey: "s", SessionToken: "tok"}, "us-east-1", "payment-cryptography", time.Now())
	if got := r.URL.EscapedPath(); got != "/keys/arn%3Aaws%3Apayment-cryptography%3Aus-east-1%3A111122223333%3Akey%2Fabc/decrypt" {
		t.Errorf("wire path %s", got)
	}
	if r.Header.Get("X-Amz-Security-Token") != "tok" || !strings.Contains(r.Header.Get("Authorization"), "x-amz-security-token") {
		t.Errorf("session token not signed: %v", r.Header)
	}
	r, _ = http.NewRequest("PUT", "https://bucket.s3.sa-east-1.amazonaws.com/audit/2026-11-08.jsonl", nil)
	Sign(r, []byte("x"), Credentials{AccessKeyID: "AK", SecretAccessKey: "s"}, "sa-east-1", "s3", time.Now())
	if r.Header.Get("X-Amz-Content-Sha256") != sha256Hex([]byte("x")) || !strings.Contains(r.Header.Get("Authorization"), "x-amz-content-sha256") {
		t.Errorf("S3 payload hash: %v", r.Header)
	}
}
