package registrar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// This is a generic JSON contract for a registrar: what the sandbox serves and what an
// adapter to a real registrar's API translates (payments/integration/README.md).
//
//	POST /units         {"units": [Unit]}            → 204
//	POST /availability  {"keys": [UnitKey]}          → {"units": [{UnitKey, Availability}]}
//	POST /effects       Effect                       → 201, or 409 when a UR is committed
//	POST /effects/cancel {"id": "…"}                → 204

type availabilityItem struct {
	UnitKey
	Availability
}

// Handler serves m over the contract above.
func Handler(m *Memory) http.Handler {
	mux := http.NewServeMux()
	read := func(w http.ResponseWriter, r *http.Request, v any) bool {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return false
		}
		return true
	}
	mux.HandleFunc("POST /units", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Units []Unit }
		if !read(w, r, &in) {
			return
		}
		if err := m.Register(r.Context(), in.Units); err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /availability", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Keys []UnitKey }
		if !read(w, r, &in) {
			return
		}
		av, _ := m.Availability(r.Context(), in.Keys)
		out := make([]availabilityItem, 0, len(av))
		for _, k := range in.Keys {
			out = append(out, availabilityItem{k, av[k]})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"units": out})
	})
	mux.HandleFunc("POST /effects", func(w http.ResponseWriter, r *http.Request) {
		var e Effect
		if !read(w, r, &e) {
			return
		}
		switch err := m.RegisterEffect(r.Context(), e); {
		case errors.Is(err, ErrUnavailable):
			http.Error(w, err.Error(), http.StatusConflict)
		case err != nil:
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		default:
			w.WriteHeader(http.StatusCreated)
		}
	})
	mux.HandleFunc("POST /effects/cancel", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ ID string }
		if !read(w, r, &in) {
			return
		}
		_ = m.CancelEffect(r.Context(), in.ID)
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

// Client calls a registrar that speaks the contract above.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

func (c *Client) post(ctx context.Context, path string, in, out any) error {
	b, _ := json.Marshal(in)
	req, err := http.NewRequestWithContext(ctx, "POST", c.BaseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode == http.StatusConflict:
		return fmt.Errorf("%w: %s", ErrUnavailable, bytes.TrimSpace(body))
	case resp.StatusCode >= 300:
		return fmt.Errorf("registrar: %s %s: HTTP %d %s", "POST", path, resp.StatusCode, bytes.TrimSpace(body))
	case out != nil:
		return json.Unmarshal(body, out)
	}
	return nil
}

// Register implements Registrar.
func (c *Client) Register(ctx context.Context, units []Unit) error {
	return c.post(ctx, "/units", map[string]any{"units": units}, nil)
}

// Availability implements Registrar.
func (c *Client) Availability(ctx context.Context, keys []UnitKey) (map[UnitKey]Availability, error) {
	var out struct{ Units []availabilityItem }
	if err := c.post(ctx, "/availability", map[string]any{"keys": keys}, &out); err != nil {
		return nil, err
	}
	m := make(map[UnitKey]Availability, len(out.Units))
	for _, u := range out.Units {
		m[u.UnitKey] = u.Availability
	}
	return m, nil
}

// RegisterEffect implements Registrar.
func (c *Client) RegisterEffect(ctx context.Context, e Effect) error {
	return c.post(ctx, "/effects", e, nil)
}

// CancelEffect implements Registrar.
func (c *Client) CancelEffect(ctx context.Context, id string) error {
	return c.post(ctx, "/effects/cancel", map[string]any{"id": id}, nil)
}
