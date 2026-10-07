import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { reducer, type Action } from "@/lib/cashflow/reducer";
import type { Account, AppState, Card } from "@/lib/cashflow/types";
import {
  plaidListConnections,
  plaidListInbox,
  plaidSyncAll,
  type Connection,
} from "./plaid.functions";
import { reconcilePayments } from "./reconcilePayments";

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
        if (Math.abs(acc.balance - live) < 0.005 && acc.bankLinked) continue;
        dispatch({ type: "SYNC_ACCOUNT_BALANCE", id: acc.id, balance: live });
      } else if (pa.linkedLocalKind === "card") {
        const card = cards.find((c) => c.id === pa.linkedLocalId);
        if (!card) continue;
        const owed = Math.max(0, live);
        const limit = pa.limitAmount != null ? Math.abs(Number(pa.limitAmount)) : card.limit;
        if (Math.abs(card.currentBalance - owed) < 0.005 && limit === card.limit && card.bankLinked) continue;
        dispatch({ type: "SYNC_CARD_BALANCE", id: card.id, balance: owed, limit });
      }
    }
  }
}

/**
 * Sync every connection once per session when the app opens, mirror balances,
 * then settle any credit-card bill payment that is visible on both the card and
 * the bank account (posted once, never twice).
 */
export function useBankAutoSync(
  enabled: boolean,
  state: AppState,
  dispatch: (a: Action) => void,
): void {
  const syncAll = useServerFn(plaidSyncAll);
  const listConnections = useServerFn(plaidListConnections);
  const listInbox = useServerFn(plaidListInbox);
  const ran = useRef(false);
  const latest = useRef({ state, dispatch });
  latest.current = { state, dispatch };

  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        const before = await listConnections();
        if (before.length === 0) return;
        const mirror = (connections: Connection[]) =>
          applyBankBalances(
            connections,
            latest.current.state.accounts,
            latest.current.state.cards,
            latest.current.dispatch,
          );
        mirror(before);
        await syncAll();
        const after = await listConnections();
        mirror(after);

        // Reconcile each posted leg independently. Acknowledgment happens after persistence.
        const inbox = await listInbox();
        let working = latest.current.state;
        const apply = (action: Action) => { working = reducer(working, action); latest.current.dispatch(action); };
        applyBankBalances(after, working.accounts, working.cards, apply);
        reconcilePayments(working, inbox, after).forEach(apply);
      } catch (err) {
        console.error("[plaid] auto sync failed", err);
      }
    })();
  }, [enabled, listConnections, syncAll, listInbox]);
}
