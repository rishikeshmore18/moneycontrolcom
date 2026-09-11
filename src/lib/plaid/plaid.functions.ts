import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ConnectionAccount {
  id: string;
  accountId: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  limitAmount: number | null;
  linkedLocalId: string | null;
  linkedLocalKind: string | null;
  isActive: boolean;
}

export interface Connection {
  id: string;
  institutionName: string | null;
  status: string;
  errorMessage: string | null;
  lastSyncedAt: string | null;
  accounts: ConnectionAccount[];
}

export interface InboxItem {
  id: string;
  plaidAccountId: string;
  transactionId: string;
  pending: boolean;
  amount: number;
  date: string;
  name: string;
  merchantName: string | null;
  plaidCategory: string | null;
  paymentChannel: string | null;
}

function webhookUrl(): string | undefined {
  const explicit = process.env["PLAID_WEBHOOK_URL"];
  if (explicit) return explicit;
  try {
    const req = getRequest();
    const origin = new URL(req.url).origin;
    if (origin.startsWith("http://localhost")) return undefined;
    return `${origin}/api/public/plaid/webhook`;
  } catch {
    return undefined;
  }
}

/** Create a Link token. Pass itemRowId to re-authenticate an existing connection. */
export const plaidCreateLinkToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { itemRowId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { plaid } = await import("./plaid.server");
    const { decryptToken } = await import("./crypto.server");

    let accessToken: string | undefined;
    if (data.itemRowId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: item } = await supabaseAdmin
        .from("plaid_items")
        .select("access_token_enc, user_id")
        .eq("id", data.itemRowId)
        .maybeSingle();
      if (!item || item.user_id !== context.userId) throw new Error("Connection not found");
      accessToken = await decryptToken(item.access_token_enc);
    }

    const body: Record<string, unknown> = {
      client_name: "CashFlow Control",
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: context.userId },
    };
    const hook = webhookUrl();
    if (hook) body["webhook"] = hook;
    const redirectUri = process.env["PLAID_REDIRECT_URI"];
    if (redirectUri) body["redirect_uri"] = redirectUri;

    if (accessToken) {
      body["access_token"] = accessToken;
    } else {
      body["products"] = ["transactions"];
      body["optional_products"] = ["investments"];
    }

    const res = await plaid<{ link_token: string; expiration: string }>(
      "/link/token/create",
      body,
    );
    return { linkToken: res.link_token };
  });

/** Exchange the public token from Link for a stored, encrypted access token. */
export const plaidExchangeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { publicToken: string; institutionId?: string; institutionName?: string }) => {
    if (!input?.publicToken || typeof input.publicToken !== "string") {
      throw new Error("publicToken is required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { plaid } = await import("./plaid.server");
    const { encryptToken } = await import("./crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncItem } = await import("./sync.server");

    const exchanged = await plaid<{ access_token: string; item_id: string }>(
      "/item/public_token/exchange",
      { public_token: data.publicToken },
    );

    // Idempotent: a repeated exchange for the same item updates instead of duplicating.
    const { data: existing } = await supabaseAdmin
      .from("plaid_items")
      .select("id")
      .eq("user_id", context.userId)
      .eq("item_id", exchanged.item_id)
      .maybeSingle();

    const enc = await encryptToken(exchanged.access_token);
    let rowId: string;
    if (existing) {
      await supabaseAdmin
        .from("plaid_items")
        .update({ access_token_enc: enc, status: "good", error_code: null, error_message: null })
        .eq("id", existing.id);
      rowId = existing.id;
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("plaid_items")
        .insert({
          user_id: context.userId,
          item_id: exchanged.item_id,
          access_token_enc: enc,
          institution_id: data.institutionId ?? null,
          institution_name: data.institutionName ?? null,
        })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(error?.message ?? "Could not save connection");
      rowId = inserted.id;
    }

    const { data: item } = await supabaseAdmin
      .from("plaid_items")
      .select("id, user_id, item_id, access_token_enc, cursor")
      .eq("id", rowId)
      .single();
    if (item) {
      try {
        await syncItem(supabaseAdmin, item);
      } catch (err) {
        console.error("[plaid] initial sync failed", err);
      }
    }
    return { itemRowId: rowId };
  });

/** List connections with their accounts. */
export const plaidListConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Connection[]> => {
    const { data: items } = await context.supabase
      .from("plaid_items")
      .select("id, institution_name, status, error_message, last_synced_at")
      .order("created_at", { ascending: true });
    const { data: accounts } = await context.supabase
      .from("plaid_accounts")
      .select(
        "id, item_id, account_id, name, mask, type, subtype, current_balance, available_balance, limit_amount, linked_local_id, linked_local_kind, is_active",
      );

    return (items ?? []).map((it) => ({
      id: it.id,
      institutionName: it.institution_name,
      status: it.status,
      errorMessage: it.error_message,
      lastSyncedAt: it.last_synced_at,
      accounts: (accounts ?? [])
        .filter((a) => a.item_id === it.id)
        .map((a) => ({
          id: a.id,
          accountId: a.account_id,
          name: a.name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          currentBalance: a.current_balance,
          availableBalance: a.available_balance,
          limitAmount: a.limit_amount,
          linkedLocalId: a.linked_local_id,
          linkedLocalKind: a.linked_local_kind,
          isActive: a.is_active,
        })),
    }));
  });

/** Pull fresh balances and transactions for every connection. */
export const plaidSyncAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncItem } = await import("./sync.server");
    const { data: items } = await supabaseAdmin
      .from("plaid_items")
      .select("id, user_id, item_id, access_token_enc, cursor")
      .eq("user_id", context.userId);

    let added = 0;
    const failed: string[] = [];
    for (const item of items ?? []) {
      try {
        const res = await syncItem(supabaseAdmin, item);
        added += res.added;
      } catch (err) {
        failed.push(err instanceof Error ? err.message : String(err));
      }
    }
    return { added, failed };
  });

