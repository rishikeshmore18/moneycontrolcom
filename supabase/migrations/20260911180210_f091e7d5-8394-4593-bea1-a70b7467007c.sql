-- Plaid items (one per linked institution)
CREATE TABLE public.plaid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  access_token_enc text NOT NULL,
  institution_id text,
  institution_name text,
  cursor text,
  status text NOT NULL DEFAULT 'good',
  error_code text,
  error_message text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);

GRANT SELECT (id, user_id, item_id, institution_id, institution_name, status, error_code, error_message, last_synced_at, created_at, updated_at) ON public.plaid_items TO authenticated;
GRANT DELETE ON public.plaid_items TO authenticated;
GRANT ALL ON public.plaid_items TO service_role;
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own plaid items" ON public.plaid_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own plaid items" ON public.plaid_items FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Accounts inside an item
CREATE TABLE public.plaid_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  name text NOT NULL,
  official_name text,
  mask text,
  type text,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  limit_amount numeric,
  iso_currency text DEFAULT 'USD',
  linked_local_id text,
  linked_local_kind text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id)
);

GRANT SELECT, UPDATE, DELETE ON public.plaid_accounts TO authenticated;
GRANT ALL ON public.plaid_accounts TO service_role;
ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plaid accounts" ON public.plaid_accounts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Raw transactions / inbox
CREATE TABLE public.plaid_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  plaid_account_id text NOT NULL,
  transaction_id text NOT NULL,
  pending_transaction_id text,
  pending boolean NOT NULL DEFAULT false,
  amount numeric NOT NULL,
  iso_currency text DEFAULT 'USD',
  date date NOT NULL,
  authorized_date date,
  name text NOT NULL,
  merchant_name text,
  plaid_category text,
  payment_channel text,
  status text NOT NULL DEFAULT 'inbox',
  suggested_kind text,
  suggested_match_id text,
  local_transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, transaction_id)
);

CREATE INDEX plaid_transactions_inbox_idx ON public.plaid_transactions (user_id, status, date DESC);

GRANT SELECT, UPDATE, DELETE ON public.plaid_transactions TO authenticated;
GRANT ALL ON public.plaid_transactions TO service_role;
ALTER TABLE public.plaid_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plaid transactions" ON public.plaid_transactions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Sync log
CREATE TABLE public.plaid_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  source text NOT NULL,
  event text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plaid_sync_log TO authenticated;
GRANT ALL ON public.plaid_sync_log TO service_role;
ALTER TABLE public.plaid_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own plaid sync log" ON public.plaid_sync_log FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER plaid_items_touch BEFORE UPDATE ON public.plaid_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER plaid_accounts_touch BEFORE UPDATE ON public.plaid_accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER plaid_transactions_touch BEFORE UPDATE ON public.plaid_transactions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();