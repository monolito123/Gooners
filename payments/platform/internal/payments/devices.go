package payments

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/mobileauth"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
	"github.com/monolito123/Gooners/payments/platform/pkg/nostr"
)

// Attestor checks a device's platform attestation evidence (Android key attestation and
// Play Integrity, Apple App Attest) and returns the integrity verdict and what the device
// may do. Production needs a real one; the sandbox records the evidence unverified.
type Attestor interface {
	Verify(ctx context.Context, platform, devicePubHex string, evidence map[string]any) (integrity map[string]any, capabilities []string, err error)
}

// SandboxAttestor accepts any evidence and says so.
type SandboxAttestor struct{}

// Verify implements Attestor.
func (SandboxAttestor) Verify(_ context.Context, platform, _ string, evidence map[string]any) (map[string]any, []string, error) {
	return map[string]any{"verdict": "unverified", "reason": "sandbox: attestation is recorded, not verified", "evidence_type": evidence["type"]},
		[]string{"sandbox_reader", "pix"}, nil
}

// Device is the API view of a merchant device (docs/02 §8.2).
type Device struct {
	ID           string         `json:"id"`
	Object       string         `json:"object"`
	MerchantID   string         `json:"merchant_id"`
	DeviceNpub   string         `json:"device_npub"`
	Platform     string         `json:"platform"`
	Label        string         `json:"label,omitempty"`
	Model        string         `json:"model,omitempty"`
	Status       string         `json:"status"`
	Integrity    map[string]any `json:"integrity"`
	Capabilities []string       `json:"capabilities"`
	TerminalID   string         `json:"terminal_id,omitempty"`
	CreatedAt    string         `json:"created_at"`
}

// DeviceInput registers a device.
type DeviceInput struct {
	DeviceNpub         string         `json:"device_npub"`
	Platform           string         `json:"platform"`
	Model              string         `json:"model"`
	Attestation        map[string]any `json:"attestation"`
	AuthorizationEvent nostr.Event    `json:"authorization_event"`
}

func (s *Service) attestor() (Attestor, error) {
	if s.attest != nil {
		return s.attest, nil
	}
	if s.cfg.Env == "production" {
		return nil, fmt.Errorf("%w: device attestation verifier", ErrDisabled)
	}
	return SandboxAttestor{}, nil
}

