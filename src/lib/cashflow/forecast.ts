import {
  AppState,
  Debt,
  Job,
  PlannedExpenseOverride,
  PlannedExpenseSourceType,
  RecurringBill,
  TimesheetEntry,
} from "./types";
import {
  cycleForDate,
  currentOpenCycle,
  expensesInCycle,
  isLikelyPendingNearStatement,
  isZeroAprCard,
  paydownToTarget,
} from "./cardLogic";
import {
  addDays,
  addMonths,
  endOfMonth,
  formatDisplayDate,
  fromISODate,
  startOfMonth,
} from "./dates";
import { formatMoney } from "./money";
import { forecastIncomeEntriesForMonth, timesheetEntryAmount } from "./timesheetLogic";
import { monthlyBudgetSummary } from "./budget";

export type CashFlowPeriod = "this_month" | "next_30_days" | "next_6_months" | "custom";

export const cashFlowPeriodLabels: Record<CashFlowPeriod, string> = {
  this_month: "This month",
  next_30_days: "Next 30 days",
  next_6_months: "Next 6 months",
  custom: "Custom range",
};

export interface ForecastDateRange {
  start: string;
  end: string;
}

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
  paymentMethod?: "account" | "card";
  accountId?: string;
  cardId?: string;
  category?: string;
  cycleStart?: string;
  cycleEnd?: string;
  periodDate?: string;
  pendingAmount?: number;
  jobId?: string;
  payDate?: string;
  incomeSourceType?: "salary_paycheck" | "work_paycheck" | "one_time";
  incomeConfidence?: "confirmed" | "projected";
  incomeEntryIds?: string[];
  incomeEntries?: TimesheetEntry[];
  isOverdue?: boolean;
}


export interface CashFlowBreakdownSection {
  title: string;
  items: CashFlowBreakdownItem[];
}

export interface CashFlowAffordability {
  itemId: string;
  eventId: string;
  label: string;
  date: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  affordable: boolean;
  recoveryDate?: string;
  recoveryBalance?: number;
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

export function cashFlowPeriodRange(
  period: CashFlowPeriod,
  ref: Date = new Date(),
  customRange?: ForecastDateRange,
): ForecastDateRange {
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (period === "custom" && customRange?.start && customRange?.end) {
    return customRange.start <= customRange.end
      ? customRange
      : { start: customRange.end, end: customRange.start };
  }
  if (period === "custom") {
    return { start: toISO(today), end: toISO(today) };
  }
  if (period === "this_month") {
    return { start: toISO(startOfMonth(today)), end: toISO(endOfMonth(today)) };
  }
  if (period === "next_30_days") {
    return { start: toISO(today), end: toISO(addDays(today, 30)) };
  }
  return {
    start: toISO(today),
    end: toISO(new Date(today.getFullYear(), today.getMonth() + 6, today.getDate())),
  };
}

function monthRefsForRange(range: ForecastDateRange): Date[] {
  const refs: Date[] = [];
  let cursor = startOfMonth(fromISODate(range.start));
  const end = startOfMonth(fromISODate(range.end));
  while (cursor <= end) {
    refs.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return refs;
}

function itemInRange(item: CashFlowBreakdownItem, range: ForecastDateRange): boolean {
  const rangeDate = item.periodDate ?? item.dueDate;
  return !!rangeDate && rangeDate >= range.start && rangeDate <= range.end;
}

function sortByDueDate(items: CashFlowBreakdownItem[]): CashFlowBreakdownItem[] {
  return [...items].sort((a, b) => {
    const dueOrder = (a.periodDate ?? a.dueDate ?? "").localeCompare(
      b.periodDate ?? b.dueDate ?? "",
    );
    if (dueOrder !== 0) return dueOrder;
    return a.label.localeCompare(b.label);
  });
}

function clampedDay(ref: Date, day: number): number {
  return Math.min(Math.max(1, day || 1), endOfMonth(ref).getDate());
}

function dateForMonthDay(ref: Date, day: number): string {
  const d = new Date(ref.getFullYear(), ref.getMonth(), clampedDay(ref, day));
  return toISO(d);
}

function dateForWeekdayOfMonth(ref: Date, week: number, weekday: number): string {
  const targetWeek = Math.min(Math.max(1, week || 1), 5);
  const targetWeekday = Math.min(Math.max(0, weekday || 0), 6);
  const firstOfMonth = startOfMonth(ref);
  const firstMatchingDay = 1 + ((targetWeekday - firstOfMonth.getDay() + 7) % 7);
  let day = firstMatchingDay + (targetWeek - 1) * 7;
  const lastDay = endOfMonth(ref).getDate();
  if (day > lastDay) {
    day -= 7;
  }
  return dateForMonthDay(ref, day);
}

export function recurringBillDueDate(bill: RecurringBill, ref: Date = new Date()): string {
  if (bill.dueRule === "weekday_of_month") {
    return dateForWeekdayOfMonth(ref, bill.dueWeek ?? 1, bill.dueWeekday ?? 0);
  }
  return dateForMonthDay(ref, bill.dueDay);
}

export function recurringBillScheduleLabel(bill: RecurringBill): string {
  if (bill.dueRule === "weekday_of_month") {
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const week = Math.min(Math.max(1, bill.dueWeek ?? 1), 5);
    const weekLabel = week === 5 ? "last week" : `week ${week}`;
    const weekday = weekdays[Math.min(Math.max(0, bill.dueWeekday ?? 0), 6)];
    return `${weekday} ${weekLabel}`;
  }
  return `Day ${bill.dueDay}`;
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
    const paymentMethod =
      override?.paymentMethod ??
      bill.paymentMethod ??
      (override?.cardId || bill.cardId ? "card" : "account");
    const accountId = override?.accountId ?? bill.accountId;
    const cardId = override?.cardId ?? bill.cardId;
    const account = state.accounts.find((item) => item.id === accountId);
    const card = state.cards.find((item) => item.id === cardId);
    const baseDueDate = recurringBillDueDate(bill, ref);
    const dueDay = override?.dueDay ?? Number(baseDueDate.slice(8, 10));
    const dueDate =
      override?.dueDate ?? (override?.dueDay ? dateForMonthDay(ref, dueDay) : baseDueDate);
    const destination =
      paymentMethod === "card" && card
        ? card.name
        : paymentMethod === "card"
          ? "Credit card"
          : account?.name;
    return [
      {
        id: `${bill.id}:${monthKey(ref)}`,
        label: override?.name ?? bill.name,
        detail: destination
          ? `Due ${formatDisplayDate(dueDate)} - ${destination}`
          : `Due ${formatDisplayDate(dueDate)}`,
        amount: override?.amount ?? bill.amount,
        sourceType: "recurring_bill" as const,
        sourceId: bill.id,
        overrideId: override?.id,
        dueDay,
        dueDate,
        paymentMethod,
        accountId,
        cardId,
        category: override?.category ?? "Bills",
      },
    ];
  });

