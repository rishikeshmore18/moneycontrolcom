import { reducer, type Action } from "../cashflow/reducer";
import type { AppState } from "../cashflow/types";
import type { Connection, InboxItem } from "./plaid.functions";
import { existingCardPayment, paymentForBankItem, scanCardPayments } from "./cardPayments";

/** Produce idempotent ledger changes first; acknowledge inbox rows only after state is saved. */
export function reconcilePayments(state: AppState, items: InboxItem[], connections: Connection[]): Action[] {
  let working = state;
  const actions: Action[] = [];
  const used = new Set<string>();
  const apply = (action: Action) => {
    working = reducer(working, action);
    actions.push(action);
  };
  for (const item of items) {
    if (working.transactions.some((tx) => tx.cardPayment?.bankDebitId === item.id || tx.cardPayment?.bankCreditId === item.id)) {
      used.add(item.id);
      continue;
    }
    const match = paymentForBankItem(working, item, connections);
    if (!match) continue;
    const competing = items.filter((candidate) => {
      const other = paymentForBankItem(state, candidate, connections);
      return other?.transaction.id === match.transaction.id && other.leg === match.leg;
    });
    if (competing.length !== 1) continue;
    apply({ type: "RECONCILE_CARD_PAYMENT", id: match.transaction.id, leg: match.leg, bankId: item.id });
    used.add(item.id);
  }
  for (const match of scanCardPayments(items.filter((item) => !used.has(item.id)), connections).matched) {
    if (!match.sourceAccountId || existingCardPayment(working, match.cardId, match.amount, match.date)) continue;
    apply({ type: "PAY_CREDIT_CARD", payload: {
      transactionId: `bank-card-${match.cardItem.id}`, cardId: match.cardId,
      sourceAccountId: match.sourceAccountId, amount: match.amount, date: match.date,
      notes: "Confirmed on the payment account and card",
      cashPosted: true, cardPosted: true, cashAlreadySynced: true, cardAlreadySynced: true,
      bankDebitId: match.bankItem!.id, bankCreditId: match.cardItem.id,
    } });
  }
  return actions;
}
