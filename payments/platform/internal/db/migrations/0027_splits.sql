-- 0027: split payments (docs/02 §6.4): a payment's amount divided among accounts of its tenant.
ALTER TABLE payment_intents
  ADD COLUMN splits         JSONB,                        -- [{account_id, merchant_id, amount, bears_fees}]
  ADD COLUMN split_reversal TEXT CHECK (split_reversal IN ('pro_rata', 'primary_only'));