  const oneTime = monthlyOverrides(state, ref)
    .filter((override) => override.sourceType === "one_time" && override.action === "add")
    .map((override) => {
      const paymentMethod = override.paymentMethod ?? (override.cardId ? "card" : "account");
      const account = state.accounts.find((item) => item.id === override.accountId);
      const card = state.cards.find((item) => item.id === override.cardId);
      const dueDate = override.dueDate ?? dateForMonthDay(ref, override.dueDay ?? 1);
      const destination =
        paymentMethod === "card" && card
          ? card.name
          : paymentMethod === "card"
            ? "Credit card"
            : account?.name;
      return {
        id: override.id,
        label: override.name ?? "Planned expense",
        detail: destination
          ? `Due ${formatDisplayDate(dueDate)} - ${destination}`
          : `Due ${formatDisplayDate(dueDate)}`,
        amount: override.amount ?? 0,
        sourceType: "one_time" as const,
        overrideId: override.id,
        dueDay: override.dueDay,
        dueDate,
        paymentMethod,
        accountId: override.accountId,
        cardId: override.cardId,
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
  const monthCardOverride = (itemId: string, dueDate?: string) =>
    overrideFor(state, "card_due", itemId, ref) ??
    (dueDate ? overrideFor(state, "card_due", itemId, fromISODate(dueDate)) : undefined);
  return state.cards.flatMap((card) => {
    const cycle = currentOpenCycle(card, ref);
    if (isZeroAprCard(card)) {
      const promoEndsThisCycle = !!card.zeroAprEndDate && cycle.cycleEnd >= card.zeroAprEndDate;
      if (promoEndsThisCycle) {
        if (card.currentBalance <= 0) return [];
        const itemId = `${card.id}:promo-payoff`;
        if (monthCardOverride(itemId, cycle.cycleEnd)?.action === "skip") return [];
        return [
          {
            id: itemId,
            label: card.name,
            detail: `0% APR ends ${formatDisplayDate(card.zeroAprEndDate)} - pay in full before statement closes ${formatDisplayDate(cycle.cycleEnd)}`,
            amount: card.currentBalance,
            sourceType: "card_due" as const,
            sourceId: card.id,
            dueDate: cycle.cycleEnd,
            cycleStart: cycle.cycleStart,
            cycleEnd: cycle.cycleEnd,
            periodDate: cycle.cycleEnd,
          },
        ];
      }

      const targetPaydown = paydownToTarget(card);
      const remainingAfterPaydown = Math.max(0, card.currentBalance - targetPaydown);
      const estimatedMinimum = Math.min(card.minimumDue, remainingAfterPaydown);
      const items: CashFlowBreakdownItem[] = [];

      if (targetPaydown > 0) {
        const itemId = `${card.id}:target-paydown`;
        if (monthCardOverride(itemId, cycle.cycleEnd)?.action !== "skip") {
          items.push({
            id: itemId,
            label: card.name,
            detail: `Pay down to ${card.targetUtilizationPercent}% before statement closes ${formatDisplayDate(cycle.cycleEnd)}`,
            amount: targetPaydown,
            sourceType: "card_due" as const,
            sourceId: card.id,
            dueDate: cycle.cycleEnd,
            cycleStart: cycle.cycleStart,
            cycleEnd: cycle.cycleEnd,
            periodDate: cycle.cycleEnd,
          });
        }
      }

      if (estimatedMinimum > 0) {
        const itemId = `${card.id}:minimum-due`;
        if (monthCardOverride(itemId, cycle.dueDate)?.action !== "skip") {
          items.push({
            id: itemId,
            label: targetPaydown > 0 ? `${card.name} minimum` : card.name,
            detail: `Estimated minimum due ${formatDisplayDate(cycle.dueDate)} after statement closes ${formatDisplayDate(cycle.cycleEnd)}`,
            amount: estimatedMinimum,
            sourceType: "card_due" as const,
            sourceId: card.id,
            dueDate: cycle.dueDate,
            cycleStart: cycle.cycleStart,
            cycleEnd: cycle.cycleEnd,
            periodDate: cycle.cycleEnd,
          });
        }
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
    if (monthCardOverride(card.id, cycle.dueDate)?.action === "skip") return [];

    if (amount <= 0) return [];
    return [
      {
        id: card.id,
        label: card.name,
        detail: `Statement closes ${formatDisplayDate(cycle.cycleEnd)} - due ${formatDisplayDate(cycle.dueDate)}`,
        amount,
        sourceType: "card_due" as const,
        sourceId: card.id,
        dueDate: cycle.dueDate,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        periodDate: cycle.cycleEnd,
        pendingAmount: pendingTrackedAmount,
      },
    ];
  });
}

function eventDateInRange(date: string, range: ForecastDateRange): boolean {
  return date >= range.start && date <= range.end;
}

function cardPaymentOverride(state: AppState, itemId: string): PlannedExpenseOverride | undefined {
  return (state.plannedExpenseOverrides ?? []).find(
    (override) => override.sourceType === "card_due" && override.sourceId === itemId,
  );
}

function cardCashFlowItemsForRange(
  state: AppState,
  ref: Date,
  range: ForecastDateRange,
): CashFlowBreakdownItem[] {
  const today = toISO(ref);
  const items: CashFlowBreakdownItem[] = [];
  const generationEnd = toISO(addMonths(fromISODate(range.end), 2));

  function pushCardItem(item: CashFlowBreakdownItem) {
    const override = cardPaymentOverride(state, item.id);
    if (override?.action === "skip") return;
    const rawDueDate = override?.dueDate ?? item.dueDate ?? item.periodDate ?? today;
    if (!eventDateInRange(rawDueDate, range)) return;
    const amount = override?.amount ?? item.amount;
    if (amount <= 0) return;
    items.push({
      ...item,
      label: override?.name ?? item.label,
      amount,
      overrideId: override?.id,
      dueDate: rawDueDate,
      periodDate: rawDueDate,
      detail: override?.dueDate
        ? `${item.detail} - payment date changed to ${formatDisplayDate(rawDueDate)}`
        : item.detail,
    });
  }

  state.cards.forEach((card) => {
    if (card.currentBalance <= 0) return;
    const paymentAccountId = card.defaultPaymentAccountId;

    if (!isZeroAprCard(card)) {
      const generatedStatementAmount = Math.min(
        card.currentBalance,
        Math.max(0, card.statementBalance),
      );
      if (generatedStatementAmount > 0) {
        const generatedCycle = cycleForDate(card, ref);
        pushCardItem({
          id: `${card.id}:generated-statement:${generatedCycle.cycleEnd}`,
          label: `${card.name} statement`,
          detail: `Generated statement - due ${formatDisplayDate(generatedCycle.dueDate)}`,
          amount: generatedStatementAmount,
          sourceType: "card_due",
          sourceId: card.id,
          dueDate: today,
          accountId: paymentAccountId,
          cycleStart: generatedCycle.cycleStart,
          cycleEnd: generatedCycle.cycleEnd,
          periodDate: today,
        });
      }
      const cycle = currentOpenCycle(card, ref);
      const rawDueDate = cycle.cycleEnd >= today ? cycle.cycleEnd : today;
      const openCycleBalance = Math.max(0, card.currentBalance - generatedStatementAmount);
      if (openCycleBalance <= 0) return;
      pushCardItem({
        id: `${card.id}:cash-payoff:${rawDueDate}`,
        label: card.name,
        detail: `Statement closes ${formatDisplayDate(cycle.cycleEnd)} - planned for payment when generated`,
        amount: openCycleBalance,
        sourceType: "card_due",
        sourceId: card.id,
        dueDate: rawDueDate,
        accountId: paymentAccountId,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        periodDate: rawDueDate,
      });
      return;
    }

    let remainingBalance = card.currentBalance;
    let cycle = currentOpenCycle(card, ref);
    const generatedMinimum = Math.min(card.minimumDue, remainingBalance);
    if (generatedMinimum > 0 && card.statementBalance > 0) {
      const generatedCycle = cycleForDate(card, ref);
      pushCardItem({
        id: `${card.id}:generated-minimum:${generatedCycle.cycleEnd}`,
        label: `${card.name} minimum`,
        detail: `Generated minimum payment - due ${formatDisplayDate(generatedCycle.dueDate)}`,
        amount: generatedMinimum,
        sourceType: "card_due",
        sourceId: card.id,
        dueDate: today,
        accountId: paymentAccountId,
        cycleStart: generatedCycle.cycleStart,
        cycleEnd: generatedCycle.cycleEnd,
        periodDate: today,
      });
      remainingBalance = Math.max(0, remainingBalance - generatedMinimum);
    }
    const targetBalance = (card.targetUtilizationPercent / 100) * card.limit;
    const currentTargetPaydown = Math.max(0, remainingBalance - targetBalance);

    if (card.zeroAprEndDate && cycle.cycleEnd >= card.zeroAprEndDate) {
      pushCardItem({
        id: `${card.id}:promo-payoff:${cycle.cycleEnd}`,
        label: card.name,
        detail: `0% APR payoff before statement closes ${formatDisplayDate(cycle.cycleEnd)}`,
        amount: remainingBalance,
        sourceType: "card_due",
        sourceId: card.id,
        dueDate: cycle.cycleEnd,
        accountId: paymentAccountId,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        periodDate: cycle.cycleEnd,
      });
      return;
    }

    if (currentTargetPaydown > 0) {
      pushCardItem({
        id: `${card.id}:target-paydown:${cycle.cycleEnd}`,
        label: card.name,
        detail: `Pay down to ${card.targetUtilizationPercent}% before statement closes ${formatDisplayDate(cycle.cycleEnd)}`,
        amount: currentTargetPaydown,
        sourceType: "card_due",
        sourceId: card.id,
        dueDate: cycle.cycleEnd,
        accountId: paymentAccountId,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        periodDate: cycle.cycleEnd,
      });
      remainingBalance = Math.max(0, remainingBalance - currentTargetPaydown);
    }

    for (let guard = 0; guard < 12 && remainingBalance > 0; guard += 1) {
      const promoEndsThisCycle = !!card.zeroAprEndDate && cycle.cycleEnd >= card.zeroAprEndDate;
      const amount = promoEndsThisCycle
        ? remainingBalance
        : Math.min(card.minimumDue, remainingBalance);
      const rawDueDate = cycle.cycleEnd;

      if (amount > 0) {
        pushCardItem({
          id: `${card.id}:${promoEndsThisCycle ? "promo-payoff" : "minimum-due"}:${cycle.cycleEnd}`,
          label: promoEndsThisCycle ? card.name : `${card.name} minimum`,
          detail: promoEndsThisCycle
            ? `0% APR payoff before statement closes ${formatDisplayDate(cycle.cycleEnd)}`
            : `Estimated minimum after statement closes ${formatDisplayDate(cycle.cycleEnd)} - due ${formatDisplayDate(cycle.dueDate)}`,
          amount,
          sourceType: "card_due",
          sourceId: card.id,
          dueDate: rawDueDate,
          accountId: paymentAccountId,
          cycleStart: cycle.cycleStart,
          cycleEnd: cycle.cycleEnd,
          periodDate: rawDueDate,
        });
      }

      remainingBalance = Math.max(0, remainingBalance - amount);
      if (promoEndsThisCycle || cycle.cycleEnd > generationEnd) break;
      cycle = currentOpenCycle(card, addDays(fromISODate(cycle.cycleEnd), 1));
    }
  });

  const seen = new Set<string>();
  return sortByDueDate(
    items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return item.amount > 0;
    }),
  );
}

export function upcomingCardBills(state: AppState, ref: Date = new Date()): number {
  return cardDueItems(state, ref).reduce((s, item) => s + item.amount, 0);
}

export function upcomingCardBillItems(
  state: AppState,
  ref: Date = new Date(),
): CashFlowBreakdownItem[] {
  return cardDueItems(state, ref);
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

  // Respect optional start/end window — additive; empty fields preserve prior behavior.
  if (debt.startDate) {
    const start = new Date(`${debt.startDate}T00:00:00`);
    if (!Number.isNaN(start.getTime()) && start > ref) return 0;
  }
  if (debt.endDate) {
    const end = new Date(`${debt.endDate}T23:59:59`);
    if (!Number.isNaN(end.getTime()) && end < ref) return 0;
  }

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

function debtIsScheduledForDate(debt: Debt, dueDate: string): boolean {
  if (debt.balance <= 0 || debt.status === "paused" || debt.status === "paid_off") return false;

  // A not-started debt is deliberately visible only once its configured start date arrives.
  // Without a start date, there is no reliable date at which to forecast it.
  if (debt.status === "not_started" && !debt.startDate) return false;
  if (debt.startDate && dueDate < debt.startDate) return false;
  return !debt.endDate || dueDate <= debt.endDate;
}

function scheduledDebtPayment(debt: Debt, remainingBalance: number, ref: Date): number {
  if (remainingBalance <= 0) return 0;

  let planned = debt.minimumPayment;
  if (debt.payoffMode === "payments" && debt.payoffPaymentCount && debt.payoffPaymentCount > 0) {
    // Keep the requested payment size stable rather than recalculating it from a shrinking balance.
    planned = debt.balance / debt.payoffPaymentCount;
  } else if (debt.payoffMode === "date" && debt.payoffTargetDate) {
    const target = new Date(`${debt.payoffTargetDate}T00:00:00`);
    if (!Number.isNaN(target.getTime())) {
      const months =
        (target.getFullYear() - ref.getFullYear()) * 12 + (target.getMonth() - ref.getMonth()) + 1;
      planned = remainingBalance / Math.max(1, months);
    }
  } else if (
    debt.payoffMode === "custom" &&
    debt.plannedMonthlyPayment &&
    debt.plannedMonthlyPayment > 0
  ) {
    planned = debt.plannedMonthlyPayment;
  }

  return Math.min(remainingBalance, Math.max(debt.minimumPayment, planned));
}

function debtPlanItemsForRange(
  state: AppState,
  ref: Date,
  range: ForecastDateRange,
): CashFlowBreakdownItem[] {
  const scheduleStart = startOfMonth(ref);
  const scheduleEnd = endOfMonth(fromISODate(range.end));
  const scheduleRange = { start: toISO(scheduleStart), end: toISO(scheduleEnd) };
  const monthRefs = monthRefsForRange(scheduleRange);

  return state.debts.flatMap((debt) => {
    let remainingBalance = debt.balance;
    const items: CashFlowBreakdownItem[] = [];

    monthRefs.forEach((monthRef) => {
      const override = overrideFor(state, "debt_plan", debt.id, monthRef);
      const dueDay = override?.dueDay ?? debt.dueDate;
      const dueDate = override?.dueDate ?? dateForMonthDay(monthRef, dueDay);
      if (!debtIsScheduledForDate(debt, dueDate)) return;

      if (override?.action === "skip") return;
      const plannedAmount = scheduledDebtPayment(debt, remainingBalance, monthRef);
      const amount = Math.min(remainingBalance, override?.amount ?? plannedAmount);
      if (amount <= 0) return;

      // The stored balance is today's unpaid balance. A past-due item carried into the safety
      // timeline still consumes that balance, so later months cannot schedule it a second time.
      remainingBalance = Math.max(0, remainingBalance - amount);
      if (!itemInRange({ id: "", label: "", amount, dueDate }, range)) return;

      items.push({
        id: `${debt.id}:${monthKey(monthRef)}`,
        label: override?.name ?? debt.name,
        detail: `Due ${formatDisplayDate(dueDate)}`,
        amount,
        sourceType: "debt_plan",
        sourceId: debt.id,
        overrideId: override?.id,
        dueDay,
        dueDate,
        accountId: debt.defaultPaymentAccountId,
      });
    });

    return items;
  });
}

function debtPlanItems(state: AppState, ref: Date = new Date()): CashFlowBreakdownItem[] {
  const range = { start: toISO(startOfMonth(ref)), end: toISO(endOfMonth(ref)) };
  return debtPlanItemsForRange(state, ref, range);
}

export function debtPlannedPayments(state: AppState, ref: Date = new Date()): number {
  return debtPlanItems(state, ref).reduce((s, item) => s + item.amount, 0);
}

function nextWeekdayAfter(date: Date, weekday: number): Date {
  const target = Math.min(6, Math.max(0, weekday));
  const daysUntil = (target - date.getDay() + 7) % 7 || 7;
  return addDays(date, daysUntil);
}

function nextSemimonthlyDateAfter(date: Date, days: [number, number] | undefined): Date {
  const targets = [...(days ?? [1, 15])].sort((a, b) => a - b);
  for (let monthOffset = 0; monthOffset <= 1; monthOffset += 1) {
    const ref = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
    const last = endOfMonth(ref).getDate();
    for (const target of targets) {
      const candidate = new Date(ref.getFullYear(), ref.getMonth(), Math.min(target, last));
      if (candidate > date) return candidate;
    }
  }
  return new Date(date.getFullYear(), date.getMonth() + 2, 1);
}

function nextMonthlyDateAfter(date: Date, dayOfMonth: number): Date {
  for (let monthOffset = 0; monthOffset <= 1; monthOffset += 1) {
    const ref = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
    const candidate = new Date(ref.getFullYear(), ref.getMonth(), clampedDay(ref, dayOfMonth));
    if (candidate > date) return candidate;
  }
  return new Date(date.getFullYear(), date.getMonth() + 2, 1);
}

function firstBiweeklyPayDateAfter(date: Date, anchorDate: Date): Date {
  let payday = new Date(anchorDate);
  while (payday <= date) payday = addDays(payday, 14);
  while (addDays(payday, -14) > date) payday = addDays(payday, -14);
  return payday;
}

function fallbackBiweeklyAnchor(job: Job, firstWorkDate: string): Date {
  return nextWeekdayAfter(addDays(fromISODate(firstWorkDate), 7), job.paydayWeekday);
}

function payDateForWorkEntry(
  entry: TimesheetEntry,
  job: Job | undefined,
  fallbackAnchor?: Date,
): string {
  if (!job) return entry.date;
  const workDate = fromISODate(entry.date);

  if (job.payFrequency === "weekly") {
    return toISO(nextWeekdayAfter(workDate, job.paydayWeekday));
  }
  if (job.payFrequency === "biweekly") {
    const anchor = job.biweeklyAnchorDate ? fromISODate(job.biweeklyAnchorDate) : fallbackAnchor;
    if (!anchor || Number.isNaN(anchor.getTime()))
      return toISO(nextWeekdayAfter(workDate, job.paydayWeekday));
    return toISO(firstBiweeklyPayDateAfter(workDate, anchor));
  }
  if (job.payFrequency === "semimonthly") {
    return toISO(nextSemimonthlyDateAfter(workDate, job.semimonthlyDays));
  }
  if (job.payFrequency === "monthly") {
    return toISO(nextMonthlyDateAfter(workDate, Math.max(1, job.paydayWeekday || 1)));
  }
  return entry.date;
}

function monthRefsForIncomeRange(range: ForecastDateRange): Date[] {
  const expanded: ForecastDateRange = {
    start: toISO(addMonths(startOfMonth(fromISODate(range.start)), -1)),
    end: range.end,
  };
  return monthRefsForRange(expanded);
}

function paycheckDetail(payDate: string, entries: TimesheetEntry[]): string {
  const dates = Array.from(new Set(entries.map((entry) => entry.date))).sort((a, b) =>
    a.localeCompare(b),
  );
  const shiftLabel = entries.length === 1 ? "1 shift" : `${entries.length} shifts`;
  const dateSpan =
    dates.length === 1
      ? formatDisplayDate(dates[0])
      : `${formatDisplayDate(dates[0])} to ${formatDisplayDate(dates[dates.length - 1])}`;
  const source = entries.every((entry) => entry.auto)
    ? "planned"
    : entries.some((entry) => entry.auto)
      ? "entered/planned"
      : "entered";
  return `Payday ${formatDisplayDate(payDate)} - ${shiftLabel}, ${source} work ${dateSpan}`;
}

function incomeItemsForRange(state: AppState, range: ForecastDateRange): CashFlowBreakdownItem[] {
  const jobsById = new Map(state.jobs.map((job) => [job.id, job]));
  const incomeOverrides = state.plannedIncomeOverrides ?? [];
  const entries = monthRefsForIncomeRange(range).flatMap((monthRef) =>
    forecastIncomeEntriesForMonth(state.timesheet, state.jobs, monthRef),
  );
  const unpaidPositiveEntries = entries.filter(
    (entry) => !entry.paid && entry.entryType !== "time_off" && timesheetEntryAmount(entry) > 0,
  );
  const workEntries = unpaidPositiveEntries
    .filter((entry) => entry.entryType === "work_shift")
    .sort((a, b) => a.date.localeCompare(b.date));
  const anchorMonthStart = toISO(startOfMonth(fromISODate(range.start)));
  const anchorMonthEnd = toISO(endOfMonth(fromISODate(range.start)));
  const firstWorkDateByJob = new Map<string, string>();
  workEntries
    .filter((entry) => entry.date >= anchorMonthStart && entry.date <= anchorMonthEnd)
    .forEach((entry) => {
      if (!firstWorkDateByJob.has(entry.jobId)) firstWorkDateByJob.set(entry.jobId, entry.date);
    });
  workEntries.forEach((entry) => {
    if (!firstWorkDateByJob.has(entry.jobId)) firstWorkDateByJob.set(entry.jobId, entry.date);
  });
  const fallbackAnchors = new Map<string, Date>();
  firstWorkDateByJob.forEach((firstWorkDate, jobId) => {
    const job = jobsById.get(jobId);
    if (job?.payFrequency === "biweekly" && !job.biweeklyAnchorDate) {
      fallbackAnchors.set(jobId, fallbackBiweeklyAnchor(job, firstWorkDate));
    }
  });

  const salaryItems = unpaidPositiveEntries
    .filter((entry) => entry.entryType === "salary_paycheck")
    .filter((entry) => entry.date >= range.start && entry.date <= range.end)
    .map((entry) => ({
      id: entry.id,
      label: entry.jobName,
      detail: `Scheduled paycheck - ${formatDisplayDate(entry.date)}`,
      amount: timesheetEntryAmount(entry),
      periodDate: entry.date,
      jobId: entry.jobId,
      payDate: entry.date,
      incomeSourceType: "salary_paycheck" as const,
      incomeConfidence: "confirmed" as const,
      accountId: jobsById.get(entry.jobId)?.defaultDepositAccountId,
      incomeEntryIds: [entry.id],
      incomeEntries: [entry],
    }));

  const groups = new Map<
    string,
    { jobName: string; payDate: string; entries: TimesheetEntry[]; amount: number }
  >();

  workEntries.forEach((entry) => {
    const job = jobsById.get(entry.jobId);
    const payDate = payDateForWorkEntry(entry, job, fallbackAnchors.get(entry.jobId));
    if (payDate < range.start || payDate > range.end) return;
    const key = `${entry.jobId}:${payDate}`;
    const existing = groups.get(key) ?? {
      jobName: entry.jobName,
      payDate,
      entries: [],
      amount: 0,
    };
    existing.entries.push(entry);
    existing.amount += timesheetEntryAmount(entry);
    groups.set(key, existing);
  });

  const paycheckItems = Array.from(groups.entries()).map(([key, group]) => ({
    id: `paycheck-${key}`,
    label: group.jobName,
    detail: paycheckDetail(group.payDate, group.entries),
    amount: Math.round(group.amount * 100) / 100,
    periodDate: group.payDate,
    jobId: group.entries[0]?.jobId,
    payDate: group.payDate,
    incomeSourceType: "work_paycheck" as const,
    incomeConfidence: group.entries.every((entry) => entry.auto)
      ? ("projected" as const)
      : ("confirmed" as const),
    accountId: jobsById.get(group.entries[0]?.jobId ?? "")?.defaultDepositAccountId,
    incomeEntryIds: group.entries.map((entry) => entry.id),
    incomeEntries: group.entries,
  }));

  const items = [...salaryItems, ...paycheckItems].flatMap((item) => {
    const override = incomeOverrides.find(
      (candidate) => candidate.sourceId === item.id && candidate.payDate === item.payDate,
    );
    if (override?.action === "skip") return [];
    if (override?.action === "override") {
      const amount = override.amount ?? item.amount;
      if (amount <= 0) return [];
      return [
        {
          ...item,
          label: override.label ?? item.label,
          amount,
          overrideId: override.id,
          detail: `${item.detail} - edited for this payday`,
        },
      ];
    }
    return [item];
  });

  const oneTimeIncomeItems: CashFlowBreakdownItem[] = incomeOverrides
    .filter(
      (override) =>
        override.action === "add" &&
        (override.amount ?? 0) > 0 &&
        override.payDate >= range.start &&
        override.payDate <= range.end,
    )
    .map((override) => ({
      id: override.id,
      label: override.label ?? "One-time income",
      detail: `One-time income - ${formatDisplayDate(override.payDate)}`,
      amount: override.amount ?? 0,
      periodDate: override.payDate,
      payDate: override.payDate,
      overrideId: override.id,
      accountId: override.accountId,
      incomeSourceType: "one_time" as const,
      incomeConfidence: "confirmed" as const,
    }));

  return sortByDueDate([...items, ...oneTimeIncomeItems]);
}

function unpaidPendingIncomeItems(
  state: AppState,
  monthDate: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): CashFlowBreakdownItem[] {
  return incomeItemsForRange(state, cashFlowPeriodRange(period, monthDate, customRange));
}

export function pendingIncomeBreakdown(
  state: AppState,
  monthDate: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): CashFlowBreakdownSection[] {
  const incomeItems = unpaidPendingIncomeItems(state, monthDate, period, customRange);
  return incomeItems.length > 0 ? [{ title: "Upcoming paydays", items: incomeItems }] : [];
}

export function pendingIncome(
  state: AppState,
  monthDate: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): number {
  return unpaidPendingIncomeItems(state, monthDate, period, customRange).reduce(
    (sum, item) => sum + item.amount,
    0,
  );
}

function expenseSectionsForRange(
  state: AppState,
  ref: Date = new Date(),
  range: ForecastDateRange,
): CashFlowBreakdownSection[] {
  const today = toISO(ref);
  // Keep unpaid items whose due date has already passed in the current month visible
  // instead of letting them vanish from the forecast when the period starts at today.
  const expandedRange = {
    start: range.start < today ? range.start : toISO(startOfMonth(ref)),
    end: range.end,
  };
  const monthRefs = monthRefsForRange(expandedRange);

  const markOverdue = (item: CashFlowBreakdownItem): CashFlowBreakdownItem => {
    const dueDate = item.dueDate ?? item.periodDate;
    if (dueDate && dueDate < today) return { ...item, isOverdue: true };
    return item;
  };

  const billItems = sortByDueDate(
    monthRefs
      .flatMap((monthRef) => billExpenseItems(state, monthRef))
      .filter((item) => itemInRange(item, expandedRange))
      .map(markOverdue),
  );
  const recurringBillItems = billItems.filter((item) => item.sourceType === "recurring_bill");
  const oneTimeItems = billItems.filter((item) => item.sourceType === "one_time");
  const cardItems = cardCashFlowItemsForRange(state, ref, expandedRange).map(markOverdue);
  const debtItems = sortByDueDate(debtPlanItemsForRange(state, ref, expandedRange).map(markOverdue));
  const sections: CashFlowBreakdownSection[] = [];
  if (recurringBillItems.length > 0) sections.push({ title: "Bills", items: recurringBillItems });
  if (oneTimeItems.length > 0)
    sections.push({ title: "One-time planned expenses", items: oneTimeItems });
  if (cardItems.length > 0) sections.push({ title: "Upcoming card bills", items: cardItems });
  if (debtItems.length > 0) sections.push({ title: "Debt plan", items: debtItems });
  return sections;
}


export const SPENDABLE_TODAY_HORIZON_DAYS = 90;

function safetyExpenseSectionsForRange(
  state: AppState,
  ref: Date,
  range: ForecastDateRange,
): CashFlowBreakdownSection[] {
  const today = toISO(ref);
  const collectionRange = {
    start: toISO(startOfMonth(ref)),
    end: range.end,
  };
  const allSections = expenseSectionsForRange(state, ref, collectionRange);
  const directSections = allSections
    .filter((section) => section.title !== "Upcoming card bills")
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => item.paymentMethod !== "card")
        .map((item) => {
          const originalDate = item.dueDate ?? item.periodDate ?? today;
          if (originalDate >= today) return item;
          return {
            ...item,
            dueDate: today,
            periodDate: today,
            detail: `${item.detail ?? "Unpaid obligation"} - past due, protected today`,
          };
        }),
    }))
    .filter((section) => section.items.length > 0);

