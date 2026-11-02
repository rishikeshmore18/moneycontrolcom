import { addDays, fromISODate, toISODate } from "./dates";
import { expensesComingBreakdown, pendingIncomeBreakdown, type CashFlowBreakdownItem } from "./forecast";
import { validISODate } from "./friendRepayment";
import type { AppState, Transaction } from "./types";

function nameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Combined plans consume the payment once; duplicate plans describe the same payment. */
export function validAssignmentSelection(
  amount: number,
  items: Pick<CashFlowBreakdownItem, "id" | "label" | "amount">[],
  mode: "combined" | "duplicates",
): boolean {
  if (!Number.isFinite(amount) || amount <= 0 || !items.length ||
      new Set(items.map((item) => item.id)).size !== items.length ||
      items.some((item) => !Number.isFinite(item.amount) || item.amount <= 0)) return false;
  if (items.length === 1) return true; // The actual price can differ from the estimate.
  const cents = Math.round(amount * 100);
  if (mode === "combined")
    return items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) <= cents;
  return items.every((item) =>
    nameKey(item.label) === nameKey(items[0].label) && Math.round(item.amount * 100) === cents);
}

function score(item: CashFlowBreakdownItem, tx: Transaction): number {
  const expected = nameKey(item.label);
  const actual = nameKey(tx.description);
  const nameMatch = expected && actual && (expected === actual || expected.includes(actual) || actual.includes(expected));
  const sameSource = tx.type === "income"
    ? item.accountId === tx.targetAccountId
    : item.paymentMethod === "card" ? item.cardId === tx.cardId : item.accountId === tx.sourceAccountId;
  const date = item.dueDate ?? item.payDate ?? item.periodDate ?? tx.date;
  const days = Math.abs(fromISODate(date).getTime() - fromISODate(tx.date).getTime()) / 86_400_000;
  return (nameMatch ? 100 : 0) + (sameSource ? 20 : 0) +
    (Math.round(item.amount * 100) === Math.round(tx.amount * 100) ? 10 : 0) - days;
}

function nearestFirst(items: CashFlowBreakdownItem[], tx: Transaction): CashFlowBreakdownItem[] {
  return items.sort((a, b) => score(b, tx) - score(a, tx) ||
    (a.dueDate ?? a.payDate ?? "").localeCompare(b.dueDate ?? b.payDate ?? ""));
}

/** Paid plans remain selectable for later installments and corrections.
 * These rows are read from existing assignment links; no new planned income or expense is created.
 */
function historicalMatches(state: AppState, tx: Transaction): CashFlowBreakdownItem[] {
  const seen = new Map<string, CashFlowBreakdownItem & { count: number; actual: number }>();
  for (const owner of state.transactions) {
    if (owner.id === tx.id || owner.type !== tx.type) continue;
    const links = tx.type === "expense"
      ? [owner.linkedPlannedExpense, ...(owner.linkedPlannedExpenses ?? [])].filter(Boolean)
      : [owner.linkedPlannedIncome, ...(owner.linkedPlannedIncomes ?? [])].filter(Boolean);
    const keys = new Set<string>();
    for (const link of links) {
      if (!link) continue;
      const id = "itemId" in link ? link.itemId : link.sourceType === "one_time"
        ? link.originalOverride?.id : `${link.sourceId}:${link.month}`;
      if (!id || keys.has(id)) continue;
      keys.add(id);
      const existing = seen.get(id);
      if (existing) {
        existing.actual += owner.amount;
        existing.count += 1;
        continue;
      }
      const expense = "month" in link;
      const source = expense
        ? state.recurringBills.find((bill) => bill.id === link.sourceId)
        : undefined;
      const expected = expense
        ? link.originalOverride?.amount ?? ("matchedRecurringAmount" in link ? link.matchedRecurringAmount : undefined)
          ?? source?.amount ?? owner.amount
        : link.originalOverride?.amount ??
          (link.originalEntries?.reduce((sum, entry) => sum + entry.expectedAmount, 0) || owner.amount);
      const date = expense
        ? link.originalOverride?.dueDate ?? owner.date
        : link.originalOverride?.payDate ?? owner.date;
      seen.set(id, {
        id, label: link.label, amount: expected, detail: "", historicalMatch: true,
        ...(expense ? { sourceType: link.sourceType, sourceId: link.sourceId, dueDate: date,
          overrideId: link.sourceType === "one_time" ? id : undefined }
        : { incomeSourceType: link.originalOverride ? "one_time" as const : "salary_paycheck" as const,
          payDate: date }),
        count: 1, actual: owner.amount,
      });
    }
  }
  return [...seen.values()].map(({ count, actual, ...item }) => ({
    ...item,
    detail: `Previously assigned to ${count} transaction${count === 1 ? "" : "s"} totaling ${actual.toFixed(2)}. Add another payment or deposit without counting money twice.`,
  }));
}

/** Explicit assignment allows a changed price or payment source; it never chooses a match for the user. */
export function assignablePlannedExpenses(state: AppState, tx: Transaction): CashFlowBreakdownItem[] {
  if (tx.type !== "expense" || tx.linkedPlannedExpense || !validISODate(tx.date)) return [];
  const reference = fromISODate(tx.date);
  const range = { start: toISODate(addDays(reference, -31)), end: toISODate(addDays(reference, 45)) };
  const upcoming = expensesComingBreakdown(state, reference, "custom", range)
    .flatMap((section) => section.items)
    .filter((item) => (item.sourceType === "one_time" || item.sourceType === "recurring_bill") &&
      !!item.dueDate && item.dueDate >= range.start && item.dueDate <= range.end);
  const ids = new Set(upcoming.map((item) => item.id));
  return nearestFirst([...upcoming, ...historicalMatches(state, tx).filter((item) => !ids.has(item.id))], tx);
}

export function assignablePlannedIncome(state: AppState, tx: Transaction): CashFlowBreakdownItem[] {
  if (tx.type !== "income" || tx.linkedPlannedIncome || !validISODate(tx.date)) return [];
  const reference = fromISODate(tx.date);
  const range = { start: toISODate(addDays(reference, -31)), end: toISODate(addDays(reference, 31)) };
  const upcoming = pendingIncomeBreakdown(state, reference, "custom", range)
    .flatMap((section) => section.items)
    .filter((item) => !!item.payDate && item.payDate >= range.start && item.payDate <= range.end);
  const ids = new Set(upcoming.map((item) => item.id));
  return nearestFirst([...upcoming, ...historicalMatches(state, tx).filter((item) => !ids.has(item.id))], tx);
}