// RegisterDevice binds a device key to a merchant. The request carries the merchant root
// key's kind 17710 device list, which must name the device and be newer than the list the
// platform holds. Devices missing from the new list are revoked at once, with their
// terminals and sessions. Each phone gets its own terminal ID. When setRoot is true and the
// merchant has no root key yet (first enrollment from the owner's phone), the list's signer
// becomes the root key.
func (s *Service) RegisterDevice(ctx context.Context, tenantID, merchantID string, in DeviceInput, actor string, setRoot bool) (*Device, error) {
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return nil, err
	}
	if m.Status == MerchantClosed {
		return nil, fmt.Errorf("%w: merchant %s is closed", ErrMerchantInactive, m.ID)
	}
	root := m.rootPubHex
	if root == "" {
		if !setRoot {
			return nil, fmt.Errorf("%w: the merchant has no root key (root_npub); enroll the owner's phone first", ErrConflict)
		}
		root = in.AuthorizationEvent.PubKey
	}
	now := s.cfg.Now()
	listed, err := mobileauth.VerifyDeviceList(&in.AuthorizationEvent, root, m.ID, now)
	if err != nil {
		return nil, invalid("authorization_event: %v", err)
	}
	pub, err := nostr.DecodeNpub(in.DeviceNpub)
	if err != nil {
		return nil, invalid("device_npub: %v", err)
	}
	var tag *mobileauth.DeviceTag
	for i := range listed {
		if listed[i].PubKey == pub {
			tag = &listed[i]
		}
	}
	if tag == nil {
		return nil, invalid("the device list does not name %s", in.DeviceNpub)
	}
	if in.Platform != tag.Platform {
		return nil, invalid("platform %q differs from the device list (%s)", in.Platform, tag.Platform)
	}
	att, err := s.attestor()
	if err != nil {
		return nil, err
	}
	var integrity map[string]any
	var caps []string
	if len(in.Attestation) == 0 && s.strictAttestation() {
		// A phone the owner adds by its npub sends nothing here: it attests at its first login.
		integrity, caps = map[string]any{"verdict": "pending", "reason": "attests at its first login"}, []string{}
	} else if integrity, caps, err = att.Verify(ctx, in.Platform, pub, in.Attestation); err != nil {
		return nil, invalid("attestation: %v", err)
	}
	evJSON, _ := json.Marshal(in.AuthorizationEvent)
	integrityJSON, _ := json.Marshal(map[string]any{"verdict": integrity, "capabilities": caps})
	attJSON, _ := json.Marshal(in.Attestation)
	stillListed := make([]string, len(listed))
	for i, d := range listed {
		stillListed[i] = d.PubKey
	}
	var deviceID string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var heldAt *int64
		var heldID string
		if err := tx.QueryRow(ctx, `SELECT device_list_at, COALESCE(device_list->>'id', '') FROM merchants WHERE id = $1 FOR UPDATE`, m.ID).Scan(&heldAt, &heldID); err != nil {
			return err
		}
		switch {
		case heldAt == nil:
		case in.AuthorizationEvent.CreatedAt < *heldAt, in.AuthorizationEvent.CreatedAt == *heldAt && in.AuthorizationEvent.ID != heldID:
			return fmt.Errorf("%w: a newer device list (created_at %d) is already in force", ErrConflict, *heldAt)
		}
		if _, err := tx.Exec(ctx, `UPDATE merchants SET device_list = $2, device_list_at = $3, root_pubkey = COALESCE(root_pubkey, $4) WHERE id = $1`,
			m.ID, evJSON, in.AuthorizationEvent.CreatedAt, root); err != nil {
			return err
		}
		// Devices the root key dropped from the list lose access now (docs/03 §4.2 rule 2).
		rows, err := tx.Query(ctx, `UPDATE devices SET status = 'revoked', revoked_at = now() WHERE merchant_id = $1 AND status = 'active' AND NOT (pubkey = ANY($2))
			RETURNING id, COALESCE(terminal_id, '')`, m.ID, stillListed)
		if err != nil {
			return err
		}
		type gone struct{ id, terminal string }
		var revoked []gone
		for rows.Next() {
			var g gone
			if err := rows.Scan(&g.id, &g.terminal); err != nil {
				rows.Close()
				return err
			}
			revoked = append(revoked, g)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, g := range revoked {
			if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL`, g.id); err != nil {
				return err
			}
			if g.terminal != "" {
				if _, err := tx.Exec(ctx, `UPDATE terminals SET status = 'revoked', revoked_at = now(), revoked_reason = 'device removed from the device list' WHERE id = $1`, g.terminal); err != nil {
					return err
				}
			}
			if err := webhooks.Enqueue(ctx, tx, tenantID, "device.revoked", map[string]any{"id": g.id, "object": "device", "merchant_id": m.ID}); err != nil {
				return err
			}
		}
		err = tx.QueryRow(ctx, `INSERT INTO devices (id, tenant_id, merchant_id, pubkey, platform, label, model, integrity, attestation)
			VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8, $9)
			ON CONFLICT (merchant_id, pubkey) DO UPDATE SET status = 'active', revoked_at = NULL, platform = EXCLUDED.platform, label = EXCLUDED.label,
				model = EXCLUDED.model, integrity = EXCLUDED.integrity, attestation = EXCLUDED.attestation
			RETURNING id`, ids.New("dev"), tenantID, m.ID, pub, tag.Platform, tag.Label, in.Model, integrityJSON, attJSON).Scan(&deviceID)
		if err != nil {
			return err
		}
		// One terminal per phone, created on first registration and revived on re-registration.
		var terminal *string
		if err := tx.QueryRow(ctx, `SELECT terminal_id FROM devices WHERE id = $1`, deviceID).Scan(&terminal); err != nil {
			return err
		}
		if terminal == nil && tag.Platform != "web" {
			for i := 0; ; i++ {
				u := ids.ULID()
				tid := "T" + u[len(u)-7:]
				res, err := tx.Exec(ctx, `INSERT INTO terminals (id, tenant_id, merchant_id, type, device_id) VALUES ($1, $2, $3, 'mpoc_cots', $4) ON CONFLICT (id) DO NOTHING`,
					tid, tenantID, m.ID, deviceID)
				if err != nil {
					return err
				}
				if res.RowsAffected() == 1 {
					terminal = &tid
					break
				}
				if i == 4 {
					return errors.New("could not allocate a terminal ID")
				}
			}
			if _, err := tx.Exec(ctx, `UPDATE devices SET terminal_id = $2 WHERE id = $1`, deviceID, *terminal); err != nil {
				return err
			}
		} else if terminal != nil {
			if _, err := tx.Exec(ctx, `UPDATE terminals SET status = 'active', revoked_at = NULL, revoked_reason = NULL WHERE id = $1 AND revoked_reason = 'device removed from the device list'`, *terminal); err != nil {
				return err
			}
		}
		return audit(ctx, tx, tenantID, actor, "device.register", deviceID, map[string]any{"merchant_id": m.ID, "platform": tag.Platform, "revoked": len(revoked)})
	})
	if err != nil {
		return nil, err
	}
	return s.GetDevice(ctx, tenantID, deviceID)
}

// GetDevice loads a device.
func (s *Service) GetDevice(ctx context.Context, tenantID, id string) (*Device, error) {
	d := &Device{Object: "device"}
	var pub string
	var integrity []byte
	var created time.Time
	err := s.pool.QueryRow(ctx, `SELECT id, merchant_id, pubkey, platform, COALESCE(label, ''), COALESCE(model, ''), status, integrity, COALESCE(terminal_id, ''), created_at
		FROM devices WHERE tenant_id = $1 AND id = $2`, tenantID, id).Scan(&d.ID, &d.MerchantID, &pub, &d.Platform, &d.Label, &d.Model, &d.Status, &integrity, &d.TerminalID, &created)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var v struct {
		Verdict      map[string]any `json:"verdict"`
		Capabilities []string       `json:"capabilities"`
	}
	_ = json.Unmarshal(integrity, &v)
	d.Integrity, d.Capabilities = v.Verdict, v.Capabilities
	d.DeviceNpub, _ = nostr.EncodeNpub(pub)
	d.CreatedAt = created.UTC().Format(time.RFC3339)
	return d, nil
}

// ---------------------------------------------------------------- enrollment codes

// EnrollmentCode lets one phone enroll itself for a merchant.
type EnrollmentCode struct {
	Code       string `json:"code"`
	MerchantID string `json:"merchant_id"`
	ExpiresAt  string `json:"expires_at"`
}

// EnrollmentTTL is how long an enrollment code is valid.
const EnrollmentTTL = 15 * time.Minute

// CreateEnrollmentCode issues a single-use code (12 base-32 characters, 60 bits) for a
// merchant. Only its hash is stored.
func (s *Service) CreateEnrollmentCode(ctx context.Context, tenantID, merchantID, actor string) (*EnrollmentCode, error) {
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return nil, err
	}
	if m.Status == MerchantClosed {
		return nil, fmt.Errorf("%w: merchant %s is closed", ErrMerchantInactive, m.ID)
	}
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)[:12]
	code := enc[:4] + "-" + enc[4:8] + "-" + enc[8:]
	exp := s.cfg.Now().Add(EnrollmentTTL)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO enrollment_codes (code_hash, tenant_id, merchant_id, expires_at, created_by) VALUES ($1, $2, $3, $4, $5)`,
			hashCode(code), tenantID, m.ID, exp, actor); err != nil {
			return err
		}
		return audit(ctx, tx, tenantID, actor, "enrollment_code.create", m.ID, map[string]any{"expires_at": exp.UTC().Format(time.RFC3339)})
	})
	if err != nil {
		return nil, err
	}
	return &EnrollmentCode{Code: code, MerchantID: m.ID, ExpiresAt: exp.UTC().Format(time.RFC3339)}, nil
}

