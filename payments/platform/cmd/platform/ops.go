package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/monolito123/Gooners/payments/platform/internal/config"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/payments"
)

// opsCommands are the operator commands (see the package comment and the runbook).
var opsCommands = map[string]func(context.Context, []string) error{
	"merchant-status":  merchantStatus,
	"terminal-revoke":  terminalRevoke,
	"apikey-list":      apikeyList,
	"apikey-revoke":    apikeyRevoke,
	"disputes-import":  disputesImport,
	"disputes-list":    disputesList,
	"write-off":        writeOff,
	"recon-card":       reconCard,
	"recon-pix":        reconPix,
	"recon-exceptions": reconExceptions,
	"recon-resolve":    reconResolve,
	"recon-allocate":   reconAllocate,
}

type opsFlags struct {
	*flag.FlagSet
	tenant, reason, actor *string
}

func newOps(name string, args []string, define func(fs *flag.FlagSet)) (*opsFlags, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	o := &opsFlags{FlagSet: fs, tenant: fs.String("tenant", "", "tenant UUID"), reason: fs.String("reason", "", "why (kept in the audit trail)"),
		actor: fs.String("actor", "", "operator identity (SSO subject), kept in the audit trail")}
	if define != nil {
		define(fs)
	}
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if *o.tenant == "" {
		return nil, errors.New("-tenant is required")
	}
	return o, nil
}

func (o *opsFlags) requireActor() error {
	if *o.reason == "" || *o.actor == "" {
		return errors.New("-reason and -actor are required")
	}
	return nil
}

// withService runs f with a service backed by the database only (no card host or PSP).
func withService(ctx context.Context, f func(*payments.Service) error) error {
	return withDB(ctx, func(pool *pgxpool.Pool) error {
		if err := requireMigrated(ctx, pool); err != nil {
			return err
		}
		return f(payments.New(payments.Config{}, payments.Deps{Pool: pool, Ledger: ledger.New(pool, log), Logger: log}))
	})
}

func requireMigrated(ctx context.Context, pool *pgxpool.Pool) error {
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&n); err != nil {
		return fmt.Errorf("the database is not migrated (run platform migrate): %w", err)
	}
	return nil
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func merchantStatus(ctx context.Context, args []string) error {
	var merchant, status string
	o, err := newOps("merchant-status", args, func(fs *flag.FlagSet) {
		fs.StringVar(&merchant, "merchant", "", "merchant ID")
		fs.StringVar(&status, "status", "", "active, restricted or closed")
	})
	if err != nil {
		return err
	}
	if err := o.requireActor(); err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		m, err := svc.SetMerchantStatus(ctx, *o.tenant, merchant, status, *o.reason, *o.actor)
		if err != nil {
			return err
		}
		return printJSON(m)
	})
}

func terminalRevoke(ctx context.Context, args []string) error {
	var terminal string
	o, err := newOps("terminal-revoke", args, func(fs *flag.FlagSet) { fs.StringVar(&terminal, "terminal", "", "terminal ID") })
	if err != nil {
		return err
	}
	if err := o.requireActor(); err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		t, err := svc.RevokeTerminal(ctx, *o.tenant, terminal, *o.reason, *o.actor)
		if err != nil {
			return err
		}
		return printJSON(t)
	})
}

func apikeyList(ctx context.Context, args []string) error {
	o, err := newOps("apikey-list", args, nil)
	if err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		keys, err := svc.ListAPIKeys(ctx, *o.tenant)
		if err != nil {
			return err
		}
		return printJSON(keys)
	})
}

func apikeyRevoke(ctx context.Context, args []string) error {
	var id string
	o, err := newOps("apikey-revoke", args, func(fs *flag.FlagSet) { fs.StringVar(&id, "id", "", "key ID (ak_…, from apikey-list)") })
	if err != nil {
		return err
	}
	if err := o.requireActor(); err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error { return svc.RevokeAPIKey(ctx, *o.tenant, id, *o.reason, *o.actor) })
}

func disputesImport(ctx context.Context, args []string) error {
	var file string
	o, err := newOps("disputes-import", args, func(fs *flag.FlagSet) { fs.StringVar(&file, "file", "", "chargeback notice CSV") })
	if err != nil {
		return err
	}
	f, err := os.Open(file) // #nosec G304 -- operator command, file named on its command line
	if err != nil {
		return err
	}
	defer f.Close()
	notices, err := payments.ParseDisputeCSV(f, filepath.Base(file))
	if err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		failed := 0
		for _, n := range notices {
			d, err := svc.ApplyDisputeNotice(ctx, *o.tenant, n)
			if err != nil {
				failed++
				log.Error("dispute notice", "source", n.Source, "case", n.NetworkCaseID, "event", n.Event, "err", err)
				continue
			}
			log.Info("dispute notice", "source", n.Source, "dispute", d.ID, "status", d.Status)
		}
		if failed > 0 {
			return fmt.Errorf("%d of %d notices failed; fix them and import the file again (applied notices are skipped)", failed, len(notices))
		}
		return nil
	})
}

