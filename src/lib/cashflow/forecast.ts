import { AppState } from "./types";

export function totalCash(state: AppState): number {
  return state.accounts.reduce((s, a) => s + a.balance, 0);
}

export function totalCardDebt(state: AppState): number {
  return state.cards.reduce((s, c) => s + c.currentBalance, 0);
}

export function totalDebt(state: AppState): number {
  return state.debts
    .filter((d) => d.status === "active")
    .reduce((s, d) => s + d.balance, 0);
}

export function netWorth(state: AppState): number {
  return totalCash(state) - totalCardDebt(state) - totalDebt(state);
}

export function upcomingBillsThisMonth(state: AppState): number {
  return state.recurringBills.filter((b) => b.active).reduce((s, b) => s + b.amount, 0);
}

export function cardMinimums(state: AppState): number {
  return state.cards.reduce((s, c) => s + Math.min(c.minimumDue, c.currentBalance), 0);
}

export function debtMinimums(state: AppState): number {
  return state.debts
    .filter((d) => d.status === "active")
    .reduce((s, d) => s + d.minimumPayment, 0);
}

export function pendingIncome(state: AppState): number {
  return state.timesheet
    .filter((t) => !t.paid && t.entryType !== "time_off")
    .reduce((s, t) => s + (t.actualAmount ?? t.expectedAmount), 0);
}

export function safeToSpend(state: AppState): number {
  return (
    totalCash(state) -
    upcomingBillsThisMonth(state) -
    cardMinimums(state) -
    debtMinimums(state) -
    state.profile.safeToSpendFloor
  );
}

export function projectedMonthEnd(state: AppState): number {
  return totalCash(state) + pendingIncome(state) - upcomingBillsThisMonth(state) - cardMinimums(state) - debtMinimums(state);
}
