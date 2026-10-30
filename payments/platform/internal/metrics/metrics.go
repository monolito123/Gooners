// Package metrics exposes counters and scrape-time gauges in the Prometheus text format
// (version 0.0.4), without a client library: the platform needs a handful of series and
// no dependency for them.
package metrics

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Sample is one gauge value with its labels.
type Sample struct {
	Labels map[string]string
	Value  float64
}

// GaugeFunc computes a gauge's samples at scrape time.
type GaugeFunc func(ctx context.Context) ([]Sample, error)

type gauge struct {
	name, help string
	f          GaugeFunc
}

// Registry holds the series.
type Registry struct {
	mu       sync.Mutex
	counters map[string]*CounterVec
	gauges   []gauge
	Logger   *slog.Logger
}

// Default is the process-wide registry.
var Default = NewRegistry()

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return &Registry{counters: map[string]*CounterVec{}} }

// CounterVec is a counter with labels.
type CounterVec struct {
	name, help string
	labels     []string
	mu         sync.Mutex
	values     map[string]float64
}

// Counter returns the counter named name, creating it on first use.
func (r *Registry) Counter(name, help string, labels ...string) *CounterVec {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.counters[name]; ok {
		return c
	}
	c := &CounterVec{name: name, help: help, labels: labels, values: map[string]float64{}}
	r.counters[name] = c
	return c
}

// Add adds v for the label values (in the order the labels were declared).
func (c *CounterVec) Add(v float64, values ...string) {
	if len(values) != len(c.labels) {
		panic(fmt.Sprintf("metrics: %s takes %d label values", c.name, len(c.labels)))
	}
	c.mu.Lock()
	c.values[strings.Join(values, "\xff")] += v
	c.mu.Unlock()
}

// Inc adds one.
func (c *CounterVec) Inc(values ...string) { c.Add(1, values...) }

// Gauge registers a scrape-time gauge.
func (r *Registry) Gauge(name, help string, f GaugeFunc) {
	r.mu.Lock()
	r.gauges = append(r.gauges, gauge{name, help, f})
	r.mu.Unlock()
}

// Write renders every series.
func (r *Registry) Write(ctx context.Context, w io.Writer) {
	r.mu.Lock()
	names := make([]string, 0, len(r.counters))
	for n := range r.counters {
		names = append(names, n)
	}
	gauges := slices.Clone(r.gauges)
	r.mu.Unlock()
	slices.Sort(names)
	for _, n := range names {
		c := r.counters[n]
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n", n, c.help, n)
		c.mu.Lock()
		keys := make([]string, 0, len(c.values))
		for k := range c.values {
			keys = append(keys, k)
		}
		slices.Sort(keys)
		for _, k := range keys {
			labels := map[string]string{}
			if len(c.labels) > 0 {
				for i, v := range strings.Split(k, "\xff") {
					labels[c.labels[i]] = v
				}
			}
			fmt.Fprintf(w, "%s%s %s\n", n, render(labels), strconv.FormatFloat(c.values[k], 'g', -1, 64))
		}
		c.mu.Unlock()
	}
	for _, g := range gauges {
		samples, err := g.f(ctx)
		if err != nil {
			if r.Logger != nil {
				r.Logger.Warn("metrics gauge failed", "gauge", g.name, "err", err)
			}
			continue
		}
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s gauge\n", g.name, g.help, g.name)
		for _, s := range samples {
			fmt.Fprintf(w, "%s%s %s\n", g.name, render(s.Labels), strconv.FormatFloat(s.Value, 'g', -1, 64))
		}
	}
}

func render(labels map[string]string) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		v := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(labels[k])
		parts[i] = k + `="` + v + `"`
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// Handler serves GET /metrics. Mount it on an internal listener, not the public API.
func (r *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
		defer cancel()
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		r.Write(ctx, w)
	})
}
