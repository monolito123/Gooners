// Package awsauth signs requests to AWS APIs with Signature Version 4 and finds credentials
// the way AWS's SDKs do (environment, EKS web identity, container endpoint, EC2 instance
// metadata). The platform calls three AWS APIs (KMS, Payment Cryptography and S3); doing it
// with the standard library keeps the dependency list, and the CDE's review, short.
package awsauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Credentials are an access key, its secret and, for temporary credentials, a session token.
type Credentials struct {
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
	// Expires is when temporary credentials stop working; zero for long-term keys.
	Expires time.Time
}

// Sign signs r for service in region at now (Signature Version 4). body is the exact request
// body (nil for none). It sets X-Amz-Date, X-Amz-Security-Token for temporary credentials,
// X-Amz-Content-Sha256 for S3, and Authorization. The signed headers are host, content-type
// and every x-amz-* header, which is what AWS requires and what its SDKs send.
//
// The request path is sent and signed in AWS's encoding (RFC 3986 unreserved characters
// only); outside S3 the canonical path encodes each segment a second time, as the
// specification says.
func Sign(r *http.Request, body []byte, c Credentials, region, service string, now time.Time) {
	t := now.UTC()
	amzDate := t.Format("20060102T150405Z")
	day := t.Format("20060102")
	payload := sha256Hex(body)
	r.Header.Set("X-Amz-Date", amzDate)
	if c.SessionToken != "" {
		r.Header.Set("X-Amz-Security-Token", c.SessionToken)
	}
	if service == "s3" {
		r.Header.Set("X-Amz-Content-Sha256", payload)
	}

	// The path as sent: each segment encoded once, in AWS's alphabet. Segments are split on
	// the escaped form, so an encoded slash (a key ARN) stays inside its segment.
	escaped := r.URL.EscapedPath()
	if escaped == "" {
		escaped = "/"
	}
	segs := strings.Split(escaped, "/")
	for i, s := range segs {
		if d, err := url.PathUnescape(s); err == nil {
			s = d
		}
		segs[i] = uriEncode(s)
	}
	wire := strings.Join(segs, "/")
	if p, err := url.PathUnescape(wire); err == nil {
		r.URL.Path = p
	}
	r.URL.RawPath = wire
	canonicalPath := wire
	if service != "s3" {
		canonicalPath = encodePath(wire)
	}

	host := r.Host
	if host == "" {
		host = r.URL.Host
	}
	values := map[string]string{"host": host}
	for k, v := range r.Header {
		lk := strings.ToLower(k)
		if lk == "content-type" || strings.HasPrefix(lk, "x-amz-") {
			vs := make([]string, len(v))
			for i, s := range v {
				vs[i] = strings.Join(strings.Fields(s), " ")
			}
			values[lk] = strings.Join(vs, ",")
		}
	}
	names := make([]string, 0, len(values))
	for k := range values {
		names = append(names, k)
	}
	sort.Strings(names)
	var headers strings.Builder
	for _, k := range names {
		headers.WriteString(k + ":" + values[k] + "\n")
	}
	signed := strings.Join(names, ";")

	canonical := strings.Join([]string{r.Method, canonicalPath, canonicalQuery(r.URL), headers.String(), signed, payload}, "\n")
	scope := day + "/" + region + "/" + service + "/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + sha256Hex([]byte(canonical))
	key := hmacSHA256([]byte("AWS4"+c.SecretAccessKey), day)
	for _, part := range []string{region, service, "aws4_request"} {
		key = hmacSHA256(key, part)
	}
	sig := hex.EncodeToString(hmacSHA256(key, toSign))
	r.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s", c.AccessKeyID, scope, signed, sig))
}

// canonicalQuery sorts the parameters by name, then value, each encoded in AWS's alphabet.
func canonicalQuery(u *url.URL) string {
	q := u.Query()
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		vs := append([]string(nil), q[k]...)
		sort.Strings(vs)
		for _, v := range vs {
			parts = append(parts, uriEncode(k)+"="+uriEncode(v))
		}
	}
	return strings.Join(parts, "&")
}

// encodePath encodes each segment of a path, keeping the slashes.
func encodePath(p string) string {
	segs := strings.Split(p, "/")
	for i, s := range segs {
		segs[i] = uriEncode(s)
	}
	return strings.Join(segs, "/")
}

// uriEncode percent-encodes every byte but RFC 3986's unreserved characters, in upper case.
func uriEncode(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if 'A' <= c && c <= 'Z' || 'a' <= c && c <= 'z' || '0' <= c && c <= '9' || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func sha256Hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}
