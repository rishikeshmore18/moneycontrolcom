import { addDays, fromISODate, toISODate } from "./dates";
import { expensesComingBreakdown, pendingIncomeBreakdown, type CashFlowBreakdownItem } from "./forecast";
import { validISODate } from "./friendRepayment";
import type { AppState, Transaction } from "./types";

function nameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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

/** Explicit assignment allows a changed price or payment source; it never chooses a match for the user. */
export function assignablePlannedExpenses(state: AppState, tx: Transaction): CashFlowBreakdownItem[] {
  if (tx.type !== "expense" || tx.linkedPlannedExpense || !validISODate(tx.date)) return [];
  const reference = fromISODate(tx.date);
  const range = { start: toISODate(addDays(reference, -31)), end: toISODate(addDays(reference, 45)) };
  return nearestFirst(expensesComingBreakdown(state, reference, "custom", range)
    .flatMap((section) => section.items)
    .filter((item) => (item.sourceType === "one_time" || item.sourceType === "recurring_bill") &&
      !!item.dueDate && item.dueDate >= range.start && item.dueDate <= range.end), tx);
}

export function assignablePlannedIncome(state: AppState, tx: Transaction): CashFlowBreakdownItem[] {
  if (tx.type !== "income" || tx.linkedPlannedIncome || !validISODate(tx.date)) return [];
  const reference = fromISODate(tx.date);
  const range = { start: toISODate(addDays(reference, -31)), end: toISODate(addDays(reference, 31)) };
  return nearestFirst(pendingIncomeBreakdown(state, reference, "custom", range)
    .flatMap((section) => section.items)
    .filter((item) => !!item.payDate && item.payDate >= range.start && item.payDate <= range.end), tx);
}