func hashCode(code string) string {
	norm := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	h := sha256.Sum256([]byte("enrollment:" + norm))
	return hex.EncodeToString(h[:])
}

// Enrollment is what the app learns from a valid code before it builds the device list.
type Enrollment struct {
	MerchantID string `json:"merchant_id"`
	TradeName  string `json:"trade_name"`
	RootNpub   string `json:"root_npub,omitempty"` // empty: this phone creates the merchant's root key
	ExpiresAt  string `json:"expires_at"`
}

// LookupEnrollment resolves an unused, unexpired code.
func (s *Service) LookupEnrollment(ctx context.Context, code string) (tenantID string, e *Enrollment, err error) {
	var merchantID string
	var exp time.Time
	err = s.pool.QueryRow(ctx, `SELECT tenant_id::text, merchant_id, expires_at FROM enrollment_codes WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2`,
		hashCode(code), s.cfg.Now()).Scan(&tenantID, &merchantID, &exp)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, fmt.Errorf("%w: unknown, used or expired enrollment code", mobileauth.ErrUnauthorized)
	}
	if err != nil {
		return "", nil, err
	}
	m, err := s.GetMerchant(ctx, tenantID, merchantID)
	if err != nil {
		return "", nil, err
	}
	return tenantID, &Enrollment{MerchantID: m.ID, TradeName: m.TradeName, RootNpub: m.RootNpub, ExpiresAt: exp.UTC().Format(time.RFC3339)}, nil
}

