package awsauth

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// Provider returns credentials, refreshing them as they expire.
type Provider interface {
	Retrieve(ctx context.Context) (Credentials, error)
}

// Static is a fixed key pair (tests, or long-term keys from a secret manager).
type Static Credentials

// Retrieve implements Provider.
func (s Static) Retrieve(context.Context) (Credentials, error) { return Credentials(s), nil }

// FromEnvironment picks the first source the environment configures, in the SDKs' order:
//
//  1. AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (and AWS_SESSION_TOKEN);
//  2. AWS_ROLE_ARN with AWS_WEB_IDENTITY_TOKEN_FILE: EKS service accounts (IRSA), through STS;
//  3. AWS_CONTAINER_CREDENTIALS_FULL_URI or _RELATIVE_URI: ECS tasks and EKS Pod Identity;
//  4. the EC2 instance metadata service, version 2.
//
// Temporary credentials are cached and renewed five minutes before they expire.
func FromEnvironment() Provider {
	switch {
	case os.Getenv("AWS_ACCESS_KEY_ID") != "" && os.Getenv("AWS_SECRET_ACCESS_KEY") != "":
		return Static{AccessKeyID: os.Getenv("AWS_ACCESS_KEY_ID"), SecretAccessKey: os.Getenv("AWS_SECRET_ACCESS_KEY"), SessionToken: os.Getenv("AWS_SESSION_TOKEN")}
	case os.Getenv("AWS_ROLE_ARN") != "" && os.Getenv("AWS_WEB_IDENTITY_TOKEN_FILE") != "":
		region := Region()
		endpoint := "https://sts.amazonaws.com/"
		if region != "" {
			endpoint = "https://sts." + region + ".amazonaws.com/"
		}
		session := os.Getenv("AWS_ROLE_SESSION_NAME")
		if session == "" {
			session = "goonerspay"
		}
		return &Cached{Source: &WebIdentity{Endpoint: endpoint, RoleARN: os.Getenv("AWS_ROLE_ARN"), TokenFile: os.Getenv("AWS_WEB_IDENTITY_TOKEN_FILE"), SessionName: session}}
	case os.Getenv("AWS_CONTAINER_CREDENTIALS_FULL_URI") != "" || os.Getenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI") != "":
		u := os.Getenv("AWS_CONTAINER_CREDENTIALS_FULL_URI")
		if u == "" {
			u = "http://169.254.170.2" + os.Getenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
		}
		return &Cached{Source: &Container{URL: u, Token: os.Getenv("AWS_CONTAINER_AUTHORIZATION_TOKEN"), TokenFile: os.Getenv("AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE")}}
	default:
		return &Cached{Source: &InstanceMetadata{Endpoint: "http://169.254.169.254"}}
	}
}

// Region is AWS_REGION, or AWS_DEFAULT_REGION.
func Region() string {
	if r := os.Getenv("AWS_REGION"); r != "" {
		return r
	}
	return os.Getenv("AWS_DEFAULT_REGION")
}

// Cached keeps a source's credentials until five minutes before they expire.
type Cached struct {
	Source Provider
	mu     sync.Mutex
	cur    Credentials
	now    func() time.Time
}

