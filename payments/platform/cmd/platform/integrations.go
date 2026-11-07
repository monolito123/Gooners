package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/monolito123/Gooners/payments/platform/internal/config"
)

// integrations prints how ready each external API connection is, from the environment alone
// (no database): which provider is live, which runs on a simulator, what is missing. -strict
// exits non-zero unless every integration production requires is live; -json is for tooling.
func integrations(_ context.Context, args []string) error {
	fs := flag.NewFlagSet("integrations", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "print JSON")
	strict := fs.Bool("strict", false, "exit 1 unless every integration production requires is live")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if os.Getenv("DATABASE_URL") == "" {
		_ = os.Setenv("DATABASE_URL", "postgres://unused") // the report never connects
	}
	c, err := config.Read() // an incomplete setup is what the report is for
	if err != nil {
		return err
	}
	is := c.Integrations()
	ready := config.Ready(is)
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(map[string]any{"env": c.Env, "production_ready": ready, "integrations": is}); err != nil {
			return err
		}
	} else {
		mark := map[string]string{config.Live: "●", config.Simulated: "◐", config.Partial: "◑", config.Off: "○"}
		fmt.Printf("goonersPAY integrations (PLATFORM_ENV=%s)\n\n", c.Env)
		w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
		fmt.Fprintln(w, "\tINTEGRATION\tSTATE\tPRODUCTION\tDETAIL")
		for _, i := range is {
			need := ""
			if i.Production {
				need = "required"
			}
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", mark[i.State], i.Name, i.State, need, i.Detail)
		}
		if err := w.Flush(); err != nil {
			return err
		}
		missing := 0
		for _, i := range is {
			if i.Production && i.State != config.Live {
				missing++
			}
		}
		if ready {
			fmt.Println("\nEvery integration production requires is live.")
		} else {
			fmt.Printf("\n%d integrations production requires are not live yet; payments/integration/README.md says what each needs.\n", missing)
		}
	}
	if *strict && !ready {
		return errors.New("not ready for production")
	}
	return nil
}
