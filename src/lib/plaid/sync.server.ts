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
        // A settled transaction replaces its pending twin if still untouched.
        if (tx.pending_transaction_id) {
          await db
            .from("plaid_transactions")
            .delete()
            .eq("user_id", item.user_id)
            .eq("transaction_id", tx.pending_transaction_id)
            .eq("status", "inbox");
        }
        await db.from("plaid_transactions").insert({ ...row, status: "inbox" });
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
    return await syncTransactionsForItem(db, item);
  } catch (err) {
    await markItemError(db, item, err);
    throw err;
  }
}