// Retrieve implements Provider.
func (c *Cached) Retrieve(ctx context.Context) (Credentials, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now
	if c.now != nil {
		now = c.now
	}
	if c.cur.AccessKeyID != "" && (c.cur.Expires.IsZero() || now().Add(5*time.Minute).Before(c.cur.Expires)) {
		return c.cur, nil
	}
	cr, err := c.Source.Retrieve(ctx)
	if err != nil {
		return Credentials{}, err
	}
	c.cur = cr
	return cr, nil
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

// WebIdentity exchanges a projected service-account token for role credentials
// (STS AssumeRoleWithWebIdentity, which needs no signature).
type WebIdentity struct {
	Endpoint, RoleARN, TokenFile, SessionName string
}

// Retrieve implements Provider.
func (w *WebIdentity) Retrieve(ctx context.Context) (Credentials, error) {
	tok, err := os.ReadFile(w.TokenFile)
	if err != nil {
		return Credentials{}, fmt.Errorf("awsauth: web identity token: %w", err)
	}
	form := url.Values{"Action": {"AssumeRoleWithWebIdentity"}, "Version": {"2011-06-15"}, "RoleArn": {w.RoleARN},
		"RoleSessionName": {w.SessionName}, "WebIdentityToken": {strings.TrimSpace(string(tok))}}
	req, _ := http.NewRequestWithContext(ctx, "POST", w.Endpoint, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	b, err := do(req)
	if err != nil {
		return Credentials{}, fmt.Errorf("awsauth: sts: %w", err)
	}
	var out struct {
		Result struct {
			Credentials struct {
				AccessKeyID     string    `xml:"AccessKeyId"`
				SecretAccessKey string    `xml:"SecretAccessKey"`
				SessionToken    string    `xml:"SessionToken"`
				Expiration      time.Time `xml:"Expiration"`
			} `xml:"Credentials"`
		} `xml:"AssumeRoleWithWebIdentityResult"`
	}
	if err := xml.Unmarshal(b, &out); err != nil {
		return Credentials{}, fmt.Errorf("awsauth: sts: %w", err)
	}
	c := out.Result.Credentials
	if c.AccessKeyID == "" {
		return Credentials{}, errors.New("awsauth: sts returned no credentials")
	}
	return Credentials{AccessKeyID: c.AccessKeyID, SecretAccessKey: c.SecretAccessKey, SessionToken: c.SessionToken, Expires: c.Expiration}, nil
}

// Container reads credentials from the ECS or EKS Pod Identity agent.
type Container struct {
	URL, Token, TokenFile string
}

// Retrieve implements Provider.
func (c *Container) Retrieve(ctx context.Context) (Credentials, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", c.URL, nil)
	tok := c.Token
	if c.TokenFile != "" {
		b, err := os.ReadFile(c.TokenFile)
		if err != nil {
			return Credentials{}, fmt.Errorf("awsauth: container token: %w", err)
		}
		tok = strings.TrimSpace(string(b))
	}
	if tok != "" {
		req.Header.Set("Authorization", tok)
	}
	b, err := do(req)
	if err != nil {
		return Credentials{}, fmt.Errorf("awsauth: container credentials: %w", err)
	}
	return parseJSONCredentials(b)
}

// InstanceMetadata reads the instance profile's credentials through IMDSv2.
type InstanceMetadata struct{ Endpoint string }

// Retrieve implements Provider.
func (m *InstanceMetadata) Retrieve(ctx context.Context) (Credentials, error) {
	req, _ := http.NewRequestWithContext(ctx, "PUT", m.Endpoint+"/latest/api/token", nil)
	req.Header.Set("X-aws-ec2-metadata-token-ttl-seconds", "21600")
	tok, err := do(req)
	if err != nil {
		return Credentials{}, fmt.Errorf("awsauth: no credentials in the environment and no instance metadata: %w", err)
	}
	get := func(path string) ([]byte, error) {
		r, _ := http.NewRequestWithContext(ctx, "GET", m.Endpoint+path, nil)
		r.Header.Set("X-aws-ec2-metadata-token", string(tok))
		return do(r)
	}
	role, err := get("/latest/meta-data/iam/security-credentials/")
	if err != nil {
		return Credentials{}, fmt.Errorf("awsauth: instance role: %w", err)
	}
	name := strings.TrimSpace(strings.SplitN(string(role), "\n", 2)[0])
	b, err := get("/latest/meta-data/iam/security-credentials/" + url.PathEscape(name))
	if err != nil {
		return Credentials{}, fmt.Errorf("awsauth: instance credentials: %w", err)
	}
	return parseJSONCredentials(b)
}

func parseJSONCredentials(b []byte) (Credentials, error) {
	var c struct {
		AccessKeyID     string    `json:"AccessKeyId"`
		SecretAccessKey string    `json:"SecretAccessKey"`
		Token           string    `json:"Token"`
		Expiration      time.Time `json:"Expiration"`
	}
	if err := json.Unmarshal(b, &c); err != nil || c.AccessKeyID == "" {
		return Credentials{}, fmt.Errorf("awsauth: credentials response: %v", err)
	}
	return Credentials{AccessKeyID: c.AccessKeyID, SecretAccessKey: c.SecretAccessKey, SessionToken: c.Token, Expires: c.Expiration}, nil
}

func do(req *http.Request) ([]byte, error) {
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return b, nil
}

// Client calls one AWS JSON API (KMS, Payment Cryptography) with signed requests.
type Client struct {
	Service     string // the signing name: "kms", "payment-cryptography"
	Region      string
	Endpoint    string // https://kms.sa-east-1.amazonaws.com
	Credentials Provider
	HTTP        *http.Client
	Now         func() time.Time
}

// Error is an AWS error response.
type Error struct {
	Service string
	Status  int
	Type    string
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("aws %s: HTTP %d %s: %s", e.Service, e.Status, e.Type, e.Message)
}

// Do sends a JSON request and decodes the JSON response into out. headers are extra headers
// (X-Amz-Target for the JSON 1.1 protocol).
func (c *Client) Do(ctx context.Context, method, path string, headers map[string]string, in, out any) error {
	var body []byte
	if in != nil {
		var err error
		if body, err = json.Marshal(in); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.Endpoint, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	creds, err := c.Credentials.Retrieve(ctx)
	if err != nil {
		return err
	}
	now := time.Now
	if c.Now != nil {
		now = c.Now
	}
	Sign(req, body, creds, c.Region, c.Service, now())
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		var e struct {
			Type     string `json:"__type"`
			Message  string `json:"message"`
			Message2 string `json:"Message"`
		}
		_ = json.Unmarshal(b, &e)
		if e.Message == "" {
			e.Message = e.Message2
		}
		if i := strings.LastIndexByte(e.Type, '#'); i >= 0 {
			e.Type = e.Type[i+1:]
		}
		return &Error{Service: c.Service, Status: resp.StatusCode, Type: e.Type, Message: e.Message}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(b, out)
}