// Enroll registers the phone presenting an enrollment code and spends the code. On the
// merchant's first enrollment the device list's signer becomes the merchant's root key.
func (s *Service) Enroll(ctx context.Context, code string, in DeviceInput) (*Device, error) {
	tenantID, e, err := s.LookupEnrollment(ctx, code)
	if err != nil {
		return nil, err
	}
	// Spend the code first so two phones racing with it cannot both enroll.
	tag, err := s.pool.Exec(ctx, `UPDATE enrollment_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL`, hashCode(code))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("%w: the enrollment code was just used", mobileauth.ErrUnauthorized)
	}
	d, err := s.RegisterDevice(ctx, tenantID, e.MerchantID, in, "enrollment:"+hashCode(code)[:12], true)
	if err != nil {
		// Give the code back when the request was wrong, so the owner can fix it and retry.
		_, _ = s.pool.Exec(ctx, `UPDATE enrollment_codes SET used_at = NULL WHERE code_hash = $1`, hashCode(code))
		return nil, err
	}
	return d, nil
}

// ---------------------------------------------------------------- sessions

// Session is the API view of a new session (docs/02 §3.2).
type Session struct {
	Token      string   `json:"session_token"`
	TokenType  string   `json:"token_type"`
	ExpiresIn  int      `json:"expires_in"`
	MerchantID string   `json:"merchant_id"`
	DeviceID   string   `json:"device_id"`
	TerminalID string   `json:"terminal_id,omitempty"`
	AccountID  string   `json:"account_id"`
	Scopes     []string `json:"scopes"`
}

// SessionScopes are what a merchant app may do.
var SessionScopes = []string{"payments:write", "payments:read", "accounts:read", "settlements:read", "payouts:write"}

// SessionTTL is a session's lifetime.
const SessionTTL = 15 * time.Minute

// ConsumeNonce accepts a one-time value (a NIP-98 event ID, a DPoP jti) once across all
// replicas, for ttl.
func (s *Service) ConsumeNonce(ctx context.Context, nonce string, ttl time.Duration) (bool, error) {
	tag, err := s.pool.Exec(ctx, `INSERT INTO auth_nonces (nonce, expires_at) VALUES ($1, $2) ON CONFLICT (nonce) DO NOTHING`, nonce, s.cfg.Now().Add(ttl))
	return err == nil && tag.RowsAffected() == 1, err
}

