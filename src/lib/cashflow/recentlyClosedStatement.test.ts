import { describe, expect, it } from "vitest";
import { expensesComingBreakdown, expensesComingTotal } from "./forecast";
import { emptyState, type Card, type AppState } from "./types";

const ref = new Date(2026, 9, 20);
function card(balance: number, statementBalance = 0): Card {
  return {
    id: "amex", name: "Amex", type: "regular", limit: 8000,
    currentBalance: balance, statementBalance, minimumDue: 0,
    billingDate: 18, dueDate: 15, apr: 22, targetUtilizationPercent: 30,
    preferredCategories: [],
  };
}
describe("Recently closed card cycle", () => {
  it("lists a closed October 18 statement in upcoming bills on October 20 even when statement details are missing", () => {
    const state: AppState = { ...emptyState, cards: [card(47.45)] };
    const sections = expensesComingBreakdown(state, ref, "this_month");
    const item = sections.find(s => s.title === "Upcoming card bills")?.items.find(i => i.sourceId === "amex");
    expect(item).toMatchObject({ amount: 47.45, balanceReminder: true, cycleEnd: "2026-10-18" });
    expect(sections.find(s => s.title === "Other unpaid card balances")?.items).toBeUndefined();
    expect(expensesComingTotal(state, ref, "this_month")).toBe(0);
  });
  it("does not fabricate any due amount on an empty card", () => {
    const state: AppState = { ...emptyState, cards: [card(0)] };
    expect(expensesComingBreakdown(state, ref, "this_month").flatMap(s => s.items)).toEqual([]);
  });
  it("does not duplicate a card whose confirmed statement is already scheduled", () => {
    const state: AppState = { ...emptyState, cards: [card(47.45, 47.45)] };
    const rows = expensesComingBreakdown(state, ref, "this_month").flatMap(s => s.items)
      .filter(i => i.sourceType === "card_due" && i.sourceId === "amex");
    expect(rows).toHaveLength(1);
    expect(rows[0].balanceReminder).toBeFalsy();
  });
});