func disputesList(ctx context.Context, args []string) error {
	var status string
	o, err := newOps("disputes-list", args, func(fs *flag.FlagSet) { fs.StringVar(&status, "status", "", "filter by status") })
	if err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		ds, _, err := svc.ListDisputes(ctx, *o.tenant, status, "", "", 100)
		if err != nil {
			return err
		}
		return printJSON(ds)
	})
}

func writeOff(ctx context.Context, args []string) error {
	var merchant string
	o, err := newOps("write-off", args, func(fs *flag.FlagSet) { fs.StringVar(&merchant, "merchant", "", "merchant ID") })
	if err != nil {
		return err
	}
	if err := o.requireActor(); err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		n, err := svc.WriteOffShortfall(ctx, *o.tenant, merchant, *o.reason, *o.actor)
		if err == nil {
			log.Info("written off", "merchant", merchant, "amount", n)
		}
		return err
	})
}

func reconCard(ctx context.Context, args []string) error {
	var report, date, file string
	o, err := newOps("recon-card", args, func(fs *flag.FlagSet) {
		fs.StringVar(&report, "report", "", "settlement report ID (unique per report)")
		fs.StringVar(&date, "date", time.Now().In(payments.BRT).Format("2006-01-02"), "settlement date (Brasília)")
		fs.StringVar(&file, "file", "", "settlement report CSV")
	})
	if err != nil {
		return err
	}
	day, err := time.ParseInLocation("2006-01-02", date, payments.BRT)
	if err != nil {
		return err
	}
	f, err := os.Open(file) // #nosec G304 -- operator command, file named on its command line
	if err != nil {
		return err
	}
	defer f.Close()
	lines, err := payments.ParseSettlementCSV(f)
	if err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		run, err := svc.ReconcileCardReport(ctx, *o.tenant, report, day, lines)
		if err != nil {
			return err
		}
		return printJSON(run)
	})
}

func reconPix(ctx context.Context, args []string) error {
	var date string
	o, err := newOps("recon-pix", args, func(fs *flag.FlagSet) {
		fs.StringVar(&date, "date", time.Now().In(payments.BRT).AddDate(0, 0, -1).Format("2006-01-02"), "business day (Brasília time)")
	})
	if err != nil {
		return err
	}
	day, err := time.ParseInLocation("2006-01-02", date, payments.BRT)
	if err != nil {
		return err
	}
	c, err := config.Load()
	if err != nil {
		return err
	}
	pix, _, err := pixClients(c)
	if err != nil {
		return err
	}
	if pix == nil {
		return errors.New("PIX_BASE_URL and the PSP credentials are required")
	}
	return withDB(ctx, func(pool *pgxpool.Pool) error {
		svc := payments.New(payments.Config{Env: c.Env, PixKey: c.PixKey}, payments.Deps{Pool: pool, Ledger: ledger.New(pool, log), Pix: pix, Logger: log})
		run, err := svc.ReconcilePix(ctx, *o.tenant, day)
		if err != nil {
			return err
		}
		return printJSON(run)
	})
}

func reconExceptions(ctx context.Context, args []string) error {
	o, err := newOps("recon-exceptions", args, nil)
	if err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		ex, err := svc.OpenExceptions(ctx, *o.tenant)
		if err != nil {
			return err
		}
		return printJSON(ex)
	})
}

func reconResolve(ctx context.Context, args []string) error {
	var id int64
	var resolution string
	o, err := newOps("recon-resolve", args, func(fs *flag.FlagSet) {
		fs.Int64Var(&id, "id", 0, "exception ID (from recon-exceptions)")
		fs.StringVar(&resolution, "resolution", "", "what was done")
	})
	if err != nil {
		return err
	}
	if *o.actor == "" {
		return errors.New("-actor is required")
	}
	return withService(ctx, func(svc *payments.Service) error {
		return svc.ResolveException(ctx, *o.tenant, id, resolution, *o.actor)
	})
}

func reconAllocate(ctx context.Context, args []string) error {
	var amount int64
	var account string
	o, err := newOps("recon-allocate", args, func(fs *flag.FlagSet) {
		fs.Int64Var(&amount, "amount", 0, "centavos: positive clears cash received, negative clears cash taken")
		fs.StringVar(&account, "to", "", "counter-account, e.g. asset.settlement_bank or liability.merchant_wallet.mer_…")
	})
	if err != nil {
		return err
	}
	if err := o.requireActor(); err != nil {
		return err
	}
	return withService(ctx, func(svc *payments.Service) error {
		return svc.AllocateSuspense(ctx, *o.tenant, amount, account, *o.reason, *o.actor)
	})
}