// Login turns a verified NIP-98 login event into a session bound to the DPoP key. The
// signer must be an active, registered device of a merchant that is not closed.
func (s *Service) Login(ctx context.Context, ev *nostr.Event, deviceID string, jwk mobileauth.JWK, evidence map[string]any) (*Session, error) {
	if _, err := jwk.PublicKey(); err != nil {
		return nil, err
	}
	if ok, err := s.ConsumeNonce(ctx, "nip98:"+ev.ID, 2*mobileauth.MaxSkew); err != nil || !ok {
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("%w: this login event was already used", mobileauth.ErrUnauthorized)
	}
	var tenantID, merchantID, terminal, account, platform string
	var integrityJSON []byte
	err := s.pool.QueryRow(ctx, `SELECT d.id, d.tenant_id::text, d.merchant_id, COALESCE(d.terminal_id, ''), m.account_id, d.platform, d.integrity
		FROM devices d JOIN merchants m ON m.id = d.merchant_id
		WHERE d.pubkey = $1 AND ($2 = '' OR d.id = $2) AND d.status = 'active' AND m.status <> 'closed' ORDER BY d.created_at DESC LIMIT 1`,
		ev.PubKey, deviceID).Scan(&deviceID, &tenantID, &merchantID, &terminal, &account, &platform, &integrityJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: the signing key is not an active device", mobileauth.ErrUnauthorized)
	}
	if err != nil {
		return nil, err
	}
	var stored struct {
		Verdict map[string]any `json:"verdict"`
	}
	_ = json.Unmarshal(integrityJSON, &stored)
	if s.strictAttestation() && stored.Verdict["verdict"] != "verified" {
		if len(evidence) == 0 {
			return nil, fmt.Errorf("%w: attestation_required: this device has not attested yet; send its attestation with the login", mobileauth.ErrUnauthorized)
		}
		verdict, caps, err := s.attest.Verify(ctx, platform, ev.PubKey, evidence)
		if err != nil {
			return nil, fmt.Errorf("%w: attestation: %v", mobileauth.ErrUnauthorized, err)
		}
		b, _ := json.Marshal(map[string]any{"verdict": verdict, "capabilities": caps})
		ab, _ := json.Marshal(evidence)
		if _, err := s.pool.Exec(ctx, `UPDATE devices SET integrity = $2, attestation = $3 WHERE id = $1`, deviceID, b, ab); err != nil {
			return nil, err
		}
		stored.Verdict = verdict
	}
	// A device whose DPoP key was attested in hardware logs in with that key only: a copied
	// device key alone cannot open a session from another phone.
	if jkt, _ := stored.Verdict["dpop_jkt"].(string); jkt != "" && jkt != jwk.Thumbprint() {
		return nil, fmt.Errorf("%w: the DPoP key is not the device's attested hardware key", mobileauth.ErrUnauthorized)
	}
	token := randomToken(s.cfg.Env)
	if _, err := s.pool.Exec(ctx, `INSERT INTO sessions (token_hash, id, tenant_id, merchant_id, device_id, jkt, scopes, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		hashToken(token), ids.New("ses"), tenantID, merchantID, deviceID, jwk.Thumbprint(), SessionScopes, s.cfg.Now().Add(SessionTTL)); err != nil {
		return nil, err
	}
	return &Session{Token: token, TokenType: "DPoP", ExpiresIn: int(SessionTTL.Seconds()), MerchantID: merchantID, DeviceID: deviceID,
		TerminalID: terminal, AccountID: account, Scopes: SessionScopes}, nil
}

// SessionInfo is an authenticated session.
type SessionInfo struct {
	ID, TenantID, MerchantID, DeviceID, TerminalID, JKT string
	Scopes                                              []string
}

// SessionByToken finds a live session whose device is still active.
func (s *Service) SessionByToken(ctx context.Context, token string) (*SessionInfo, error) {
	si := &SessionInfo{}
	err := s.pool.QueryRow(ctx, `SELECT s.id, s.tenant_id::text, s.merchant_id, s.device_id, COALESCE(d.terminal_id, ''), s.jkt, s.scopes
		FROM sessions s JOIN devices d ON d.id = s.device_id JOIN merchants m ON m.id = s.merchant_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND d.status = 'active' AND m.status <> 'closed'`,
		hashToken(token), s.cfg.Now()).Scan(&si.ID, &si.TenantID, &si.MerchantID, &si.DeviceID, &si.TerminalID, &si.JKT, &si.Scopes)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: unknown, expired or revoked session", mobileauth.ErrUnauthorized)
	}
	return si, err
}

// PurgeAuthState removes expired nonces and sessions expired for a day.
func (s *Service) PurgeAuthState(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM auth_nonces WHERE expires_at < now()`); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now() - interval '1 day'`)
	return err
}

func randomToken(env string) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	var sb strings.Builder
	if env == "production" {
		sb.WriteString("sess_live_")
	} else {
		sb.WriteString("sess_test_")
	}
	for i := 0; i < 32; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		sb.WriteByte(alphabet[n.Int64()])
	}
	return sb.String()
}

func hashToken(t string) string { h := sha256.Sum256([]byte(t)); return hex.EncodeToString(h[:]) }
