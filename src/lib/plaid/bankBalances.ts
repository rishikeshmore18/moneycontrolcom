import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Action } from "@/lib/cashflow/reducer";
import type { Account, AppState, Card } from "@/lib/cashflow/types";
import {
  plaidListConnections,
  plaidListInbox,
  plaidResolveInbox,
  plaidSyncAll,
  type Connection,
} from "./plaid.functions";
import { cardPaymentAlreadyRecorded, scanCardPayments } from "./cardPayments";

/**
 * The bank is the source of truth for any account/card that is linked to a
 * Plaid account: mirror the live balance into the in-app record.
 */
export function applyBankBalances(
  connections: Connection[],
  accounts: Account[],
  cards: Card[],
  dispatch: (a: Action) => void,
): void {
  for (const conn of connections) {
    for (const pa of conn.accounts) {
      if (!pa.linkedLocalId || pa.currentBalance == null) continue;
      const live = Number(pa.currentBalance);
      if (!Number.isFinite(live)) continue;

      if (pa.linkedLocalKind === "account") {
        const acc = accounts.find((a) => a.id === pa.linkedLocalId);
        if (!acc) continue;
        if (Math.abs(acc.balance - live) < 0.005) continue;
        dispatch({ type: "UPDATE_ACCOUNT", payload: { ...acc, balance: live } });
      } else if (pa.linkedLocalKind === "card") {
        const card = cards.find((c) => c.id === pa.linkedLocalId);
        if (!card) continue;
        const owed = Math.abs(live);
        const limit = pa.limitAmount != null ? Math.abs(Number(pa.limitAmount)) : card.limit;
        if (Math.abs(card.currentBalance - owed) < 0.005 && limit === card.limit) continue;
        dispatch({ type: "UPDATE_CARD", payload: { ...card, currentBalance: owed, limit } });
      }
    }
  }
}

/** Sync every connection once per session when the app opens, then mirror balances. */
export function useBankAutoSync(
  enabled: boolean,
  accounts: Account[],
  cards: Card[],
  dispatch: (a: Action) => void,
): void {
  const syncAll = useServerFn(plaidSyncAll);
  const listConnections = useServerFn(plaidListConnections);
  const ran = useRef(false);
  const latest = useRef({ accounts, cards, dispatch });
  latest.current = { accounts, cards, dispatch };

  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        const before = await listConnections();
        if (before.length === 0) return;
        applyBankBalances(before, latest.current.accounts, latest.current.cards, latest.current.dispatch);
        await syncAll();
        const after = await listConnections();
        applyBankBalances(after, latest.current.accounts, latest.current.cards, latest.current.dispatch);
      } catch (err) {
        console.error("[plaid] auto sync failed", err);
      }
    })();
  }, [enabled, listConnections, syncAll]);
}
