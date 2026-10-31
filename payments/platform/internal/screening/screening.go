// Package screening checks crypto addresses against sanctions lists before the platform sends
// anything to them (docs/09 §6.1). A List reads published lists (OFAC's SDN.CSV, whose
// remarks carry "Digital Currency Address - XBT …", or one address per line, such as lists
// extracted from OFAC's data or a compliance team's own); a Service asks a screening
// provider through a small JSON contract an adapter translates. Set asks them all and fails
// closed: an error is never a pass.
package screening

import (
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Result is what screening found about one address.
type Result struct {
	Hit     bool     `json:"hit"`
	Sources []string `json:"sources"` // what was consulted
	Matches []string `json:"matches"` // which entries matched, and where
}

// Screener checks one address.
type Screener interface {
	Name() string
	Screen(ctx context.Context, network, address string) (hit bool, match string, err error)
}

// ErrStale is a list too old to rely on.
var ErrStale = errors.New("screening: list is stale")

// NameScreener checks a person's or an entity's name (the names in travel-rule messages).
type NameScreener interface {
	Name() string
	ScreenName(ctx context.Context, name string) (hit bool, match string, err error)
	// HasNames reports whether there are names to screen against (an address list has none).
	HasNames() bool
}

// Set screens with every screener: a hit anywhere is a hit, an error anywhere is an error.
type Set []Screener

// Screen implements the policy: all sources are asked, so the record shows each of them.
func (s Set) Screen(ctx context.Context, network, address string) (Result, error) {
	if len(s) == 0 {
		return Result{}, errors.New("screening: no list or service is configured")
	}
	var r Result
	var errs []error
	for _, x := range s {
		r.Sources = append(r.Sources, x.Name())
		hit, match, err := x.Screen(ctx, network, address)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", x.Name(), err))
			continue
		}
		if hit {
			r.Hit = true
			r.Matches = append(r.Matches, x.Name()+": "+match)
		}
	}
	return r, errors.Join(errs...)
}

// ScreenName screens a name with every screener that holds names. A Set whose sources
// hold no names (address lists, a provider's address contract) consults nothing and
// answers with no sources: the name was not screened.
func (s Set) ScreenName(ctx context.Context, name string) (Result, error) {
	var r Result
	var errs []error
	for _, x := range s {
		n, ok := x.(NameScreener)
		if !ok || !n.HasNames() {
			continue
		}
		r.Sources = append(r.Sources, n.Name())
		hit, match, err := n.ScreenName(ctx, name)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", n.Name(), err))
			continue
		}
		if hit {
			r.Hit = true
			r.Matches = append(r.Matches, n.Name()+": "+match)
		}
	}
	return r, errors.Join(errs...)
}

// NameKey is the form names are compared in: capitals without accents, punctuation as
// spaces, the particles of Portuguese and Spanish names left out, the words sorted. So
// "AL-ZAWAHIRI, Ayman" and "Ayman al-Zawahiri" are the same name, and "João da Silva" is
// "Joao Silva". A name of one short word is not compared (too many people share it).
func NameKey(name string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(name) {
		if f, ok := folded[r]; ok {
			r = f
		}
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	var words []string
	for _, w := range strings.Fields(b.String()) {
		if !particles[w] {
			words = append(words, w)
		}
	}
	if len(words) == 0 || (len(words) == 1 && len(words[0]) < 5) {
		return ""
	}
	sort.Strings(words)
	return strings.Join(words, " ")
}

var folded = map[rune]rune{
	'Á': 'A', 'À': 'A', 'Â': 'A', 'Ã': 'A', 'Ä': 'A', 'Å': 'A', 'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E', 'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
	'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O', 'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U', 'Ç': 'C', 'Ñ': 'N', 'Ý': 'Y',
}

var particles = map[string]bool{"DE": true, "DA": true, "DO": true, "DAS": true, "DOS": true, "E": true, "DEL": true, "LA": true, "Y": true}

// Normalize is the form addresses are compared in: hexadecimal (0x…) and bech32 (bc1…)
// addresses are case-insensitive; base58 addresses (Tron, Solana, legacy Bitcoin) are not.
func Normalize(address string) string {
	a := strings.TrimSpace(address)
	l := strings.ToLower(a)
	if strings.HasPrefix(l, "0x") || strings.HasPrefix(l, "bc1") || strings.HasPrefix(l, "tb1") || strings.HasPrefix(l, "ltc1") {
		return l
	}
	return a
}

// ---------------------------------------------------------------- lists

// ParseNames reads the names of OFAC's SDN.CSV (its second column) for individuals and
// entities; vessels and aircraft are left out. A file that is not the SDN list gives none.
func ParseNames(r io.Reader, label string) (map[string]string, error) {
	cr := csv.NewReader(r)
	cr.LazyQuotes, cr.FieldsPerRecord, cr.ReuseRecord = true, -1, true
	out := map[string]string{}
	for {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return out, nil // not a CSV: an address list
		}
		if len(rec) < 3 || rec[2] == "vessel" || rec[2] == "aircraft" {
			continue
		}
		if k := NameKey(rec[1]); k != "" {
			out[k] = label + " (" + strings.TrimSpace(rec[1]) + ")"
		}
	}
}

