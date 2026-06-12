import { AppState, Debt } from "./types";
import { cycleForDate, expensesInCycle } from "./cardLogic";
import { endOfMonth } from "./dates";

export function totalCash(state: AppState): number {
  return state.accounts.reduce((s, a) => s + a.balance, 0);
}

export function totalCardDebt(state: AppState): number {
  return state.cards.reduce((s, c) => s + c.currentBalance, 0);
}

export function totalDebt(state: AppState): number {
  return state.debts.filter((d) => d.status === "active").reduce((s, d) => s + d.balance, 0);
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

/**
 * Cycle-aware: sum of card balances whose payment due date falls in the
 * current month. Uses the most recently closed cycle and the unreconciled
 * charges in that cycle as the amount actually coming due.
 */
export function cardDueThisMonth(state: AppState): number {
  const today = new Date();
  const monthEnd = endOfMonth(today);
  let total = 0;
  for (const c of state.cards) {
    const cycle = cycleForDate(c, today);
    if (cycle.dueDate <= toISO(monthEnd) && cycle.dueDate >= toISO(today)) {
      const charges = expensesInCycle(state.transactions, c.id, cycle).reduce(
        (s, t) => s + t.amount,
        0,
      );
      total += Math.max(Math.min(c.minimumDue, c.currentBalance), charges);
    }
  }
  return total;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function debtMinimums(state: AppState): number {
  return state.debts.filter((d) => d.status === "active").reduce((s, d) => s + d.minimumPayment, 0);
}

export function plannedDebtPayment(debt: Omit<Debt, "id"> | Debt, ref: Date = new Date()): number {
  if (debt.status !== "active" || debt.balance <= 0) return 0;

  let planned = debt.minimumPayment;
  if (debt.payoffMode === "payments" && debt.payoffPaymentCount && debt.payoffPaymentCount > 0) {
    planned = debt.balance / debt.payoffPaymentCount;
  } else if (debt.payoffMode === "date" && debt.payoffTargetDate) {
    const target = new Date(`${debt.payoffTargetDate}T00:00:00`);
    if (!Number.isNaN(target.getTime())) {
      const months =
        (target.getFullYear() - ref.getFullYear()) * 12 + (target.getMonth() - ref.getMonth()) + 1;
      planned = debt.balance / Math.max(1, months);
    }
  } else if (
    debt.payoffMode === "custom" &&
    debt.plannedMonthlyPayment &&
    debt.plannedMonthlyPayment > 0
  ) {
    planned = debt.plannedMonthlyPayment;
  }

  return Math.min(debt.balance, Math.max(debt.minimumPayment, planned));
}

export function debtPlannedPayments(state: AppState): number {
  return state.debts.reduce((s, d) => s + plannedDebtPayment(d), 0);
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
    cardDueThisMonth(state) -
    debtPlannedPayments(state) -
    state.profile.safeToSpendFloor
  );
}

export function projectedMonthEnd(state: AppState): number {
  return (
    totalCash(state) +
    pendingIncome(state) -
    upcomingBillsThisMonth(state) -
    cardDueThisMonth(state) -
    debtPlannedPayments(state)
  );
}
