// Shared Plaid sync routines used by both server functions and the webhook.
import { decryptToken } from "./crypto.server";
import { plaid, PlaidError, type PlaidApiAccount, type PlaidApiTransaction } from "./plaid.server";

type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

export interface ItemRow {
  id: string;
  user_id: string;
  item_id: string;
  access_token_enc: string;
  cursor: string | null;
  liabilities_enabled?: boolean;
  liabilities_last_synced_at?: string | null;
}

function categoryOf(tx: PlaidApiTransaction): string | null {
  return (
    tx.personal_finance_category?.primary ??
    (tx.category && tx.category.length ? tx.category[0]! : null)
  );
}

async function log(
  db: AdminClient,
  userId: string | null,
  itemId: string | null,
  source: string,
  event: string,
  detail: unknown,
) {
  await db.from("plaid_sync_log").insert({
    user_id: userId,
    item_id: itemId,
    source,
    event,
    detail: detail as never,
  });
}

export async function markItemError(db: AdminClient, item: ItemRow, err: unknown) {
  const isPlaid = err instanceof PlaidError;
  const code = isPlaid ? err.code : "UNKNOWN";
  const status =
    code === "ITEM_LOGIN_REQUIRED" || code === "ITEM_NOT_SUPPORTED" ? "login_required" : "error";
  await db
    .from("plaid_items")
    .update({
      status,
      error_code: code,
      error_message: err instanceof Error ? err.message : String(err),
    })
    .eq("id", item.id);
  await log(db, item.user_id, item.id, "sync", "error", { code });
}

export async function refreshBalancesForItem(db: AdminClient, item: ItemRow) {
  const accessToken = await decryptToken(item.access_token_enc);
  const res = await plaid<{ accounts: PlaidApiAccount[] }>("/accounts/balance/get", {
    access_token: accessToken,
  });

  for (const acct of res.accounts) {
    const payload = {
      user_id: item.user_id,
      item_id: item.id,
      account_id: acct.account_id,
      name: acct.name,
      official_name: acct.official_name ?? null,
      mask: acct.mask ?? null,
      type: acct.type ?? null,
      subtype: acct.subtype ?? null,
      current_balance: acct.balances.current ?? null,
      available_balance: acct.balances.available ?? null,
      limit_amount: acct.balances.limit ?? null,
      iso_currency: acct.balances.iso_currency_code ?? "USD",
    };
    const { data: existing } = await db
      .from("plaid_accounts")
      .select("id")
      .eq("user_id", item.user_id)
      .eq("account_id", acct.account_id)
      .maybeSingle();
    if (existing) {
      await db.from("plaid_accounts").update(payload).eq("id", existing.id);
    } else {
      await db.from("plaid_accounts").insert(payload);
    }
  }
  return res.accounts.length;
}


// Only after explicit consent. Plaid's underlying issuer data refreshes about daily.
export async function refreshLiabilitiesForItem(
  db: AdminClient,
  item: ItemRow,
  opts: { force?: boolean; explicitConsent?: boolean } = {},
): Promise<number> {
  if (process.env["PLAID_LIABILITIES_ENABLED"] !== "true") return 0;
  if (!item.liabilities_enabled && !opts.explicitConsent) return 0;
  const last = item.liabilities_last_synced_at ? Date.parse(item.liabilities_last_synced_at) : NaN;
  if (!opts.force && Number.isFinite(last) && Date.now() - last < 12 * 60 * 60 * 1000) return 0;
  const accessToken = await decryptToken(item.access_token_enc);
  const response = await plaid<{
    liabilities: { credit: Array<{
      account_id: string | null;
      last_statement_balance: number | null;
      last_statement_issue_date: string | null;
      minimum_payment_amount: number | null;
      next_payment_due_date: string | null;
      last_payment_amount: number | null;
      last_payment_date: string | null;
      is_overdue: boolean | null;
    }> | null };
  }>("/liabilities/get", { access_token: accessToken });
  const syncedAt = new Date().toISOString();
  let count = 0;
  for (const card of response.liabilities.credit ?? []) {
    if (!card.account_id) continue;
    // Do not accept an Item's liability for an unknown or another user's account.
    const { data: account } = await db.from("plaid_accounts")
      .select("id").eq("user_id", item.user_id)
      .eq("item_id", item.id).eq("account_id", card.account_id).maybeSingle();
    if (!account) continue;
    const row = {
      user_id: item.user_id, item_id: item.id, plaid_account_id: card.account_id,
      statement_balance: card.last_statement_balance,
      statement_issue_date: card.last_statement_issue_date,
      minimum_due: card.minimum_payment_amount,
      issuer_due_date: card.next_payment_due_date,
      last_payment_amount: card.last_payment_amount,
      last_payment_date: card.last_payment_date,
      issuer_overdue: card.is_overdue,
      synced_at: syncedAt,
    };
    const { error } = await db.from("plaid_card_liabilities").upsert(row, {
      onConflict: "user_id,plaid_account_id",
    });
    if (error) throw new Error(error.message);
    count++;
  }
  const { error: itemError } = await db.from("plaid_items").update({
    liabilities_enabled: true, liabilities_last_synced_at: syncedAt,
  }).eq("id", item.id).eq("user_id", item.user_id);
  if (itemError) throw new Error(itemError.message);
  await log(db, item.user_id, item.id, "liabilities", "sync", { count });
  return count;
}