var ofacFeature = regexp.MustCompile(`Digital Currency Address - ([A-Z0-9]+)\s+([A-Za-z0-9:]+)`)

// Parse reads a list: OFAC's SDN.CSV (every "Digital Currency Address - CODE address" in it)
// or, when there are none, one address per line, with # comments. It returns each address,
// normalized, with a label saying where it came from.
func Parse(r io.Reader, label string) (map[string]string, error) {
	raw, err := io.ReadAll(io.LimitReader(r, 256<<20))
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, m := range ofacFeature.FindAllStringSubmatch(string(raw), -1) {
		out[Normalize(m[2])] = label + " (" + m[1] + ")"
	}
	if len(out) > 0 {
		return out, nil
	}
	sc := bufio.NewScanner(strings.NewReader(string(raw)))
	sc.Buffer(make([]byte, 64<<10), 64<<10)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if f := strings.Fields(line); len(f) > 0 {
			out[Normalize(f[0])] = label
		}
	}
	return out, sc.Err()
}

// List is a set of sanctioned addresses loaded from files or https URLs, refreshed by
// Refresh. A list older than MaxAge answers with ErrStale: screening against last month's
// list is not screening.
type List struct {
	Sources []string // paths or https URLs
	Client  *http.Client
	MaxAge  time.Duration // default 72 hours
	Now     func() time.Time

	mu       sync.RWMutex
	set      map[string]string
	names    map[string]string // from SDN.CSV, by NameKey
	loadedAt time.Time
}

// Name implements Screener.
func (l *List) Name() string { return "lists:" + strings.Join(l.labels(), ",") }

func (l *List) labels() []string {
	out := make([]string, len(l.Sources))
	for i, s := range l.Sources {
		out[i] = label(s)
	}
	return out
}

func label(source string) string {
	if u, err := url.Parse(source); err == nil && u.Host != "" {
		return u.Host + u.Path
	}
	return source
}

func (l *List) now() time.Time {
	if l.Now != nil {
		return l.Now()
	}
	return time.Now()
}

// Load reads every source; the lists replace the old ones only if all of them load.
func (l *List) Load(ctx context.Context) error {
	set, names := map[string]string{}, map[string]string{}
	for _, src := range l.Sources {
		rc, err := l.open(ctx, src)
		if err != nil {
			return fmt.Errorf("screening: %s: %w", src, err)
		}
		raw, err := io.ReadAll(io.LimitReader(rc, 256<<20))
		rc.Close()
		if err != nil {
			return fmt.Errorf("screening: %s: %w", src, err)
		}
		m, err := Parse(bytes.NewReader(raw), label(src))
		if err != nil {
			return fmt.Errorf("screening: %s: %w", src, err)
		}
		for k, v := range m {
			set[k] = v
		}
		if ofacFeature.Match(raw) { // the SDN list: its names too
			ns, _ := ParseNames(bytes.NewReader(raw), label(src))
			for k, v := range ns {
				names[k] = v
			}
		}
	}
	l.mu.Lock()
	l.set, l.names, l.loadedAt = set, names, l.now()
	l.mu.Unlock()
	return nil
}

func (l *List) open(ctx context.Context, src string) (io.ReadCloser, error) {
	if !strings.HasPrefix(src, "https://") && !strings.HasPrefix(src, "http://") {
		return os.Open(filepath.Clean(src)) // #nosec G304 -- a path from the operator's configuration (SANCTIONS_LISTS), not from a request
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		return nil, err
	}
	c := l.Client
	if c == nil {
		c = &http.Client{Timeout: 2 * time.Minute}
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return resp.Body, nil
}

// Refresh reloads the lists every interval until ctx ends; a failed reload keeps the old
// lists, which become stale after MaxAge.
func (l *List) Refresh(ctx context.Context, every time.Duration, logf func(string, ...any)) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := l.Load(ctx); err != nil && logf != nil {
				logf("sanctions lists not refreshed", "err", err)
			}
		}
	}
}

