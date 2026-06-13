import { AppState, Card, Transaction } from "./types";
import { fromISODate, toISODate } from "./dates";

export function utilization(card: Card): number {
  if (card.limit <= 0) return 0;
  return Math.min(1, card.currentBalance / card.limit);
}

export function availableCredit(card: Card): number {
  return Math.max(0, card.limit - card.currentBalance);
}

export function recommendCardForCategory(
  state: AppState,
  category: string,
  amount: number,
): { card: Card; reason: string } | null {
  const eligible = state.cards.filter((c) => availableCredit(c) >= amount);
  if (eligible.length === 0) return null;
  const preferred = eligible.find(
    (c) =>
      c.preferredCategories.includes(category) && utilization(c) * 100 < c.targetUtilizationPercent,
  );
  if (preferred)
    return { card: preferred, reason: "Best category match, under target utilization" };
  const underTarget = eligible.find((c) => utilization(c) * 100 < c.targetUtilizationPercent);
  if (underTarget) return { card: underTarget, reason: "Under target utilization" };
  const best = [...eligible].sort((a, b) => utilization(a) - utilization(b))[0];
  return { card: best, reason: "Lowest current utilization" };
}

export function paymentOptions(card: Card) {
  const target = (card.targetUtilizationPercent / 100) * card.limit;
  const aboveTarget = Math.max(0, card.currentBalance - target);
  return {
    minimum: Math.min(card.minimumDue, card.currentBalance),
    statement: Math.min(card.statementBalance, card.currentBalance),
    current: card.currentBalance,
    toTarget: aboveTarget,
  };
}

/* ───────────────────────── Billing cycles ───────────────────────── */

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function clampDay(day: number, y: number, m: number): number {
  const d = Math.max(1, Math.min(31, day || 1));
  return Math.min(d, lastDayOfMonth(y, m));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function statementOnOrBefore(card: Card, ref: Date): Date {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const thisMonthStmt = new Date(y, m, clampDay(card.billingDate, y, m));
  if (thisMonthStmt.getTime() <= ref.getTime()) return thisMonthStmt;
  return new Date(y, m - 1, clampDay(card.billingDate, y, m - 1));
}

function statementOnOrAfter(card: Card, ref: Date): Date {
  const refDay = startOfDay(ref);
  const y = refDay.getFullYear();
  const m = refDay.getMonth();
  const thisMonthStmt = new Date(y, m, clampDay(card.billingDate, y, m));
  if (thisMonthStmt.getTime() >= refDay.getTime()) return thisMonthStmt;
  return new Date(y, m + 1, clampDay(card.billingDate, y, m + 1));
}

export interface BillingCycle {
  cycleStart: string; // exclusive of prev statement; the day after
  cycleEnd: string; // inclusive — statement / generation date
  dueDate: string; // payment due date
}

/**
 * The cycle whose statement closes on/before `ref` — i.e. the cycle a
 * payment recorded on `ref` would normally settle.
 */
export function cycleForDate(card: Card, ref: Date | string): BillingCycle {
  const refDate = typeof ref === "string" ? fromISODate(ref) : ref;
  const stmt = statementOnOrBefore(card, refDate);
  const prevStmt = new Date(
    stmt.getFullYear(),
    stmt.getMonth() - 1,
    clampDay(card.billingDate, stmt.getFullYear(), stmt.getMonth() - 1),
  );
  const cycleStart = new Date(prevStmt);
  cycleStart.setDate(cycleStart.getDate() + 1);
  // Due date falls in the month after the statement closes.
  const dueY = stmt.getFullYear();
  const dueM = stmt.getMonth() + 1;
  const due = new Date(dueY, dueM, clampDay(card.dueDate, dueY, dueM));
  return {
    cycleStart: toISODate(cycleStart),
    cycleEnd: toISODate(stmt),
    dueDate: toISODate(due),
  };
}

export function currentOpenCycle(card: Card, ref: Date | string = new Date()): BillingCycle {
  const refDate = typeof ref === "string" ? fromISODate(ref) : ref;
  const stmt = statementOnOrAfter(card, refDate);
  const prevStmt = new Date(
    stmt.getFullYear(),
    stmt.getMonth() - 1,
    clampDay(card.billingDate, stmt.getFullYear(), stmt.getMonth() - 1),
  );
  const cycleStart = new Date(prevStmt);
  cycleStart.setDate(cycleStart.getDate() + 1);
  const dueY = stmt.getFullYear();
  const dueM = stmt.getMonth() + 1;
  const due = new Date(dueY, dueM, clampDay(card.dueDate, dueY, dueM));
  return {
    cycleStart: toISODate(cycleStart),
    cycleEnd: toISODate(stmt),
    dueDate: toISODate(due),
  };
}

export function expensesInCycle(
  txs: Transaction[],
  cardId: string,
  cycle: BillingCycle,
  includeReconciled = false,
): Transaction[] {
  return txs.filter(
    (t) =>
      t.type === "expense" &&
      t.cardId === cardId &&
      t.date >= cycle.cycleStart &&
      t.date <= cycle.cycleEnd &&
      (includeReconciled || !t.reconciledByPaymentId),
  );
}

export function isLikelyPendingNearStatement(
  transactionDate: string,
  cycle: BillingCycle,
  pendingWindowDays = 2,
): boolean {
  const txDate = fromISODate(transactionDate);
  const statementDate = fromISODate(cycle.cycleEnd);
  const daysUntilStatement = Math.round(
    (statementDate.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  return daysUntilStatement >= 0 && daysUntilStatement <= pendingWindowDays;
}

/** Unreconciled charges that landed in the cycle a payment on `paymentDate` would settle. */
export function unpaidCycleTotal(
  txs: Transaction[],
  card: Card,
  paymentDate: string | Date = new Date(),
): number {
  const cycle = cycleForDate(card, paymentDate);
  return expensesInCycle(txs, card.id, cycle).reduce((s, t) => s + t.amount, 0);
}
