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
  accountId?: string;
  category?: string;
  cycleStart?: string;
  cycleEnd?: string;
  periodDate?: string;
  pendingAmount?: number;
  jobId?: string;
  payDate?: string;
  incomeSourceType?: "salary_paycheck" | "work_paycheck";
  incomeEntryIds?: string[];
  incomeEntries?: TimesheetEntry[];
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
    const accountId = override?.accountId ?? bill.accountId;
    const account = state.accounts.find((item) => item.id === accountId);
    const baseDueDate = recurringBillDueDate(bill, ref);
    const dueDay = override?.dueDay ?? Number(baseDueDate.slice(8, 10));
    const dueDate =
      override?.dueDate ?? (override?.dueDay ? dateForMonthDay(ref, dueDay) : baseDueDate);
    return [
      {
        id: `${bill.id}:${monthKey(ref)}`,
        label: override?.name ?? bill.name,
        detail: account
          ? `Due ${formatDisplayDate(dueDate)} - ${account.name}`
          : `Due ${formatDisplayDate(dueDate)}`,
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
        detail: account
          ? `Due ${formatDisplayDate(dueDate)} - ${account.name}`
          : `Due ${formatDisplayDate(dueDate)}`,
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

function clampEventDate(date: string, range: ForecastDateRange): string {
  return date < range.start ? range.start : date;
}

function cardCashFlowItemsForRange(
  state: AppState,
  ref: Date,
  range: ForecastDateRange,
): CashFlowBreakdownItem[] {
  const today = toISO(ref);
  const items: CashFlowBreakdownItem[] = [];

  state.cards.forEach((card) => {
    if (card.currentBalance <= 0) return;

    if (!isZeroAprCard(card)) {
      const dueCycle = cycleForDate(card, ref);
      const fallbackCycle = currentOpenCycle(card, ref);
      const rawDueDate =
        dueCycle.dueDate >= today
          ? dueCycle.dueDate
          : fallbackCycle.dueDate >= today
            ? fallbackCycle.dueDate
            : today;
      const dueDate = clampEventDate(rawDueDate, range);
      if (!eventDateInRange(dueDate, range)) return;
      items.push({
        id: `${card.id}:cash-payoff`,
        label: card.name,
        detail: `Card balance planned for payment by ${formatDisplayDate(dueDate)}`,
        amount: card.currentBalance,
        sourceType: "card_due",
        sourceId: card.id,
        dueDate,
        periodDate: dueDate,
      });
      return;
    }

    let remainingBalance = card.currentBalance;
    let cycle = currentOpenCycle(card, ref);
    const currentTargetPaydown = paydownToTarget(card);

    if (card.zeroAprEndDate && cycle.cycleEnd >= card.zeroAprEndDate) {
      const dueDate = clampEventDate(cycle.cycleEnd, range);
      if (eventDateInRange(dueDate, range)) {
        items.push({
          id: `${card.id}:promo-payoff:${cycle.cycleEnd}`,
          label: card.name,
          detail: `0% APR payoff before statement closes ${formatDisplayDate(cycle.cycleEnd)}`,
          amount: remainingBalance,
          sourceType: "card_due",
          sourceId: card.id,
          dueDate,
          cycleStart: cycle.cycleStart,
          cycleEnd: cycle.cycleEnd,
          periodDate: dueDate,
        });
      }
      return;
    }

    if (currentTargetPaydown > 0) {
      const dueDate = clampEventDate(cycle.cycleEnd, range);
      if (eventDateInRange(dueDate, range)) {
        items.push({
          id: `${card.id}:target-paydown:${cycle.cycleEnd}`,
          label: card.name,
          detail: `Pay down to ${card.targetUtilizationPercent}% before statement closes ${formatDisplayDate(cycle.cycleEnd)}`,
          amount: currentTargetPaydown,
          sourceType: "card_due",
          sourceId: card.id,
          dueDate,
          cycleStart: cycle.cycleStart,
          cycleEnd: cycle.cycleEnd,
          periodDate: dueDate,
        });
      }
      remainingBalance = Math.max(0, remainingBalance - currentTargetPaydown);
    }

    for (let guard = 0; guard < 12 && remainingBalance > 0; guard += 1) {
      const promoEndsThisCycle = !!card.zeroAprEndDate && cycle.cycleEnd >= card.zeroAprEndDate;
      const amount = promoEndsThisCycle
        ? remainingBalance
        : Math.min(card.minimumDue, remainingBalance);
      const rawDueDate = promoEndsThisCycle ? cycle.cycleEnd : cycle.dueDate;
      const dueDate = clampEventDate(rawDueDate, range);

      if (amount > 0 && eventDateInRange(dueDate, range)) {
        items.push({
          id: `${card.id}:${promoEndsThisCycle ? "promo-payoff" : "minimum-due"}:${cycle.cycleEnd}`,
          label: promoEndsThisCycle ? card.name : `${card.name} minimum`,
          detail: promoEndsThisCycle
            ? `0% APR payoff before statement closes ${formatDisplayDate(cycle.cycleEnd)}`
            : `Estimated minimum due ${formatDisplayDate(cycle.dueDate)} after statement closes ${formatDisplayDate(cycle.cycleEnd)}`,
          amount,
          sourceType: "card_due",
          sourceId: card.id,
          dueDate,
          cycleStart: cycle.cycleStart,
          cycleEnd: cycle.cycleEnd,
          periodDate: dueDate,
        });
      }

      remainingBalance = Math.max(0, remainingBalance - amount);
      if (promoEndsThisCycle || cycle.cycleEnd > range.end) break;
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
          id: `${debt.id}:${monthKey(ref)}`,
          label: override?.name ?? debt.name,
          detail: `Due ${formatDisplayDate(dueDate)}`,
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

  return sortByDueDate(items);
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
  const monthRefs = monthRefsForRange(range);
  const billItems = sortByDueDate(
    monthRefs
      .flatMap((monthRef) => billExpenseItems(state, monthRef))
      .filter((item) => itemInRange(item, range)),
  );
  const recurringBillItems = billItems.filter((item) => item.sourceType === "recurring_bill");
  const oneTimeItems = billItems.filter((item) => item.sourceType === "one_time");
  const cardItems = sortByDueDate(
    cardDueItems(state, ref).filter((item) => itemInRange(item, range)),
  );
  const debtItems = sortByDueDate(
    monthRefs
      .flatMap((monthRef) => debtPlanItems(state, monthRef))
      .filter((item) => itemInRange(item, range)),
  );
  const sections: CashFlowBreakdownSection[] = [];
  if (recurringBillItems.length > 0) sections.push({ title: "Bills", items: recurringBillItems });
  if (oneTimeItems.length > 0)
    sections.push({ title: "One-time planned expenses", items: oneTimeItems });
  if (cardItems.length > 0) sections.push({ title: "Upcoming card bills", items: cardItems });
  if (debtItems.length > 0) sections.push({ title: "Debt plan", items: debtItems });
  return sections;
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

interface CashFlowTimelineEvent {
  id: string;
  label: string;
  detail: string;
  date: string;
  amount: number;
  balanceAfter: number;
}

function spendableTodayProjection(
  state: AppState,
  ref: Date = new Date(),
): {
  range: ForecastDateRange;
  startingCash: number;
  lowestBalance: number;
  safeSurplus: number;
  events: CashFlowTimelineEvent[];
} {
  const today = toISO(ref);
  const range = {
    start: today,
    end: toISO(new Date(ref.getFullYear(), ref.getMonth() + 6, ref.getDate())),
  };
  const incomeEvents = incomeItemsForRange(state, range).map((item) => ({
    id: `income-${item.id}`,
    label: item.label,
    detail: item.detail ? `Income - ${item.detail}` : "Income",
    date: item.periodDate ?? item.payDate ?? today,
    amount: item.amount,
  }));
  const expenseEvents = [
    ...expenseSectionsForRange(state, ref, range)
      .filter((section) => section.title !== "Upcoming card bills")
      .flatMap((section) =>
        section.items.map((item) => ({
          id: `expense-${section.title}-${item.id}`,
          label: item.label,
          detail: item.detail ? `${section.title} - ${item.detail}` : section.title,
          date: item.dueDate ?? item.periodDate ?? today,
          amount: -item.amount,
        })),
      ),
    ...cardCashFlowItemsForRange(state, ref, range).map((item) => ({
      id: `expense-Upcoming card bills-${item.id}`,
      label: item.label,
      detail: item.detail ? `Upcoming card bills - ${item.detail}` : "Upcoming card bills",
      date: item.dueDate ?? item.periodDate ?? today,
      amount: -item.amount,
    })),
  ];
  const orderedEvents = [...incomeEvents, ...expenseEvents].sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    if (dateOrder !== 0) return dateOrder;
    return a.amount - b.amount;
  });

  const startingCash = spendableCash(state);
  let runningBalance = startingCash;
  let lowestBalance = startingCash;
  const events = orderedEvents.map((event) => {
    runningBalance += event.amount;
    lowestBalance = Math.min(lowestBalance, runningBalance);
    return { ...event, balanceAfter: runningBalance };
  });

  return {
    range,
    startingCash,
    lowestBalance,
    safeSurplus: lowestBalance - state.profile.safeToSpendFloor,
    events,
  };
}

export function spendableToday(state: AppState, ref: Date = new Date()): number {
  return spendableTodayProjection(state, ref).safeSurplus;
}

export function spendableTodayBreakdown(
  state: AppState,
  ref: Date = new Date(),
): CashFlowBreakdownSection[] {
  const projection = spendableTodayProjection(state, ref);
  const pressureEvents = projection.events
    .filter((event) => event.balanceAfter <= projection.lowestBalance + 0.001)
    .slice(0, 5);
  const cardEvents = projection.events
    .filter((event) => event.detail.startsWith("Upcoming card bills"))
    .slice(0, 8);
  const upcomingEvents = projection.events.slice(0, 15);

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
      items: cardEvents.map((event) => ({
        id: `card-${event.id}`,
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
