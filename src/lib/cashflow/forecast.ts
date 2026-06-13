import { AppState, Debt, PlannedExpenseOverride, PlannedExpenseSourceType } from "./types";
import {
  currentOpenCycle,
  expensesInCycle,
  isLikelyPendingNearStatement,
  isZeroAprCard,
  paydownToTarget,
} from "./cardLogic";
import { endOfMonth } from "./dates";
import { entriesForMonth, timesheetEntryAmount } from "./timesheetLogic";

export interface CashFlowBreakdownItem {
  id: string;
  label: string;
  detail?: string;
  amount: number;
  sourceType?: PlannedExpenseSourceType;
  sourceId?: string;
  overrideId?: string;
  dueDate?: string;
  dueDay?: number;
  accountId?: string;
  category?: string;
  cycleStart?: string;
  cycleEnd?: string;
  pendingAmount?: number;
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

function monthKey(ref: Date = new Date()): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
}

function clampedDay(ref: Date, day: number): number {
  return Math.min(Math.max(1, day || 1), endOfMonth(ref).getDate());
}

function dateForMonthDay(ref: Date, day: number): string {
  const d = new Date(ref.getFullYear(), ref.getMonth(), clampedDay(ref, day));
  return toISO(d);
}

function monthlyOverrides(state: AppState, ref: Date = new Date()): PlannedExpenseOverride[] {
  const month = monthKey(ref);
  return (state.plannedExpenseOverrides ?? []).filter((override) => override.month === month);
}

function overrideFor(
  state: AppState,
  sourceType: PlannedExpenseSourceType,
  sourceId: string,
  ref: Date = new Date(),
): PlannedExpenseOverride | undefined {
  return monthlyOverrides(state, ref).find(
    (override) => override.sourceType === sourceType && override.sourceId === sourceId,
  );
}

function billExpenseItems(state: AppState, ref: Date = new Date()): CashFlowBreakdownItem[] {
  const recurring = state.recurringBills.flatMap((bill) => {
    if (!bill.active) return [];
    const override = overrideFor(state, "recurring_bill", bill.id, ref);
    if (override?.action === "skip") return [];
    const accountId = override?.accountId ?? bill.accountId;
    const account = state.accounts.find((item) => item.id === accountId);
    const dueDay = override?.dueDay ?? bill.dueDay;
    const dueDate = dateForMonthDay(ref, dueDay);
    return [
      {
        id: bill.id,
        label: override?.name ?? bill.name,
        detail: account ? `Due ${dueDate} - ${account.name}` : `Due ${dueDate}`,
        amount: override?.amount ?? bill.amount,
        sourceType: "recurring_bill" as const,
        sourceId: bill.id,
        overrideId: override?.id,
        dueDay,
        dueDate,
        accountId,
        category: override?.category ?? "Bills",
      },
    ];
  });

  const oneTime = monthlyOverrides(state, ref)
    .filter((override) => override.sourceType === "one_time" && override.action === "add")
    .map((override) => {
      const account = state.accounts.find((item) => item.id === override.accountId);
      const dueDate = override.dueDate ?? dateForMonthDay(ref, override.dueDay ?? 1);
      return {
        id: override.id,
        label: override.name ?? "Planned expense",
        detail: account ? `Due ${dueDate} - ${account.name}` : `Due ${dueDate}`,
        amount: override.amount ?? 0,
        sourceType: "one_time" as const,
        overrideId: override.id,
        dueDay: override.dueDay,
        dueDate,
        accountId: override.accountId,
        category: override.category ?? "Other",
      };
    });

  return [...recurring, ...oneTime].filter((item) => item.amount > 0);
}

export function upcomingBillsThisMonth(state: AppState, ref: Date = new Date()): number {
  return billExpenseItems(state, ref).reduce((s, item) => s + item.amount, 0);
}

export function cardMinimums(state: AppState): number {
  return state.cards.reduce((s, c) => s + Math.min(c.minimumDue, c.currentBalance), 0);
}

/**
 * Cycle-aware: expected upcoming card statements. Current card balances are
 * treated as posted balances; tracked expenses in the final two days before
 * statement close are held out as likely pending unless they are already part
 * of an untracked posted balance snapshot.
 */
