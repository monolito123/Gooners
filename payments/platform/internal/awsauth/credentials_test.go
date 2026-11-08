package awsauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCredentialSources(t *testing.T) {
	ctx := context.Background()
	exp := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)

	// IMDSv2: a token first, then the role, then its credentials, each with the token.
	imds := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "PUT" && r.URL.Path == "/latest/api/token" && r.Header.Get("X-aws-ec2-metadata-token-ttl-seconds") != "":
			w.Write([]byte("tok"))
		case r.Header.Get("X-aws-ec2-metadata-token") != "tok":
			w.WriteHeader(401)
		case r.URL.Path == "/latest/meta-data/iam/security-credentials/":
			w.Write([]byte("platform-role\n"))
		case r.URL.Path == "/latest/meta-data/iam/security-credentials/platform-role":
			w.Write([]byte(`{"Code":"Success","AccessKeyId":"ASIAIMDS","SecretAccessKey":"s","Token":"t","Expiration":"` + exp + `"}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer imds.Close()
	c, err := (&Cached{Source: &InstanceMetadata{Endpoint: imds.URL}}).Retrieve(ctx)
	if err != nil || c.AccessKeyID != "ASIAIMDS" || c.SessionToken != "t" || c.Expires.IsZero() {
		t.Fatalf("IMDS: %+v %v", c, err)
	}

	// The container agent, with its authorization token from a file.
	dir := t.TempDir()
	tokFile := filepath.Join(dir, "token")
	os.WriteFile(tokFile, []byte("pod-identity\n"), 0o600)
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "pod-identity" {
			w.WriteHeader(401)
			return
		}
		w.Write([]byte(`{"AccessKeyId":"ASIAPOD","SecretAccessKey":"s","Token":"t","Expiration":"` + exp + `"}`))
	}))
	defer agent.Close()
	if c, err := (&Container{URL: agent.URL, TokenFile: tokFile}).Retrieve(ctx); err != nil || c.AccessKeyID != "ASIAPOD" {
		t.Fatalf("container: %+v %v", c, err)
	}

	// EKS: the projected token goes to STS, which answers in XML.
	os.WriteFile(tokFile, []byte("eyJhbGciOi.jwt\n"), 0o600)
	sts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("Action") != "AssumeRoleWithWebIdentity" || r.Form.Get("WebIdentityToken") != "eyJhbGciOi.jwt" || r.Form.Get("RoleArn") != "arn:aws:iam::1:role/platform" {
			w.WriteHeader(400)
			return
		}
		w.Write([]byte(`<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleWithWebIdentityResult>
<Credentials><AccessKeyId>ASIAWEB</AccessKeyId><SecretAccessKey>s</SecretAccessKey><SessionToken>t</SessionToken><Expiration>` + exp + `</Expiration></Credentials>
</AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>`))
	}))
	defer sts.Close()
	if c, err := (&WebIdentity{Endpoint: sts.URL, RoleARN: "arn:aws:iam::1:role/platform", TokenFile: tokFile, SessionName: "x"}).Retrieve(ctx); err != nil || c.AccessKeyID != "ASIAWEB" || c.Expires.IsZero() {
		t.Fatalf("web identity: %+v %v", c, err)
	}

	// The cache renews only near expiry.
	calls := 0
	src := providerFunc(func() (Credentials, error) {
		calls++
		return Credentials{AccessKeyID: "A", SecretAccessKey: "s", Expires: time.Now().Add(10 * time.Minute)}, nil
	})
	cache := &Cached{Source: src}
	cache.Retrieve(ctx)
	cache.Retrieve(ctx)
	cache.now = func() time.Time { return time.Now().Add(6 * time.Minute) }
	cache.Retrieve(ctx)
	if calls != 2 {
		t.Fatalf("cache fetched %d times", calls)
	}
}

type providerFunc func() (Credentials, error)

func (f providerFunc) Retrieve(context.Context) (Credentials, error) { return f() }

// An AWS error body becomes an Error naming the exception.
func TestClientErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AK/") {
			w.WriteHeader(403)
			return
		}
		w.WriteHeader(400)
		w.Write([]byte(`{"__type":"com.amazonaws.kms#NotFoundException","message":"Key 'alias/x' does not exist"}`))
	}))
	defer srv.Close()
	c := &Client{Service: "kms", Region: "sa-east-1", Endpoint: srv.URL, Credentials: Static{AccessKeyID: "AK", SecretAccessKey: "s"}}
	err := c.Do(context.Background(), "POST", "/", map[string]string{"X-Amz-Target": "TrentService.Encrypt"}, map[string]string{}, nil)
	e, ok := err.(*Error)
	if !ok || e.Type != "NotFoundException" || !strings.Contains(e.Message, "does not exist") {
		t.Fatalf("%v", err)
	}
}
