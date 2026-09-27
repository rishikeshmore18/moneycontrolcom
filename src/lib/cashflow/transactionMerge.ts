import type { Transaction } from "./types";
import { isFriendExpenseCategory } from "./friendRepayment";

/** A merge removes a duplicate; it never adds the two amounts together. */
export function canMergeExpenses(source: Transaction, target: Transaction): boolean {
  if (source.id === target.id || source.type !== "expense" || target.type !== "expense")
    return false;
  if (source.reconciledByPaymentId || target.reconciledByPaymentId) return false;
  if (isFriendExpenseCategory(source.category) !== isFriendExpenseCategory(target.category))
    return false;
  if (
    !Number.isFinite(source.amount) ||
    source.amount <= 0 ||
    Math.abs(source.amount - target.amount) > 0.005
  )
    return false;
  if (!source.cardId && !source.sourceAccountId) return false;
  if (source.cardId !== target.cardId || source.sourceAccountId !== target.sourceAccountId)
    return false;
  const sourceDay = Date.parse(`${source.date}T00:00:00Z`);
  const targetDay = Date.parse(`${target.date}T00:00:00Z`);
  return (
    Number.isFinite(sourceDay) &&
    Number.isFinite(targetDay) &&
    Math.abs(sourceDay - targetDay) <= 4 * 86_400_000
  );
}
