import type { AppState, Transaction } from "./types";
import { cycleForDate } from "./cardLogic";
import { newId } from "./dates";
import { validISODate } from "./friendRepayment";
import { backedGoalInAccount, goalCents, validGoalAmount } from "./savingsGoals";

export interface CardPaymentInput {
  cardId: string;
  sourceAccountId: string;
  amount: number;
  date: string;
  notes?: string;
  transactionId?: string;
  plannedExpenseItemId?: string;
  cashPosted?: boolean;
  cardPosted?: boolean;
  cashAlreadySynced?: boolean;
  cardAlreadySynced?: boolean;
  bankDebitId?: string;
  bankCreditId?: string;
  savingsGoalId?: string;
  savingsGoalAmount?: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function validCardPayment(state: AppState, p: CardPaymentInput): boolean {
  return (
    Number.isFinite(p.amount) &&
    cents(p.amount) > 0 &&
    validISODate(p.date) &&
    state.cards.some((card) => card.id === p.cardId) &&
    state.accounts.some((account) => account.id === p.sourceAccountId) &&
    (!p.savingsGoalId || (validGoalAmount(p.savingsGoalAmount ?? 0) &&
      goalCents(p.savingsGoalAmount!) <= goalCents(p.amount) &&
      (state.savingsGoals ?? []).some((goal) => goal.id === p.savingsGoalId &&
        goalCents(backedGoalInAccount(state, goal.id, p.sourceAccountId)) >= goalCents(p.savingsGoalAmount!))))
  );
}

/** Bank snapshots are never debited again. A payment does not erase an entire planned bill. */
export function recordCardPayment(state: AppState, p: CardPaymentInput): AppState {
  if (
    !validCardPayment(state, p) ||
    (p.transactionId && state.transactions.some((tx) => tx.id === p.transactionId))
  )
    return state;
  const card = state.cards.find((item) => item.id === p.cardId)!;
  const account = state.accounts.find((item) => item.id === p.sourceAccountId)!;
  const amount = cents(p.amount);
  const cashPosted = p.cashPosted ?? !account.bankLinked;
  const cardPosted = p.cardPosted ?? false;
  const cashLocalApplied = cashPosted && !p.cashAlreadySynced && !account.bankLinked ? amount : 0;
  const cardLocalApplied =
    cardPosted && !p.cardAlreadySynced && !card.bankLinked
      ? Math.min(amount, card.currentBalance)
      : 0;
  const statementLocalApplied = cardLocalApplied > 0 ? Math.min(amount, card.statementBalance) : 0;
  const cycle = cycleForDate(card, p.date);
  const stamp = new Date().toISOString();
  const tx: Transaction = {
    id: p.transactionId ?? newId(),
    type: "card_payment",
    amount,
    category: "Credit card bill",
    description: `Payment to ${card.name}`,
    sourceAccountId: account.id,
    cardId: card.id,
    date: p.date,
    notes: p.notes,
    savingsGoalId: p.savingsGoalId || undefined,
    savingsGoalAmount: p.savingsGoalId ? p.savingsGoalAmount : undefined,
    createdAt: stamp,
    updatedAt: stamp,
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    cardPayment: {
      version: 2,
      plannedExpenseItemId: p.plannedExpenseItemId,
      cashPosted,
      cardPosted,
      cashLocalApplied,
      cardLocalApplied,
      statementLocalApplied,
      bankDebitId: p.bankDebitId,
      bankCreditId: p.bankCreditId,
    },
  };
  return {
    ...state,
    accounts: state.accounts.map((item) =>
      item.id === account.id ? { ...item, balance: cents(item.balance - cashLocalApplied) } : item,
    ),
    cards: state.cards.map((item) =>
      item.id === card.id
        ? {
            ...item,
            currentBalance: cents(item.currentBalance - cardLocalApplied),
            statementBalance: cents(item.statementBalance - statementLocalApplied),
          }
        : item,
    ),
    transactions: [tx, ...state.transactions],
    savingsGoals: p.savingsGoalId ? (state.savingsGoals ?? []).map((goal) => goal.id === p.savingsGoalId
      ? { ...goal, movements: [...goal.movements, { id: newId(), date: p.date,
        accountId: account.id, amount: -p.savingsGoalAmount!, kind: "spend" as const,
        transactionId: tx.id }] } : goal) : state.savingsGoals,
  };
}

/** Reverse only local effects. Deleting app history cannot reverse a real bank transfer. */
export function removeCardPayment(state: AppState, tx: Transaction): AppState {
  if (tx.type !== "card_payment") return state;
  const local = tx.cardPayment;
  return {
    ...state,
    accounts: state.accounts.map((account) =>
      account.id === tx.sourceAccountId && !account.bankLinked
        ? {
            ...account,
            balance: cents(
              account.balance +
                (local?.cashLocalApplied ?? (tx.balanceAlreadySynced ? 0 : tx.amount)),
            ),
          }
        : account,
    ),
    cards: state.cards.map((card) =>
      card.id === tx.cardId && !card.bankLinked
        ? {
            ...card,
            currentBalance: cents(
              card.currentBalance +
                (local?.cardLocalApplied ?? (tx.balanceAlreadySynced ? 0 : tx.amount)),
            ),
            statementBalance: cents(card.statementBalance + (local?.statementLocalApplied ?? 0)),
          }
        : card,
    ),
    transactions: state.transactions
      .filter((item) => item.id !== tx.id)
      .map((item) =>
        item.reconciledByPaymentId === tx.id ? { ...item, reconciledByPaymentId: undefined } : item,
      ),
    savingsGoals: (state.savingsGoals ?? []).map((goal) => ({ ...goal,
      movements: goal.movements.filter((movement) => movement.transactionId !== tx.id) })),
    plannedExpenseOverrides: state.plannedExpenseOverrides.filter(
      (override) =>
        !(
          override.sourceType === "card_due" &&
          override.action === "skip" &&
          tx.cardId &&
          !tx.cardPayment &&
          override.month === tx.date.slice(0, 7) &&
          (override.sourceId === tx.cardId || override.sourceId?.startsWith(`${tx.cardId}:`))
        ),
    ),
  };
}

export function pendingCashForAccount(state: AppState, accountId: string): number {
  return cents(
    state.transactions.reduce(
      (total, tx) =>
        total +
        (tx.type === "card_payment" &&
        tx.sourceAccountId === accountId &&
        tx.cardPayment &&
        !tx.cardPayment.cashPosted
          ? tx.amount
          : 0),
      0,
    ),
  );
}

/** The destination may post first. Reserve an unposted source leg until its bank row is linked. */
export function pendingTransferCashForAccount(state: AppState, accountId: string): number {
  if (!state.accounts.some((account) => account.id === accountId && account.bankLinked)) return 0;
  return cents(state.transactions.reduce((total, tx) => total +
    (tx.type === "transfer" && tx.sourceAccountId === accountId && tx.accountTransfer &&
      !tx.accountTransfer.bankDebitId ? tx.amount : 0), 0));
}

export function pendingCardPayments(state: AppState, cardId: string): number {
  return cents(
    state.transactions.reduce(
      (total, tx) =>
        total +
        (tx.type === "card_payment" &&
        tx.cardId === cardId &&
        tx.cardPayment &&
        !tx.cardPayment.cardPosted
          ? tx.amount
          : 0),
      0,
    ),
  );
}