function cardDueItems(state: AppState, ref: Date = new Date()): CashFlowBreakdownItem[] {
  return state.cards.flatMap((card) => {
    const cycle = currentOpenCycle(card, ref);
    if (isZeroAprCard(card)) {
      const promoEndsThisCycle = !!card.zeroAprEndDate && cycle.cycleEnd >= card.zeroAprEndDate;
      if (promoEndsThisCycle) {
        if (card.currentBalance <= 0) return [];
        return [
          {
            id: `${card.id}:promo-payoff`,
            label: card.name,
            detail: `0% APR ends ${card.zeroAprEndDate} - pay in full before statement closes ${cycle.cycleEnd}`,
            amount: card.currentBalance,
            sourceType: "card_due" as const,
            sourceId: card.id,
            dueDate: cycle.cycleEnd,
            cycleStart: cycle.cycleStart,
            cycleEnd: cycle.cycleEnd,
          },
        ];
      }

      const targetPaydown = paydownToTarget(card);
      const remainingAfterPaydown = Math.max(0, card.currentBalance - targetPaydown);
      const estimatedMinimum = Math.min(card.minimumDue, remainingAfterPaydown);
      const items: CashFlowBreakdownItem[] = [];

      if (targetPaydown > 0) {
        items.push({
          id: `${card.id}:target-paydown`,
          label: card.name,
          detail: `Pay down to ${card.targetUtilizationPercent}% before statement closes ${cycle.cycleEnd}`,
          amount: targetPaydown,
          sourceType: "card_due" as const,
          sourceId: card.id,
          dueDate: cycle.cycleEnd,
          cycleStart: cycle.cycleStart,
          cycleEnd: cycle.cycleEnd,
        });
      }

      if (estimatedMinimum > 0) {
        items.push({
          id: `${card.id}:minimum-due`,
          label: targetPaydown > 0 ? `${card.name} minimum` : card.name,
          detail: `Estimated minimum due ${cycle.dueDate} after statement closes ${cycle.cycleEnd}`,
          amount: estimatedMinimum,
          sourceType: "card_due" as const,
          sourceId: card.id,
          dueDate: cycle.dueDate,
          cycleStart: cycle.cycleStart,
          cycleEnd: cycle.cycleEnd,
        });
      }

      return items;
    }

    const cycleExpenses = expensesInCycle(state.transactions, card.id, cycle);
    const postedCycleExpenses = cycleExpenses.filter(
      (expense) => !isLikelyPendingNearStatement(expense.date, cycle),
    );
    const postedTrackedAmount = postedCycleExpenses.reduce((s, t) => s + t.amount, 0);
    const unreconciledTrackedAmount = state.transactions
      .filter(
        (transaction) =>
          transaction.type === "expense" &&
          transaction.cardId === card.id &&
          !transaction.reconciledByPaymentId,
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const untrackedPostedBalance = Math.max(0, card.currentBalance - unreconciledTrackedAmount);
    const pendingTrackedAmount = cycleExpenses.reduce(
      (sum, expense) =>
        sum + (isLikelyPendingNearStatement(expense.date, cycle) ? expense.amount : 0),
      0,
    );
    const amount = Math.min(card.currentBalance, untrackedPostedBalance + postedTrackedAmount);

    if (amount <= 0) return [];
    return [
      {
        id: card.id,
        label: card.name,
        detail: `Statement closes ${cycle.cycleEnd} - due ${cycle.dueDate}`,
        amount,
        sourceType: "card_due" as const,
        sourceId: card.id,
        dueDate: cycle.dueDate,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        pendingAmount: pendingTrackedAmount,
      },
    ];
  });
}

export function upcomingCardBills(state: AppState, ref: Date = new Date()): number {
  return cardDueItems(state, ref).reduce((s, item) => s + item.amount, 0);
}

export function cardDueThisMonth(state: AppState, ref: Date = new Date()): number {
  return upcomingCardBills(state, ref);
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

function debtPlanItems(state: AppState, ref: Date = new Date()): CashFlowBreakdownItem[] {
  return state.debts
    .filter((debt) => debt.status === "active")
    .flatMap((debt) => {
      const override = overrideFor(state, "debt_plan", debt.id, ref);
      if (override?.action === "skip") return [];
      const amount = override?.amount ?? plannedDebtPayment(debt, ref);
      if (amount <= 0) return [];
      const dueDay = override?.dueDay ?? debt.dueDate;
      const dueDate = dateForMonthDay(ref, dueDay);
      return [
        {
          id: debt.id,
          label: override?.name ?? debt.name,
          detail: `Due ${dueDate}`,
          amount,
          sourceType: "debt_plan" as const,
          sourceId: debt.id,
          overrideId: override?.id,
          dueDay,
          dueDate,
        },
      ];
    });
}

export function debtPlannedPayments(state: AppState, ref: Date = new Date()): number {
  return debtPlanItems(state, ref).reduce((s, item) => s + item.amount, 0);
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

export function expensesComingBreakdown(
  state: AppState,
  ref: Date = new Date(),
): CashFlowBreakdownSection[] {
  const billItems = billExpenseItems(state, ref);
  const recurringBillItems = billItems.filter((item) => item.sourceType === "recurring_bill");
  const oneTimeItems = billItems.filter((item) => item.sourceType === "one_time");
  const cardItems = cardDueItems(state, ref);
  const debtItems = debtPlanItems(state, ref);
  const sections: CashFlowBreakdownSection[] = [];
  if (recurringBillItems.length > 0) sections.push({ title: "Bills", items: recurringBillItems });
  if (oneTimeItems.length > 0)
    sections.push({ title: "One-time planned expenses", items: oneTimeItems });
  if (cardItems.length > 0) sections.push({ title: "Upcoming card bills", items: cardItems });
  if (debtItems.length > 0) sections.push({ title: "Debt plan", items: debtItems });
  return sections;
}

export function expensesComingTotal(state: AppState, ref: Date = new Date()): number {
  return expensesComingBreakdown(state, ref).reduce(
    (sum, section) => sum + section.items.reduce((sectionSum, item) => sectionSum + item.amount, 0),
    0,
  );
}

function nextUnpaidIncomeDate(state: AppState, ref: Date = new Date()): string | null {
  const entries = entriesForMonth(state.timesheet, state.jobs, ref)
    .filter(
      (entry) => !entry.paid && entry.entryType !== "time_off" && timesheetEntryAmount(entry) > 0,
    )
    .map((entry) => entry.date)
    .filter((date) => date >= toISO(ref))
    .sort((a, b) => a.localeCompare(b));
  return entries[0] ?? null;
}

function protectedExpenseSections(
  state: AppState,
  ref: Date = new Date(),
): { nextIncomeDate: string; sections: CashFlowBreakdownSection[]; total: number } {
  const today = toISO(ref);
  const nextIncomeDate = nextUnpaidIncomeDate(state, ref) ?? toISO(endOfMonth(ref));
  const sections = expensesComingBreakdown(state, ref)
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => item.dueDate && item.dueDate >= today && item.dueDate <= nextIncomeDate,
      ),
    }))
    .filter((section) => section.items.length > 0);
  const total = sections.reduce(
    (sum, section) => sum + section.items.reduce((sectionSum, item) => sectionSum + item.amount, 0),
    0,
  );

  return { nextIncomeDate, sections, total };
}

