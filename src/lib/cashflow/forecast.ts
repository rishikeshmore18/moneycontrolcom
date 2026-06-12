import { AppState, Debt } from "./types";
import { cycleForDate, expensesInCycle } from "./cardLogic";
import { endOfMonth } from "./dates";
import { entriesForMonth, timesheetEntryAmount } from "./timesheetLogic";

export interface CashFlowBreakdownItem {
  id: string;
  label: string;
  detail?: string;
  amount: number;
}

export interface CashFlowBreakdownSection {
  title: string;
  items: CashFlowBreakdownItem[];
}

export function totalCash(state: AppState): number {
  return state.accounts.reduce((s, a) => s + a.balance, 0);
}

export function isSpendableAccount(account: AppState["accounts"][number]): boolean {
  return account.availableForSpending !== false;
}

export function spendableCash(state: AppState): number {
  return state.accounts.filter(isSpendableAccount).reduce((s, a) => s + a.balance, 0);
}

export function spendableCashBreakdown(state: AppState): CashFlowBreakdownSection[] {
  const spendableAccounts = state.accounts.filter(isSpendableAccount).map((account) => ({
    id: account.id,
    label: account.name,
    detail: account.bankName ? `${account.bankName} - ${account.type}` : account.type,
    amount: account.balance,
  }));
  const reservedAccounts = state.accounts
    .filter((account) => !isSpendableAccount(account))
    .map((account) => ({
      id: account.id,
      label: account.name,
      detail: account.savingsPurpose
        ? `Reserved for ${account.savingsPurpose}`
        : "Reserved from spendable cash",
      amount: account.balance,
    }));

  const sections: CashFlowBreakdownSection[] = [];
  if (spendableAccounts.length > 0) {
    sections.push({ title: "Spendable accounts", items: spendableAccounts });
  }
  if (reservedAccounts.length > 0) {
    sections.push({ title: "Excluded accounts (not counted)", items: reservedAccounts });
  }
  return sections;
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

function unpaidPendingIncomeItems(
  state: AppState,
  monthDate: Date = new Date(),
): CashFlowBreakdownItem[] {
  const entries = entriesForMonth(state.timesheet, state.jobs, monthDate);

  return entries
    .filter((t) => !t.paid)
    .map((t) => ({
      id: t.id,
      label: t.jobName,
      detail:
        t.entryType === "salary_paycheck"
          ? `Scheduled paycheck - ${t.date}`
          : t.entryType === "time_off"
            ? `Time off deduction - ${t.date}`
            : `Shift - ${t.date}`,
      amount: timesheetEntryAmount(t),
    }));
}

export function pendingIncomeBreakdown(
  state: AppState,
  monthDate: Date = new Date(),
): CashFlowBreakdownSection[] {
  const incomeItems = unpaidPendingIncomeItems(state, monthDate);
  return incomeItems.length > 0 ? [{ title: "Unpaid income this month", items: incomeItems }] : [];
}

export function pendingIncome(state: AppState, monthDate: Date = new Date()): number {
  return unpaidPendingIncomeItems(state, monthDate).reduce((sum, item) => sum + item.amount, 0);
}

export function expensesComingBreakdown(state: AppState): CashFlowBreakdownSection[] {
  const today = new Date();
  const monthEnd = endOfMonth(today);
  const billItems = state.recurringBills
    .filter((bill) => bill.active)
    .map((bill) => {
      const account = state.accounts.find((item) => item.id === bill.accountId);
      return {
        id: bill.id,
        label: bill.name,
        detail: account ? `Due day ${bill.dueDay} - ${account.name}` : `Due day ${bill.dueDay}`,
        amount: bill.amount,
      };
    });
  const cardItems = state.cards.flatMap((card) => {
    const cycle = cycleForDate(card, today);
    if (cycle.dueDate > toISO(monthEnd) || cycle.dueDate < toISO(today)) return [];
    const charges = expensesInCycle(state.transactions, card.id, cycle).reduce(
      (s, t) => s + t.amount,
      0,
    );
    return [
      {
        id: card.id,
        label: card.name,
        detail: `Due ${cycle.dueDate} - cycle ${cycle.cycleStart} to ${cycle.cycleEnd}`,
        amount: Math.max(Math.min(card.minimumDue, card.currentBalance), charges),
      },
    ];
  });
  const debtItems = state.debts
    .filter((debt) => debt.status === "active")
    .map((debt) => ({
      id: debt.id,
      label: debt.name,
      detail: `Due day ${debt.dueDate}`,
      amount: plannedDebtPayment(debt),
    }))
    .filter((debt) => debt.amount > 0);

  const sections: CashFlowBreakdownSection[] = [];
  if (billItems.length > 0) sections.push({ title: "Bills", items: billItems });
  if (cardItems.length > 0) sections.push({ title: "Cards due this month", items: cardItems });
  if (debtItems.length > 0) sections.push({ title: "Debt plan", items: debtItems });
  return sections;
}

export function leftToSpendBreakdown(
  state: AppState,
  monthDate: Date = new Date(),
): CashFlowBreakdownSection[] {
  const haveNow = spendableCash(state);
  const incomeComing = pendingIncome(state, monthDate);
  const expensesComing =
    upcomingBillsThisMonth(state) + cardDueThisMonth(state) + debtPlannedPayments(state);

  return [
    {
      title: "Cash flow formula",
      items: [
        { id: "have-now", label: "Have now", detail: "Current spendable cash", amount: haveNow },
        {
          id: "income-coming",
          label: "Income coming",
          detail: "Expected this month",
          amount: incomeComing,
        },
        {
          id: "expenses-coming",
          label: "Expenses coming",
          detail: "Bills, cards, and debt plan",
          amount: -expensesComing,
        },
      ],
    },
  ];
}

export function safeToSpend(state: AppState): number {
  return (
    spendableCash(state) -
    upcomingBillsThisMonth(state) -
    cardDueThisMonth(state) -
    debtPlannedPayments(state) -
    state.profile.safeToSpendFloor
  );
}

export function projectedMonthEnd(state: AppState): number {
  return (
    spendableCash(state) +
    pendingIncome(state) -
    upcomingBillsThisMonth(state) -
    cardDueThisMonth(state) -
    debtPlannedPayments(state)
  );
}