  const cardItems = cardCashFlowItemsForRange(state, ref, range);
  const cardFundedItems = allSections
    .filter((section) => section.title !== "Upcoming card bills")
    .flatMap((section) => section.items)
    .filter(
      (item) =>
        item.paymentMethod === "card" &&
        !!item.cardId &&
        !!item.dueDate &&
        item.dueDate >= today &&
        item.dueDate <= range.end,
    );

  const plannedCharges = new Map<
    string,
    {
      cardId: string;
      date: string;
      cycleStart: string;
      cycleEnd: string;
      amount: number;
      labels: string[];
    }
  >();
  cardFundedItems.forEach((item) => {
    const card = state.cards.find((candidate) => candidate.id === item.cardId);
    if (!card || !item.dueDate) return;
    let cycle = currentOpenCycle(card, item.dueDate);
    if (isLikelyPendingNearStatement(item.dueDate, cycle)) {
      cycle = currentOpenCycle(card, addDays(fromISODate(cycle.cycleEnd), 1));
    }
    if (cycle.cycleEnd > range.end) return;
    const key = `${card.id}:${cycle.cycleEnd}`;
    const existing = plannedCharges.get(key) ?? {
      cardId: card.id,
      date: cycle.cycleEnd,
      cycleStart: cycle.cycleStart,
      cycleEnd: cycle.cycleEnd,
      amount: 0,
      labels: [],
    };
    existing.amount += item.amount;
    existing.labels.push(item.label);
    plannedCharges.set(key, existing);
  });

