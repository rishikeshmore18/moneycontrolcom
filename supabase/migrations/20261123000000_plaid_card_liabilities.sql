-- Opt-in, server-side Plaid Liabilities snapshots; no existing financial rows are rewritten.
ALTER TABLE public.plaid_items
  ADD COLUMN IF NOT EXISTS liabilities_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS liabilities_last_synced_at timestamptz;
GRANT SELECT (liabilities_enabled, liabilities_last_synced_at) ON public.plaid_items TO authenticated;

CREATE TABLE IF NOT EXISTS public.plaid_card_liabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  plaid_account_id text NOT NULL,
  statement_balance numeric,
  statement_issue_date date,
  minimum_due numeric,
  issuer_due_date date,
  last_payment_amount numeric,
  last_payment_date date,
  issuer_overdue boolean,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, plaid_account_id)
);
ALTER TABLE public.plaid_card_liabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own billing snapshots"
 ON public.plaid_card_liabilities FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.plaid_card_liabilities TO authenticated;
GRANT ALL ON public.plaid_card_liabilities TO service_role;
CREATE INDEX IF NOT EXISTS plaid_liabilities_item_idx ON public.plaid_card_liabilities(item_id);