export function spendableToday(state: AppState, ref: Date = new Date()): number {
  const protectedExpenses = protectedExpenseSections(state, ref).total;
  return spendableCash(state) - protectedExpenses - state.profile.safeToSpendFloor;
}

export function spendableTodayBreakdown(
  state: AppState,
  ref: Date = new Date(),
): CashFlowBreakdownSection[] {
  const haveNow = spendableCash(state);
  const {
    nextIncomeDate,
    sections,
    total: protectedExpenses,
  } = protectedExpenseSections(state, ref);

  return [
    {
      title: "Today check formula",
      items: [
        {
          id: "spendable-today-have-now",
          label: "Have now",
          detail: "Current spendable cash",
          amount: haveNow,
        },
        {
          id: "spendable-today-protected-expenses",
          label: "Expenses before next income",
          detail: `Due between today and ${nextIncomeDate}`,
          amount: -protectedExpenses,
        },
        {
          id: "spendable-today-floor",
          label: "Safe-to-spend floor",
          detail: "Cash buffer kept aside",
          amount: -state.profile.safeToSpendFloor,
        },
      ],
    },
    ...sections,
  ];
}

export function leftToSpendBreakdown(
  state: AppState,
  monthDate: Date = new Date(),
): CashFlowBreakdownSection[] {
  const haveNow = spendableCash(state);
  const incomeComing = pendingIncome(state, monthDate);
  const expensesComing = expensesComingTotal(state, monthDate);

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
          detail: "Bills, upcoming card bills, and debt plan",
          amount: -expensesComing,
        },
      ],
    },
  ];
}

export function safeToSpend(state: AppState): number {
  return spendableCash(state) - expensesComingTotal(state) - state.profile.safeToSpendFloor;
}

export function projectedMonthEnd(state: AppState): number {
  return spendableCash(state) + pendingIncome(state) - expensesComingTotal(state);
}
