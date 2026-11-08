package worm

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/monolito123/Gooners/payments/platform/internal/awsauth"
)

// A fake S3 bucket with Object Lock: it checks what S3 checks for a locked object.
func TestPutLocked(t *testing.T) {
	var mu sync.Mutex
	objects := map[string][]byte{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		sum := sha256.Sum256(body)
		until, err := time.Parse(time.RFC3339, r.Header.Get("X-Amz-Object-Lock-Retain-Until-Date"))
		switch {
		case r.Method != http.MethodPut || !strings.HasPrefix(r.URL.Path, "/audit-bucket/"):
			w.WriteHeader(400)
			return
		case !strings.Contains(r.Header.Get("Authorization"), "/sa-east-1/s3/aws4_request") || r.Header.Get("X-Amz-Content-Sha256") != hex.EncodeToString(sum[:]):
			w.WriteHeader(403)
			return
		case r.Header.Get("X-Amz-Object-Lock-Mode") != "COMPLIANCE" || err != nil || until.Before(time.Now()):
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`<Error><Code>InvalidRequest</Code><Message>Object Lock headers</Message></Error>`))
			return
		case r.Header.Get("X-Amz-Checksum-Sha256") != base64.StdEncoding.EncodeToString(sum[:]):
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`<Error><Code>BadDigest</Code><Message>checksum</Message></Error>`))
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if _, ok := objects[r.URL.Path]; ok && r.Header.Get("If-None-Match") == "*" {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		objects[r.URL.Path] = body
		w.Header().Set("X-Amz-Version-Id", "v1")
	}))
	defer srv.Close()
	s := &S3{Bucket: "audit-bucket", Region: "sa-east-1", Endpoint: srv.URL, Credentials: awsauth.Static{AccessKeyID: "AK", SecretAccessKey: "s"}}
	ctx := context.Background()
	body := []byte(`{"seq":1}` + "\n")
	v, err := s.PutLocked(ctx, "audit/2026/11/2026-11-07.jsonl", body, "application/x-ndjson", time.Now().AddDate(10, 0, 0))
	if err != nil || v != "v1" || string(objects["/audit-bucket/audit/2026/11/2026-11-07.jsonl"]) != string(body) {
		t.Fatalf("%q %v %v", v, err, objects)
	}
	if _, err := s.PutLocked(ctx, "audit/2026/11/2026-11-07.jsonl", []byte("rewritten"), "application/x-ndjson", time.Now().AddDate(10, 0, 0)); !errors.Is(err, ErrExists) {
		t.Fatalf("an existing key overwritten: %v", err)
	}
	if _, err := s.PutLocked(ctx, "audit/x.jsonl", body, "application/x-ndjson", time.Now().Add(-time.Hour)); err == nil || !strings.Contains(err.Error(), "InvalidRequest") {
		t.Fatalf("a retention in the past: %v", err)
	}
}
