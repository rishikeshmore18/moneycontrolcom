import { addDays, fromISODate, toISODate } from "./dates";

export const FRIEND_EXPENSE_CATEGORY = "Gave to friend";

export function isFriendExpenseCategory(category: string): boolean {
  return /^gave to (a )?friends?$/i.test(category.trim());
}

export function validISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = fromISODate(value);
  return !Number.isNaN(date.getTime()) && toISODate(date) === value;
}

export function friendReturnDate(
  expenseDate: string,
  choice: { mode: "date"; date: string } | { mode: "days"; days: number },
): string | null {
  if (!validISODate(expenseDate)) return null;
  if (choice.mode === "date") {
    return validISODate(choice.date) && choice.date >= expenseDate ? choice.date : null;
  }
  if (!Number.isInteger(choice.days) || choice.days < 1 || choice.days > 3650) return null;
  return toISODate(addDays(fromISODate(expenseDate), choice.days));
}