  plannedCharges.forEach((charge) => {
    const card = state.cards.find((candidate) => candidate.id === charge.cardId);
    if (!card || charge.amount <= 0) return;
    const existing = cardItems.find(
      (item) => item.sourceId === card.id && item.dueDate === charge.date,
    );
    if (existing) {
      existing.amount += charge.amount;
      existing.detail = `${existing.detail} - includes ${formatMoney(
        charge.amount,
        state.profile.currency,
      )} planned card charge${charge.labels.length === 1 ? "" : "s"}`;
      return;
    }
    cardItems.push({
      id: `${card.id}:planned-charges:${charge.date}`,
      label: `${card.name} planned charges`,
      detail: `${charge.labels.join(", ")} - protected when the statement is generated`,
      amount: charge.amount,
      sourceType: "card_due",
      sourceId: card.id,
      dueDate: charge.date,
      periodDate: charge.date,
      accountId: card.defaultPaymentAccountId,
      cycleStart: charge.cycleStart,
      cycleEnd: charge.cycleEnd,
    });
  });

  if (cardItems.length > 0) {
    directSections.push({ title: "Upcoming card bills", items: sortByDueDate(cardItems) });
  }

  const rangeEndMonth = range.end.slice(0, 7);
  const budgetReserveItems = monthRefsForRange(range).flatMap((monthRef) => {
    const budgetMonth = monthKey(monthRef);
    const representedCommittedItems = allSections
      .flatMap((section) => section.items)
      .filter(
        (item) =>
          (item.sourceType === "recurring_bill" || item.sourceType === "one_time") &&
          (item.periodDate ?? item.dueDate ?? "").slice(0, 7) === budgetMonth,
      )
      .filter((item) => {
        if (item.paymentMethod !== "card" || !item.cardId || !item.dueDate) return true;
        const card = state.cards.find((candidate) => candidate.id === item.cardId);
        if (!card) return true;
        let cycle = currentOpenCycle(card, item.dueDate);
        if (isLikelyPendingNearStatement(item.dueDate, cycle)) {
          cycle = currentOpenCycle(card, addDays(fromISODate(cycle.cycleEnd), 1));
        }
        return cycle.cycleEnd <= range.end;
      });
    const summary = monthlyBudgetSummary(state, budgetMonth, representedCommittedItems);
    const monthEnd = endOfMonth(monthRef);
    const coveredDays =
      budgetMonth === rangeEndMonth
        ? Math.min(monthEnd.getDate(), fromISODate(range.end).getDate())
        : monthEnd.getDate();
    const coverageRatio =
      budgetMonth === rangeEndMonth && range.end < toISO(monthEnd)
        ? coveredDays / monthEnd.getDate()
        : 1;
    const reserveDate = budgetMonth === today.slice(0, 7) ? today : `${budgetMonth}-01`;

    return summary.categories
      .filter((category) => category.protectInSpendableToday)
      .map((category) => {
        const proratedLimit = category.limit * coverageRatio;
        const amount = Math.max(0, proratedLimit - category.spent - category.committed);
        return {
          id: `budget-reserve:${category.budget.id}:${budgetMonth}`,
          label: `${category.budget.category} budget reserve`,
          detail: `${formatMoney(
            amount,
            state.profile.currency,
          )} of unspent ${category.budget.category} budget protected for ${budgetMonth}`,
          amount,
          dueDate: reserveDate,
          periodDate: reserveDate,
          category: category.budget.category,
        } satisfies CashFlowBreakdownItem;
      })
      .filter((item) => item.amount > 0.005);
  });