/** Map a bank account to an in-app account or card (or clear the mapping). */
export const plaidLinkAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { plaidRowId: string; localId: string | null; localKind: "account" | "card" | null }) => {
      if (!input?.plaidRowId) throw new Error("plaidRowId is required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("plaid_accounts")
      .update({ linked_local_id: data.localId, linked_local_kind: data.localKind })
      .eq("id", data.plaidRowId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Transactions awaiting review. */
export const plaidListInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InboxItem[]> => {
    const { data } = await context.supabase
      .from("plaid_transactions")
      .select(
        "id, plaid_account_id, transaction_id, pending, amount, date, name, merchant_name, plaid_category, payment_channel",
      )
      .eq("status", "inbox")
      .order("date", { ascending: false })
      .limit(300);
    return (data ?? []).map((t) => ({
      id: t.id,
      plaidAccountId: t.plaid_account_id,
      transactionId: t.transaction_id,
      pending: t.pending,
      amount: Number(t.amount),
      date: t.date,
      name: t.name,
      merchantName: t.merchant_name,
      plaidCategory: t.plaid_category,
      paymentChannel: t.payment_channel,
    }));
  });

/** Mark an inbox item accepted, merged, or dismissed. */
export const plaidResolveInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { ids: string[]; status: "accepted" | "dismissed" | "merged"; localTransactionId?: string }) => {
      if (!Array.isArray(input?.ids) || input.ids.length === 0) throw new Error("ids required");
      if (!["accepted", "dismissed", "merged"].includes(input.status)) {
        throw new Error("invalid status");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("plaid_transactions")
      .update({ status: data.status, local_transaction_id: data.localTransactionId ?? null })
      .in("id", data.ids)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Disconnect a bank. History stays; syncing stops. */
export const plaidUnlinkItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { itemRowId: string }) => {
    if (!input?.itemRowId) throw new Error("itemRowId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { plaid } = await import("./plaid.server");
    const { decryptToken } = await import("./crypto.server");

    const { data: item } = await supabaseAdmin
      .from("plaid_items")
      .select("id, user_id, access_token_enc")
      .eq("id", data.itemRowId)
      .maybeSingle();
    if (!item || item.user_id !== context.userId) throw new Error("Connection not found");

    try {
      await plaid("/item/remove", { access_token: await decryptToken(item.access_token_enc) });
    } catch (err) {
      console.error("[plaid] item/remove failed, removing locally anyway", err);
    }
    await supabaseAdmin.from("plaid_items").delete().eq("id", item.id);
    return { ok: true };
  });
