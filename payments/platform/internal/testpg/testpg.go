// Package testpg gives tests a fresh, migrated PostgreSQL database.
//
// With TEST_DATABASE_URL set (CI uses a postgres service container), each test gets its
// own database on that server. Otherwise Main starts a throwaway cluster with the local
// PostgreSQL binaries for the whole test binary. Without either, tests are skipped.
package testpg

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/internal/db"
)

const envURL = "TEST_DATABASE_URL"

// Main wraps testing.M: it starts a local cluster when TEST_DATABASE_URL is unset and
// PostgreSQL binaries exist, runs the tests, and stops the cluster.
func Main(m *testing.M) {
	if os.Getenv(envURL) != "" {
		os.Exit(m.Run())
	}
	stop, err := startLocal()
	if err != nil {
		fmt.Fprintln(os.Stderr, "testpg: no PostgreSQL available, database tests will be skipped:", err)
		os.Exit(m.Run())
	}
	code := m.Run()
	stop()
	os.Exit(code)
}

// Pool returns a pool on a new, migrated database that is dropped when the test ends.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	base := os.Getenv(envURL)
	if base == "" {
		t.Skip("PostgreSQL not available (set TEST_DATABASE_URL or install PostgreSQL)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := db.Open(ctx, base)
	if err != nil {
		t.Fatalf("testpg: %v", err)
	}
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	name := "t_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		admin.Close()
		t.Fatalf("testpg: create database: %v", err)
	}
	u, _ := url.Parse(base)
	u.Path = "/" + name
	pool, err := db.Open(ctx, u.String())
	if err != nil {
		t.Fatalf("testpg: %v", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("testpg: migrate: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, _ = admin.Exec(c, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		admin.Close()
	})
	return pool
}

func pgBin(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	dirs, _ := filepath.Glob("/usr/lib/postgresql/*/bin")
	sort.Sort(sort.Reverse(sort.StringSlice(dirs)))
	for _, d := range dirs {
		p := filepath.Join(d, name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func startLocal() (func(), error) {
	initdb, pgctl := pgBin("initdb"), pgBin("pg_ctl")
	if initdb == "" || pgctl == "" {
		return nil, fmt.Errorf("initdb/pg_ctl not found")
	}
	dir, err := os.MkdirTemp("", "testpg-")
	if err != nil {
		return nil, err
	}
	data := filepath.Join(dir, "data")
	user := "postgres"
	asRoot := os.Geteuid() == 0
	run := func(bin string, args ...string) error {
		var cmd *exec.Cmd
		if asRoot {
			if err := exec.Command("chown", "-R", "postgres", dir).Run(); err != nil {
				return err
			}
			cmd = exec.Command("runuser", append([]string{"-u", "postgres", "--", bin}, args...)...)
		} else {
			cmd = exec.Command(bin, args...)
		}
		out, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("%s: %v: %s", filepath.Base(bin), err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	if !asRoot {
		if u := os.Getenv("USER"); u != "" {
			user = u
		}
	}
	if err := run(initdb, "-D", data, "-A", "trust", "-U", user, "--no-sync"); err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	port := 55000 + int(time.Now().UnixNano()%2000)
	opts := fmt.Sprintf("-k %s -p %d -c listen_addresses='' -c fsync=off -c max_connections=200", dir, port)
	if err := run(pgctl, "-D", data, "-o", opts, "-w", "start", "-l", filepath.Join(dir, "log")); err != nil {
		os.RemoveAll(dir)
		return nil, err
	}
	os.Setenv(envURL, fmt.Sprintf("postgres://%s@/postgres?host=%s&port=%d&sslmode=disable", user, dir, port))
	return func() {
		_ = run(pgctl, "-D", data, "-m", "immediate", "stop")
		os.RemoveAll(dir)
	}, nil
}