  if (budgetReserveItems.length > 0) {
    directSections.push({
      title: "Protected category budgets",
      items: sortByDueDate(budgetReserveItems),
    });
  }
  return directSections;
}

export function expensesComingBreakdown(
  state: AppState,
  ref: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): CashFlowBreakdownSection[] {
  return expenseSectionsForRange(state, ref, cashFlowPeriodRange(period, ref, customRange));
}

export function expensesComingTotal(
  state: AppState,
  ref: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): number {
  return expensesComingBreakdown(state, ref, period, customRange).reduce(
    (sum, section) => sum + section.items.reduce((sectionSum, item) => sectionSum + item.amount, 0),
    0,
  );
}

function nextUnpaidIncomeDate(state: AppState, ref: Date = new Date()): string | null {
  const today = toISO(ref);
  const range = {
    start: today,
    end: toISO(new Date(ref.getFullYear(), ref.getMonth() + 6, ref.getDate())),
  };
  const entries = incomeItemsForRange(state, range)
    .map((entry) => entry.periodDate ?? entry.dueDate)
    .filter((date): date is string => !!date && date >= today)
    .sort((a, b) => a.localeCompare(b));
  return entries[0] ?? null;
}

function protectedExpenseSections(
  state: AppState,
  ref: Date = new Date(),
): { nextIncomeDate: string; sections: CashFlowBreakdownSection[]; total: number } {
  const today = toISO(ref);
  const nextIncomeDate = nextUnpaidIncomeDate(state, ref) ?? toISO(endOfMonth(ref));
  const sections = expenseSectionsForRange(state, ref, { start: today, end: nextIncomeDate })
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

export interface CashFlowTimelineEvent {
  id: string;
  label: string;
  detail: string;
  date: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  accountId?: string;
  incomeConfidence?: "confirmed" | "projected";
  sourceItem?: CashFlowBreakdownItem;
}

export interface AccountFundingWarning {
  accountId: string;
  accountName: string;
  date: string;
  balanceAfter: number;
  eventLabel: string;
}

export interface ForecastProjectionOptions {
  includeProjectedIncome?: boolean;
  variableExpenseMultiplier?: number;
  unexpectedExpenseAmount?: number;
  unexpectedExpenseDate?: string;
}

export interface ForecastCashProjection {
  range: ForecastDateRange;
  startingCash: number;
  endingBalance: number;
  lowestBalance: number;
  safeSurplus: number;
  events: CashFlowTimelineEvent[];
  projectedIncome: number;
  projectedPartTimeIncome: number;
  totalExpenses: number;
  runwayDate?: string;
  runwayDays?: number;
  accountFundingWarnings: AccountFundingWarning[];
}

function spendableTodayProjection(
  state: AppState,
  ref: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
  useFixedSafetyHorizon = true,
  options: ForecastProjectionOptions = {},
): ForecastCashProjection {
  const today = toISO(ref);
  const selectedRange = cashFlowPeriodRange(period, ref, customRange);
  const range = useFixedSafetyHorizon
    ? {
        start: today,
        end: toISO(addDays(ref, SPENDABLE_TODAY_HORIZON_DAYS)),
      }
    : {
        start: selectedRange.start < today ? today : selectedRange.start,
        end: selectedRange.end < today ? today : selectedRange.end,
      };
  const forecastIncomeEvents = incomeItemsForRange(state, range).map((item) => ({
    id: `income-${item.id}`,
    label: item.label,
    detail: item.detail ? `Income - ${item.detail}` : "Income",
    date: item.periodDate ?? item.payDate ?? today,
    amount: item.amount,
    accountId: item.accountId,
    incomeConfidence: item.incomeConfidence,
  }));
  const projectedPartTimeIncome = forecastIncomeEvents
    .filter((event) => event.incomeConfidence === "projected")
    .reduce((sum, event) => sum + event.amount, 0);
  const incomeEvents = forecastIncomeEvents.filter(
    (event) => options.includeProjectedIncome || event.incomeConfidence !== "projected",
  );
  const variableExpenseMultiplier = Math.max(0, options.variableExpenseMultiplier ?? 1);
  const expenseEvents = safetyExpenseSectionsForRange(state, ref, range).flatMap((section) =>
    section.items.map((item) => {
      const multiplier = item.sourceType === "one_time" ? variableExpenseMultiplier : 1;
      return {
        id: `expense-${section.title}-${item.id}`,
        label: item.label,
        detail: item.detail ? `${section.title} - ${item.detail}` : section.title,
        date: item.dueDate ?? item.periodDate ?? today,
        amount: -Math.round(item.amount * multiplier * 100) / 100,
        accountId: item.accountId,
        sourceItem: item,
      };
    }),
  );
  const unexpectedExpenseAmount = Math.max(0, options.unexpectedExpenseAmount ?? 0);
  const requestedUnexpectedDate = options.unexpectedExpenseDate ?? today;
  const unexpectedExpenseDate =
    requestedUnexpectedDate < range.start
      ? range.start
      : requestedUnexpectedDate > range.end
        ? range.end
        : requestedUnexpectedDate;
  const unexpectedEvents =
    unexpectedExpenseAmount > 0
      ? [
          {
            id: `expense-scenario-unexpected-${unexpectedExpenseDate}`,
            label: "Scenario expense",
            detail: "Temporary forecast assumption",
            date: unexpectedExpenseDate,
            amount: -unexpectedExpenseAmount,
            accountId: undefined,
            incomeConfidence: undefined,
            sourceItem: undefined,
          },
        ]
      : [];
  const orderedEvents = [...incomeEvents, ...expenseEvents, ...unexpectedEvents].sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    if (dateOrder !== 0) return dateOrder;
    return a.amount - b.amount;
  });

  const startingCash = spendableCash(state);
  let runningBalance = startingCash;
  let lowestBalance = startingCash;
  const accountBalances = new Map(
    state.accounts
      .filter(isSpendableAccount)
      .map((account) => [account.id, { account, balance: account.balance }]),
  );
  const accountFundingWarnings: AccountFundingWarning[] = [];
  const events = orderedEvents.map((event) => {
    const balanceBefore = runningBalance;
    runningBalance += event.amount;
    lowestBalance = Math.min(lowestBalance, runningBalance);
    if (event.accountId) {
      const accountBalance = accountBalances.get(event.accountId);
      if (accountBalance) {
        accountBalance.balance += event.amount;
        if (
          event.amount < 0 &&
          accountBalance.balance < 0 &&
          !accountFundingWarnings.some(
            (warning) => warning.accountId === event.accountId && warning.date === event.date,
          )
        ) {
          accountFundingWarnings.push({
            accountId: event.accountId,
            accountName: accountBalance.account.name,
            date: event.date,
            balanceAfter: accountBalance.balance,
            eventLabel: event.label,
          });
        }
      }
    }
    return { ...event, balanceBefore, balanceAfter: runningBalance };
  });
  const projectedIncome = incomeEvents.reduce((sum, event) => sum + event.amount, 0);
  const totalExpenses = events
    .filter((event) => event.amount < 0)
    .reduce((sum, event) => sum + Math.abs(event.amount), 0);
  const runwayEvent = events.find((event) => event.balanceAfter < state.profile.safeToSpendFloor);
  const runwayDays = runwayEvent
    ? Math.max(
        0,
        Math.ceil(
          (fromISODate(runwayEvent.date).getTime() - fromISODate(today).getTime()) / 86400000,
        ),
      )
    : undefined;

  return {
    range,
    startingCash,
    endingBalance: runningBalance,
    lowestBalance,
    safeSurplus: lowestBalance - state.profile.safeToSpendFloor,
    events,
    projectedIncome,
    projectedPartTimeIncome,
    totalExpenses,
    runwayDate: runwayEvent?.date,
    runwayDays,
    accountFundingWarnings,
  };
}

