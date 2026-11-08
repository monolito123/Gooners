package screening

import (
	"context"
	"strings"
)

// Possible matches. A name that is on a list is a hit; a name that resembles one, spelled
// another way, is a possible match: never a hit, always a person's review. Transliteration
// gives one name many spellings (MOHAMMED, MUHAMMAD, MOHAMED; QADHAFI, GADDAFI), and partial
// names are common (AYMAN ZAWAHIRI for AYMAN MUHAMMAD RABI AL-ZAWAHIRI), so exact comparison
// alone misses listed persons. Every rule here can be explained to the reviewer:
//
//   - every word of the shorter name (at least two words) matches a word of the longer one:
//     the same word, one edit apart (words of five letters or more), or the same consonant
//     skeleton (words of five letters or more);
//   - and the shorter name covers at least half of the longer one's words.

// PossibleNameScreener finds the list's names that resemble a name without being it.
type PossibleNameScreener interface {
	PossibleNames(ctx context.Context, name string) ([]string, error)
}

// Resembles reports whether a and b may name the same person or entity (see the rules
// above). Equal names are a hit, not a resemblance: Resembles reports false for them.
func Resembles(a, b string) bool {
	ka, kb := NameKey(a), NameKey(b)
	if ka == "" || kb == "" || ka == kb {
		return false
	}
	return resembleKeys(fuzzyWords(ka), fuzzyWords(kb))
}

func resembleKeys(x, y []string) bool {
	if len(x) > len(y) {
		x, y = y, x
	}
	if len(x) < 2 || 2*len(x) < len(y) {
		return false
	}
	used := make([]bool, len(y))
	for _, w := range x {
		found := false
		for i, v := range y {
			if !used[i] && wordsMatch(w, v) {
				used[i], found = true, true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func wordsMatch(a, b string) bool {
	if a == b {
		return true
	}
	if len(a) < 5 || len(b) < 5 {
		return false
	}
	if editDistance(a, b) <= 1 {
		return true
	}
	sa, sb := skeleton(a), skeleton(b)
	return len(sa) >= 3 && sa == sb
}

// skeleton is a word's consonants as transliterations blur them: an initial vowel is A,
// C/G/K/Q are K, H is dropped (DH, KH, SH, TH are one sound), other vowels are dropped, and
// repeats collapse.
func skeleton(w string) string {
	var b strings.Builder
	var prev byte
	for i := 0; i < len(w); i++ {
		c := w[i]
		if c == 'C' || c == 'G' || c == 'Q' {
			c = 'K'
		}
		doubled := c == prev // MM in MOHAMMED: one sound
		prev = c
		if doubled {
			continue
		}
		switch c {
		case 'A', 'E', 'I', 'O', 'U', 'Y':
			if i == 0 {
				b.WriteByte('A')
			}
		case 'H', 'W':
			if i == 0 {
				b.WriteByte(c)
			}
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

// fuzzyWords are a name key's words without the Arabic name particles (AL, BIN...), which
// lists and people write or leave out at will.
func fuzzyWords(key string) []string {
	var out []string
	for _, w := range strings.Fields(key) {
		if !arabicParticles[w] {
			out = append(out, w)
		}
	}
	return out
}

var arabicParticles = map[string]bool{"AL": true, "EL": true, "BIN": true, "BEN": true, "IBN": true, "BINT": true}

// editDistance is the optimal string alignment distance: insertions, deletions,
// substitutions and swaps of neighbours each cost one.
func editDistance(a, b string) int {
	d := make([][]int, len(a)+1)
	for i := range d {
		d[i] = make([]int, len(b)+1)
		d[i][0] = i
	}
	for j := range d[0] {
		d[0][j] = j
	}
	for i := 1; i <= len(a); i++ {
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost)
			if i > 1 && j > 1 && a[i-1] == b[j-2] && a[i-2] == b[j-1] {
				d[i][j] = min(d[i][j], d[i-2][j-2]+1)
			}
		}
	}
	return d[len(a)][len(b)]
}

// PossibleNames implements PossibleNameScreener.
func (l *List) PossibleNames(_ context.Context, name string) ([]string, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if !l.fresh() {
		return nil, ErrStale
	}
	k := NameKey(name)
	if k == "" {
		return nil, nil
	}
	q := fuzzyWords(k)
	var out []string
	for key, src := range l.names {
		if key != k && resembleKeys(q, l.tokens[key]) {
			out = append(out, src)
		}
	}
	return out, nil
}

// PossibleNames implements PossibleNameScreener.
func (s StaticNames) PossibleNames(_ context.Context, name string) ([]string, error) {
	var out []string
	for k, v := range s {
		if Resembles(k, name) {
			out = append(out, v)
		}
	}
	return out, nil
}
