import { createFileRoute } from "@tanstack/react-router";

/**
 * Plaid webhook receiver.
 *
 * Nothing in the request body is trusted or stored: the payload is only used to
 * look up which stored item to refresh, and every value we persist is then
 * fetched from Plaid's API with our own credentials.
 */
export const Route = createFileRoute("/api/public/plaid/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: {
          webhook_type?: string;
          webhook_code?: string;
          item_id?: string;
          error?: { error_code?: string; error_message?: string };
        };
        try {
          payload = (await request.json()) as typeof payload;
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const plaidItemId = typeof payload.item_id === "string" ? payload.item_id : null;
        if (!plaidItemId) return new Response("ok");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: item } = await supabaseAdmin
          .from("plaid_items")
          .select("id, user_id, item_id, access_token_enc, cursor")
          .eq("item_id", plaidItemId)
          .maybeSingle();
        // Unknown item: acknowledge so Plaid stops retrying, but do nothing.
        if (!item) return new Response("ok");

        await supabaseAdmin.from("plaid_sync_log").insert({
          user_id: item.user_id,
          item_id: item.id,
          source: "webhook",
          event: `${payload.webhook_type ?? "?"}.${payload.webhook_code ?? "?"}`,
          detail: { code: payload.webhook_code ?? null } as never,
        });

        const code = payload.webhook_code ?? "";
        if (code === "ITEM_LOGIN_REQUIRED" || code === "PENDING_EXPIRATION") {
          await supabaseAdmin
            .from("plaid_items")
            .update({
              status: "login_required",
              error_code: code,
              error_message: "Your bank needs you to sign in again.",
            })
            .eq("id", item.id);
          return new Response("ok");
        }

        if (code === "USER_PERMISSION_REVOKED" || code === "ITEM_ERROR") {
          await supabaseAdmin
            .from("plaid_items")
            .update({
              status: "error",
              error_code: payload.error?.error_code ?? code,
              error_message: payload.error?.error_message ?? "This connection stopped working.",
            })
            .eq("id", item.id);
          return new Response("ok");
        }

        if (
          code === "SYNC_UPDATES_AVAILABLE" ||
          code === "DEFAULT_UPDATE" ||
          code === "INITIAL_UPDATE" ||
          code === "HISTORICAL_UPDATE" ||
          code === "TRANSACTIONS_REMOVED" ||
          payload.webhook_type === "HOLDINGS"
        ) {
          const { syncItem } = await import("@/lib/plaid/sync.server");
          try {
            await syncItem(supabaseAdmin, item);
          } catch (err) {
            console.error("[plaid webhook] sync failed", err);
          }
        }

        return new Response("ok");
      },
    },
  },
});