export async function syncTransactionsForItem(db: AdminClient, item: ItemRow) {
  const accessToken = await decryptToken(item.access_token_enc);
  let cursor = item.cursor ?? undefined;
  let added = 0;
  let removed = 0;
  let guard = 0;

  // Plaid pages through updates; guard against pathological loops.
  for (;;) {
    guard += 1;
    if (guard > 25) break;
    const page = await plaid<{
      added: PlaidApiTransaction[];
      modified: PlaidApiTransaction[];
      removed: { transaction_id: string }[];
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", {
      access_token: accessToken,
      cursor,
      count: 250,
    });

    for (const tx of [...page.added, ...page.modified]) {
      const row = {
        user_id: item.user_id,
        item_id: item.id,
        plaid_account_id: tx.account_id,
        transaction_id: tx.transaction_id,
        pending_transaction_id: tx.pending_transaction_id ?? null,
        pending: tx.pending,
        amount: tx.amount,
        iso_currency: tx.iso_currency_code ?? "USD",
        date: tx.date,
        authorized_date: tx.authorized_date ?? null,
        name: tx.name,
        merchant_name: tx.merchant_name ?? null,
        plaid_category: categoryOf(tx),
        payment_channel: tx.payment_channel ?? null,
      };
      const { data: existing } = await db
        .from("plaid_transactions")
        .select("id, status")
        .eq("user_id", item.user_id)
        .eq("transaction_id", tx.transaction_id)
        .maybeSingle();
      if (existing) {
        // Never resurrect something the user already resolved.
        await db.from("plaid_transactions").update(row).eq("id", existing.id);
      } else {
        // Carry a user's review decision forward when a pending transaction settles.
        // Otherwise the same cleared transaction would return to Review under a new Plaid id.
        let resolvedPending: { status: string; local_transaction_id: string | null } | null = null;
        if (tx.pending_transaction_id) {
          const { data: pendingTwin } = await db
            .from("plaid_transactions")
            .select("status, local_transaction_id")
            .eq("user_id", item.user_id)
            .eq("transaction_id", tx.pending_transaction_id)
            .maybeSingle();
          if (pendingTwin && pendingTwin.status !== "inbox") resolvedPending = pendingTwin;
          await db
            .from("plaid_transactions")
            .delete()
            .eq("user_id", item.user_id)
            .eq("transaction_id", tx.pending_transaction_id)
            .eq("status", "inbox");
        }
        await db.from("plaid_transactions").insert({
          ...row,
          status: resolvedPending?.status ?? "inbox",
          local_transaction_id: resolvedPending?.local_transaction_id ?? null,
        });
        added += 1;
      }
    }

    for (const gone of page.removed) {
      const { error } = await db
        .from("plaid_transactions")
        .delete()
        .eq("user_id", item.user_id)
        .eq("transaction_id", gone.transaction_id)
        .eq("status", "inbox");
      if (!error) removed += 1;
    }

    cursor = page.next_cursor;
    if (!page.has_more) break;
  }

  await db
    .from("plaid_items")
    .update({
      cursor: cursor ?? null,
      status: "good",
      error_code: null,
      error_message: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  await log(db, item.user_id, item.id, "sync", "transactions", { added, removed });
  return { added, removed };
}

export async function syncItem(db: AdminClient, item: ItemRow) {
  try {
    await refreshBalancesForItem(db, item);
    const transactions = await syncTransactionsForItem(db, item);
    if (item.liabilities_enabled) {
      try {
        await refreshLiabilitiesForItem(db, item);
      } catch (err) {
        // Billing failure must never block fresh bank balances or transactions.
        await log(db, item.user_id, item.id, "liabilities", "error", {
          code: err instanceof PlaidError ? err.code : "SYNC_ERROR",
        });
      }
    }
    return transactions;
  } catch (err) {
    await markItemError(db, item, err);
    throw err;
  }
}