// Size is how many addresses the lists hold.
func (l *List) Size() int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return len(l.set)
}

// Screen implements Screener.
func (l *List) Screen(_ context.Context, _ string, address string) (bool, string, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	maxAge := l.MaxAge
	if maxAge == 0 {
		maxAge = 72 * time.Hour
	}
	if l.set == nil || l.now().Sub(l.loadedAt) > maxAge {
		return false, "", ErrStale
	}
	if src, ok := l.set[Normalize(address)]; ok {
		return true, src, nil
	}
	return false, "", nil
}

// HasNames implements NameScreener: whether an SDN list was loaded.
func (l *List) HasNames() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return len(l.names) > 0
}

// ScreenName implements NameScreener.
func (l *List) ScreenName(_ context.Context, name string) (bool, string, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	maxAge := l.MaxAge
	if maxAge == 0 {
		maxAge = 72 * time.Hour
	}
	if l.set == nil || l.now().Sub(l.loadedAt) > maxAge {
		return false, "", ErrStale
	}
	k := NameKey(name)
	if src, ok := l.names[k]; ok && k != "" {
		return true, src, nil
	}
	return false, "", nil
}

// StaticNames is a fixed list of names (the sandbox's test names, tests), keyed by NameKey.
type StaticNames map[string]string

// Name implements NameScreener.
func (StaticNames) Name() string { return "static-names" }

// HasNames implements NameScreener.
func (s StaticNames) HasNames() bool { return len(s) > 0 }

// Screen implements Screener: names hold no addresses.
func (StaticNames) Screen(context.Context, string, string) (bool, string, error) {
	return false, "", nil
}

// ScreenName implements NameScreener.
func (s StaticNames) ScreenName(_ context.Context, name string) (bool, string, error) {
	for k, v := range s {
		if NameKey(k) == NameKey(name) && NameKey(name) != "" {
			return true, v, nil
		}
	}
	return false, "", nil
}

// SandboxNames is the sandbox's sanctioned test name: a withdrawal to it, or a deposit from
// it, shows what name screening does. It names nobody.
var SandboxNames = StaticNames{"Sandbox Sanctioned Person": "sandbox test list"}

// Static is a fixed list (the sandbox's test addresses, tests).
type Static map[string]string

// Name implements Screener.
func (s Static) Name() string { return "static" }

// Screen implements Screener.
func (s Static) Screen(_ context.Context, _ string, address string) (bool, string, error) {
	for k, v := range s {
		if Normalize(k) == Normalize(address) {
			return true, v, nil
		}
	}
	return false, "", nil
}

// SandboxAddresses are the sandbox's sanctioned test addresses: withdrawals to them are
// refused, so integrations can see the refusal. They are synthetic, not real addresses.
var SandboxAddresses = Static{
	"0x0000000000000000000000000000000000000bad": "sandbox test list",
	"TSanctionedTestAddressForSandbox12":         "sandbox test list",
}

// ---------------------------------------------------------------- a screening provider

// Service asks a screening provider about each address, through a contract an adapter
// translates to the provider's own API:
//
//	GET {URL}?network=…&address=…   (header Authorization: Bearer {Token})
//	→ {"sanctioned": true|false, "matches": [{"list": "OFAC SDN", "name": "…"}]}
type Service struct {
	URL, Token, Label string
	Client            *http.Client
}

// Name implements Screener.
func (s *Service) Name() string {
	if s.Label != "" {
		return s.Label
	}
	return label(s.URL)
}

// Screen implements Screener.
func (s *Service) Screen(ctx context.Context, network, address string) (bool, string, error) {
	u := s.URL + "?" + url.Values{"network": {network}, "address": {address}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return false, "", err
	}
	if s.Token != "" {
		req.Header.Set("Authorization", "Bearer "+s.Token)
	}
	c := s.Client
	if c == nil {
		c = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := c.Do(req)
	if err != nil {
		return false, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var r struct {
		Sanctioned *bool `json:"sanctioned"`
		Matches    []struct {
			List string `json:"list"`
			Name string `json:"name"`
		} `json:"matches"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&r); err != nil {
		return false, "", err
	}
	if r.Sanctioned == nil {
		return false, "", errors.New("the answer has no \"sanctioned\" field")
	}
	ms := make([]string, 0, len(r.Matches))
	for _, m := range r.Matches {
		ms = append(ms, strings.TrimSpace(m.List+" "+m.Name))
	}
	sort.Strings(ms)
	return *r.Sanctioned, strings.Join(ms, "; "), nil
}