export function forecastCashProjection(
  state: AppState,
  ref: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
  options: ForecastProjectionOptions = {},
  useFixedSafetyHorizon = false,
): ForecastCashProjection {
  return spendableTodayProjection(state, ref, period, customRange, useFixedSafetyHorizon, options);
}

export function expenseAffordabilityById(
  state: AppState,
  ref: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): Record<string, CashFlowAffordability> {
  const projection = spendableTodayProjection(state, ref, period, customRange, false);
  const expenseEvents = projection.events.filter((event) => event.amount < 0);
  const affordability: Record<string, CashFlowAffordability> = {};

  expenseEvents.forEach((event) => {
    const eventIndex = projection.events.findIndex((candidate) => candidate.id === event.id);
    const recovery =
      event.balanceAfter < 0
        ? projection.events.slice(eventIndex + 1).find((candidate) => candidate.balanceAfter >= 0)
        : undefined;
    const itemId = event.sourceItem?.id ?? event.id;
    const itemAffordability: CashFlowAffordability = {
      itemId,
      eventId: event.id,
      label: event.label,
      date: event.date,
      amount: Math.abs(event.amount),
      balanceBefore: event.balanceBefore,
      balanceAfter: event.balanceAfter,
      affordable: event.balanceAfter >= 0,
      recoveryDate: recovery?.date,
      recoveryBalance: recovery?.balanceAfter,
    };

    affordability[itemId] = itemAffordability;
    affordability[event.id] = itemAffordability;
  });

  return affordability;
}

