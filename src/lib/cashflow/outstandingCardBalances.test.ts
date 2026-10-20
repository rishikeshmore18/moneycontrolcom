import { describe, expect, it } from "vitest";
import { expensesComingBreakdown, expensesComingTotal } from "./forecast";
import { type AppState, type Card, emptyState } from "./types";

const REF = new Date(2026, 9, 20);

function card(id: string, balance: number, statementBalance = 0): Card {
  return {
    id,
    name: id,
    type: "regular",
    limit: 5_000,
    currentBalance: balance,
    statementBalance,
    minimumDue: 25,
    billingDate: 5,
    dueDate: 28,
    apr: 22,
    targetUtilizationPercent: 30,
    preferredCategories: [],
  };
}

describe("Outstanding card balance reminders", () => {
  it("shows unpaid balances outside this month's due items without counting them as expenses", () => {
    const state: AppState = {
      ...emptyState,
      cards: [card("Amex", 47.45), card("Discover", 65), card("Paid off", 0)],
    };
    const sections = expensesComingBreakdown(state, REF, "this_month");
    const reminders = sections.find((section) => section.title === "Other unpaid card balances");

    expect(reminders?.items.map((item) => item.label).sort()).toEqual(["Amex", "Discover"]);
    expect(reminders?.items.every((item) => item.balanceReminder && item.sourceType === "card_due"))
      .toBe(true);
    expect(expensesComingTotal(state, REF, "this_month")).toBe(0);
  });

  it("does not duplicate a card with a payment already scheduled in this period", () => {
    const scheduled = card("Statement due", 100, 100);
    const notYetDue = card("Not yet due", 47.45);
    const state: AppState = {
      ...emptyState,
      cards: [scheduled, notYetDue],
    };
    const sections = expensesComingBreakdown(state, REF, "this_month");
    const scheduledItems = sections.flatMap((section) => section.items)
      .filter((item) => item.sourceType === "card_due" && !item.balanceReminder);
    const reminders = sections.find((section) => section.title === "Other unpaid card balances");

    expect(scheduledItems.some((item) => item.sourceId === scheduled.id)).toBe(true);
    expect(reminders?.items.map((item) => item.sourceId)).toEqual([notYetDue.id]);
    expect(expensesComingTotal(state, REF, "this_month")).toBe(
      scheduledItems.reduce((sum, item) => sum + item.amount, 0),
    );
  });

  it("removes the reminder once the bank-linked card balance reaches zero", () => {
    const state: AppState = { ...emptyState, cards: [card("Discover", 65)] };
    expect(expensesComingBreakdown(state, REF, "this_month")
      .some((section) => section.title === "Other unpaid card balances")).toBe(true);

    const synced: AppState = {
      ...state,
      cards: [{ ...state.cards[0], currentBalance: 0, bankLinked: true }],
    };
    expect(expensesComingBreakdown(synced, REF, "this_month")
      .some((section) => section.title === "Other unpaid card balances")).toBe(false);
  });
});
