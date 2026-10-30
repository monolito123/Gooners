// Package netguard keeps outbound calls to partner-supplied URLs (webhook endpoints) on the
// public internet. Without it a partner could register http://169.254.169.254/… or an
// internal service and have the platform call it (server-side request forgery).
//
// Two layers: URLs are validated when they are registered, and the dialer refuses
// non-public addresses at connection time, after DNS resolution, so a hostname that later
// resolves to a private address (DNS rebinding) is refused too. Redirects are not followed.
package netguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// ErrForbiddenAddress is returned for loopback, private, link-local and other non-public addresses.
var ErrForbiddenAddress = errors.New("netguard: address is not public")

var nonPublic = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), // carrier-grade NAT
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), // link-local, cloud metadata
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("64:ff9b::/96"), // NAT64 can reach IPv4 private space
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("fc00::/7"),  // unique local
	netip.MustParsePrefix("fe80::/10"), // link-local
	netip.MustParsePrefix("ff00::/8"),
}

// IsPublic reports whether ip is a globally routable unicast address.
func IsPublic(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() {
		return false
	}
	for _, p := range nonPublic {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// Policy says what outbound calls may reach.
type Policy struct {
	AllowPrivate bool // the sandbox only: partners' test receivers on a local network
	RequireHTTPS bool // everywhere outside the sandbox
}

// ValidateURL checks a partner-supplied URL when it is registered.
func (p Policy) ValidateURL(ctx context.Context, raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Opaque != "" {
		return fmt.Errorf("netguard: %q is not an absolute URL", raw)
	}
	switch u.Scheme {
	case "https":
	case "http":
		if p.RequireHTTPS {
			return errors.New("netguard: webhook URLs must be https")
		}
	default:
		return fmt.Errorf("netguard: scheme %q is not allowed", u.Scheme)
	}
	if u.User != nil {
		return errors.New("netguard: credentials in the URL are not allowed")
	}
	host := u.Hostname()
	if p.AllowPrivate {
		return nil
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		if !IsPublic(ip) {
			return fmt.Errorf("%w: %s", ErrForbiddenAddress, host)
		}
		return nil
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".localhost") || !strings.Contains(host, ".") {
		return fmt.Errorf("%w: %s", ErrForbiddenAddress, host)
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return fmt.Errorf("netguard: cannot resolve %s: %v", host, err)
	}
	for _, ip := range ips {
		if !IsPublic(ip) {
			return fmt.Errorf("%w: %s resolves to %s", ErrForbiddenAddress, host, ip)
		}
	}
	return nil
}

// control refuses connections to non-public addresses, after resolution.
func control(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return fmt.Errorf("netguard: %v", err)
	}
	if !IsPublic(ap.Addr()) {
		return fmt.Errorf("%w: %s", ErrForbiddenAddress, ap.Addr())
	}
	return nil
}

// Client returns an HTTP client for partner URLs: public addresses only (unless the policy
// allows private ones), no redirects, no proxy from the environment, and a timeout.
func (p Policy) Client(timeout time.Duration) *http.Client {
	d := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	if !p.AllowPrivate {
		d.Control = control
	}
	tr := &http.Transport{
		Proxy:                 nil, // an environment proxy would hide the destination from the check
		DialContext:           d.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: timeout,
	}
	return &http.Client{
		Transport: tr,
		Timeout:   timeout,
		// A redirect is the classic way around a URL check: it counts as a failed delivery.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}