export function spendableToday(
  state: AppState,
  ref: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): number {
  return spendableTodayProjection(state, ref, period, customRange).safeSurplus;
}

export function spendableTodayBreakdown(
  state: AppState,
  ref: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): CashFlowBreakdownSection[] {
  const projection = spendableTodayProjection(state, ref, period, customRange);
  const pressureEvents = projection.events
    .filter((event) => event.balanceAfter <= projection.lowestBalance + 0.001)
    .slice(0, 5);
  const cardEvents = projection.events
    .filter((event) => event.detail.startsWith("Upcoming card bills"))
    .slice(0, 12);
  const budgetEvents = projection.events
    .filter((event) => event.detail.startsWith("Protected category budgets"))
    .slice(0, 20);
  const upcomingEvents = projection.events;

  const sections: CashFlowBreakdownSection[] = [
    {
      title: "Safe surplus formula",
      items: [
        {
          id: "spendable-today-have-now",
          label: "Have now",
          detail: "Current spendable cash",
          amount: projection.startingCash,
        },
        {
          id: "spendable-today-lowest-balance",
          label: "Lowest projected cash",
          detail: `Lowest balance through ${formatDisplayDate(projection.range.end)}`,
          amount: projection.lowestBalance,
        },
        {
          id: "spendable-today-floor",
          label: "Safe-to-spend floor",
          detail: "Cash buffer kept aside",
          amount: -state.profile.safeToSpendFloor,
        },
      ],
    },
  ];

  if (pressureEvents.length > 0) {
    sections.push({
      title: "Lowest point",
      items: pressureEvents.map((event) => ({
        id: `pressure-${event.id}`,
        label: event.label,
        detail: `${formatDisplayDate(event.date)} - projected balance ${formatMoney(
          event.balanceAfter,
          state.profile.currency,
        )}`,
        amount: event.amount,
      })),
    });
  }

  if (cardEvents.length > 0) {
    sections.push({
      title: "Card payments protected",
      items: cardEvents.map((event) => {
        const sourceItem = event.sourceItem;
        return {
          id: sourceItem?.id ?? `card-${event.id}`,
          label: event.label,
          detail: `${formatDisplayDate(event.date)} - balance after ${formatMoney(
            event.balanceAfter,
            state.profile.currency,
          )}`,
          amount: event.amount,
          sourceType: sourceItem?.sourceType,
          sourceId: sourceItem?.sourceId,
          overrideId: sourceItem?.overrideId,
          dueDate: sourceItem?.dueDate ?? event.date,
          periodDate: sourceItem?.periodDate ?? event.date,
          cycleStart: sourceItem?.cycleStart,
          cycleEnd: sourceItem?.cycleEnd,
        };
      }),
    });
  }

  if (budgetEvents.length > 0) {
    sections.push({
      title: "Category budgets protected",
      items: budgetEvents.map((event) => ({
        id: event.sourceItem?.id ?? event.id,
        label: event.label,
        detail: `${formatDisplayDate(event.date)} - balance after ${formatMoney(
          event.balanceAfter,
          state.profile.currency,
        )}`,
        amount: event.amount,
      })),
    });
  }

  if (upcomingEvents.length > 0) {
    sections.push({
      title: "Timeline used",
      items: upcomingEvents.map((event) => ({
        id: event.id,
        label: event.label,
        detail: `${formatDisplayDate(event.date)} - ${event.detail} - balance after ${formatMoney(
          event.balanceAfter,
          state.profile.currency,
        )}`,
        amount: event.amount,
      })),
    });
  }

  sections.push({
    title: "Forecast assumptions",
    items: [
      {
        id: "spendable-today-protection-window",
        label: "Protection window",
        detail: `${SPENDABLE_TODAY_HORIZON_DAYS} days through ${formatDisplayDate(
          projection.range.end,
        )}. Dashboard filters do not change this safety window.`,
        amount: 0,
      },
      {
        id: "spendable-today-forecast-income",
        label: "Income included",
        detail:
          projection.projectedPartTimeIncome > 0
            ? `${formatMoney(
                projection.projectedPartTimeIncome,
                state.profile.currency,
              )} of auto-planned part-time income is excluded until the work is entered.`
            : "Only scheduled salary and entered work are counted as protected income.",
        amount: projection.projectedIncome,
      },
    ],
  });

  if (projection.accountFundingWarnings.length > 0) {
    sections.push({
      title: "Account funding warnings",
      items: projection.accountFundingWarnings.map((warning) => ({
        id: `account-warning-${warning.accountId}-${warning.date}`,
        label: warning.accountName,
        detail: `${warning.eventLabel} on ${formatDisplayDate(
          warning.date,
        )} would leave this account short. Move money before this payment.`,
        amount: warning.balanceAfter,
      })),
    });
  }

  return sections;
}

export function leftToSpendBreakdown(
  state: AppState,
  monthDate: Date = new Date(),
  period: CashFlowPeriod = "this_month",
  customRange?: ForecastDateRange,
): CashFlowBreakdownSection[] {
  const haveNow = spendableCash(state);
  const incomeComing = pendingIncome(state, monthDate, period, customRange);
  const expensesComing = expensesComingTotal(state, monthDate, period, customRange);

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
