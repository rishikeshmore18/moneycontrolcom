import type { AppState } from "./types";
import { cycleForDate } from "./cardLogic";
import { addDays, fromISODate, toISODate } from "./dates";
import { expensesComingBreakdown, type CashFlowBreakdownItem } from "./forecast";

export interface ReviewExpense {
  name: string;
  amount: number;
  date: string;
  accountId?: string;
  cardId?: string;
}

function normalizedName(name: string): string {
  return name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Only suggest the same month's unpaid bill, never match a card payment or debt plan as a purchase. */
export function matchingPlannedExpenses(
  state: AppState,
  expense: ReviewExpense,
): CashFlowBreakdownItem[] {
  if (!expense.name.trim() || expense.amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(expense.date)) return [];
  const reference = fromISODate(expense.date);
  if (Number.isNaN(reference.getTime())) return [];
  const name = normalizedName(expense.name);
  const amountCents = Math.round(expense.amount * 100);
  return expensesComingBreakdown(state, reference, "this_month")
    .flatMap((section) => section.items)
    .filter((item) => {
      if (item.sourceType !== "recurring_bill" && item.sourceType !== "one_time") return false;
      if (normalizedName(item.label) !== name || Math.round(item.amount * 100) !== amountCents) return false;
      if (!item.dueDate) return false;
      const daysApart = Math.abs(fromISODate(item.dueDate).getTime() - reference.getTime()) / 86_400_000;
      if (daysApart > 10) return false;
      if (item.paymentMethod === "card") {
        return !!expense.cardId && (!item.cardId || item.cardId === expense.cardId);
      }
      return !!expense.accountId && (!item.accountId || item.accountId === expense.accountId);
    });
}

export interface CardPaymentReminder {
  cardId: string;
  cardName: string;
  amount: number;
  dueDate: string;
  daysUntilDue: number;
}

/** Due-date reminders use the statement cycle, not the date a future statement will close. */
export function imminentCardPayments(state: AppState, reference = new Date()): CardPaymentReminder[] {
  const today = toISODate(reference);
  const lastDay = toISODate(addDays(fromISODate(today), 2));
  return state.cards.flatMap((card) => {
    const cycle = cycleForDate(card, today);
    if (cycle.dueDate < today || cycle.dueDate > lastDay) return [];
    const amount = Math.min(card.currentBalance, card.statementBalance || card.minimumDue);
    if (amount <= 0) return [];
    return [{
      cardId: card.id,
      cardName: card.name,
      amount,
      dueDate: cycle.dueDate,
      daysUntilDue: Math.round((fromISODate(cycle.dueDate).getTime() - fromISODate(today).getTime()) / 86_400_000),
    }];
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.cardName.localeCompare(b.cardName));
}
