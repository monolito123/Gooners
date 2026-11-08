package payments

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/monolito123/Gooners/payments/platform/internal/ids"
	"github.com/monolito123/Gooners/payments/platform/internal/ledger"
	"github.com/monolito123/Gooners/payments/platform/internal/webhooks"
)

// Transfers (docs/02 §6.5) move available money between two merchants' accounts of one
// tenant: a marketplace paying a seller a bonus, a franchise moving funds between its stores.
// A transfer is one ledger journal, so it is synchronous: posted or refused. Its ID and its
// journal's key come from the tenant and the request's Idempotency-Key, so a retry after any
// failure finds the transfer the first attempt made instead of moving the money twice.

// Transfer is a posted transfer.
type Transfer struct {
	ID          string `json:"id"`
	Object      string `json:"object"`
	Status      string `json:"status"`
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	FromAccount string `json:"from_account"`
	ToAccount   string `json:"to_account"`
	Description string `json:"description,omitempty"`
	JournalID   string `json:"journal_id"`
	PostedAt    string `json:"posted_at"`
}

// TransferInput is a transfer request.
type TransferInput struct {
	FromAccount, ToAccount string
	Amount                 int64
	Description            string
}

// CreateTransfer posts a transfer. idempotencyKey is the request's Idempotency-Key.
func (s *Service) CreateTransfer(ctx context.Context, tenantID string, in TransferInput, idempotencyKey, actor string) (*Transfer, error) {
	if idempotencyKey == "" {
		return nil, invalid("an Idempotency-Key is required")
	}
	id := ids.FromSeed("tr", []byte(tenantID+"\n"+idempotencyKey))
	if t, err := s.GetTransfer(ctx, tenantID, id); err == nil {
		return t, nil // an earlier attempt finished
	}
	switch {
	case in.Amount <= 0 || in.Amount > s.cfg.MaxPaymentAmount:
		return nil, invalid("amount must be between 1 and %d centavos", s.cfg.MaxPaymentAmount)
	case in.FromAccount == in.ToAccount:
		return nil, invalid("from_account and to_account must differ")
	case utf8.RuneCountInString(in.Description) > 140:
		return nil, invalid("description has at most 140 characters")
	}
	from, err := s.merchantByAccount(ctx, tenantID, in.FromAccount)
	if err != nil {
		return nil, fmt.Errorf("%w: from_account %s", ErrNotFound, in.FromAccount)
	}
	to, err := s.merchantByAccount(ctx, tenantID, in.ToAccount)
	if err != nil {
		return nil, fmt.Errorf("%w: to_account %s", ErrNotFound, in.ToAccount)
	}
	// Money leaves only an active merchant (a restricted one's balance is held); it may arrive
	// anywhere but a closed one.
	if from.Status != MerchantActive {
		return nil, fmt.Errorf("%w: merchant %s is %s", ErrMerchantInactive, from.ID, from.Status)
	}
	if to.Status == MerchantClosed {
		return nil, fmt.Errorf("%w: merchant %s is closed", ErrMerchantInactive, to.ID)
	}
	journalID := ids.FromSeed("jr", []byte("transfer\n"+id))
	j := ledger.NewJournal(tenantID, journalID, "transfer:"+id, "transfer", id, []ledger.Posting{
		{Account: ledger.MerchantWallet(from.ID), Direction: ledger.Debit, Amount: in.Amount},
		{Account: ledger.MerchantWallet(to.ID), Direction: ledger.Credit, Amount: in.Amount},
	})
	j.EffectiveDate = s.cfg.Now()
	res, err := s.ledger.Post(ctx, j)
	var ife *ledger.InsufficientFundsError
	switch {
	case errors.As(err, &ife):
		return nil, fmt.Errorf("%w: the available balance of %s is smaller than the transfer", ErrFunds, in.FromAccount)
	case errors.Is(err, ledger.ErrIdempotencyConflict):
		return nil, invalid("this Idempotency-Key already made a different transfer")
	case err != nil:
		return nil, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO transfers (id, tenant_id, from_account, to_account, from_merchant, to_merchant, amount, currency, description, journal_id, actor)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10, $11) ON CONFLICT (id) DO NOTHING`,
			id, tenantID, in.FromAccount, in.ToAccount, from.ID, to.ID, in.Amount, s.cfg.Currency, in.Description, res.JournalID, actor)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		if err := audit(ctx, tx, tenantID, actor, "transfer.post", id, map[string]any{"from": in.FromAccount, "to": in.ToAccount, "amount": in.Amount}); err != nil {
			return err
		}
		return webhooks.Enqueue(ctx, tx, tenantID, "transfer.posted", map[string]any{"id": id, "object": "transfer", "amount": in.Amount,
			"from_account": in.FromAccount, "to_account": in.ToAccount})
	})
	if err != nil {
		return nil, err
	}
	return s.GetTransfer(ctx, tenantID, id)
}

// GetTransfer reads a transfer.
func (s *Service) GetTransfer(ctx context.Context, tenantID, id string) (*Transfer, error) {
	t := &Transfer{Object: "transfer", Status: "posted"}
	var desc *string
	var at time.Time
	err := s.pool.QueryRow(ctx, `SELECT id, amount, currency, from_account, to_account, description, journal_id, created_at FROM transfers WHERE tenant_id = $1 AND id = $2`,
		tenantID, id).Scan(&t.ID, &t.Amount, &t.Currency, &t.FromAccount, &t.ToAccount, &desc, &t.JournalID, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if desc != nil {
		t.Description = *desc
	}
	t.Currency = trimCurrency(t.Currency)
	t.PostedAt = at.UTC().Format(time.RFC3339)
	return t, nil
}

func trimCurrency(c string) string {
	for len(c) > 0 && c[len(c)-1] == ' ' {
		c = c[:len(c)-1]
	}
	return c
}
