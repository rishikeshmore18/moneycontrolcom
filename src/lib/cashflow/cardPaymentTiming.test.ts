import { describe, expect, it } from "vitest";
import { expensesComingBreakdown, expensesComingTotal } from "./forecast";
import { emptyState, type Card, type AppState } from "./types";

const reference = new Date(2026, 9, 20);
function card(timing?: "statement" | "due", statementBalance = 47.45): Card {
  return {
    id: "amex", name: "Amex", type: "regular", limit: 8000,
    currentBalance: 47.45, statementBalance, minimumDue: 40,
    billingDate: 18, dueDate: 15, apr: 22, targetUtilizationPercent: 30,
    preferredCategories: [], paymentTiming: timing,
  };
}
const novemberRange = { start: "2026-11-01", end: "2026-11-30" };
const items = (s: AppState, period: "this_month" | "next_month") =>
  expensesComingBreakdown(s, reference, period === "next_month" ? "custom" : "this_month",
    period === "next_month" ? novemberRange : undefined).flatMap(section => section.items);

describe("Per-card payment timing", () => {
  it("does not list an October statement due November 15 among October expenses", () => {
    const s: AppState = { ...emptyState, cards: [card("due")] };
    expect(items(s, "this_month").filter(i => i.sourceType === "card_due")).toEqual([]);
    expect(expensesComingTotal(s, reference, "this_month")).toBe(0);
  });
  it("counts the confirmed statement in November when due-date payment is selected", () => {
    const s: AppState = { ...emptyState, cards: [card("due")] };
    const november = items(s, "next_month").filter(i => i.sourceType === "card_due");
    expect(november).toHaveLength(1);
    expect(november[0]).toMatchObject({ amount: 47.45, dueDate: "2026-11-15" });
    expect(expensesComingTotal(s, reference, "custom", novemberRange)).toBe(47.45);
  });
  it("preserves statement-generation payments by default", () => {
    const s: AppState = { ...emptyState, cards: [card()] };
    const october = items(s, "this_month").filter(i => i.sourceType === "card_due");
    expect(october).toHaveLength(1);
    expect(expensesComingTotal(s, reference, "this_month")).toBe(47.45);
  });
  it("shows a missing-statement estimate only in the selected payment month", () => {
    const s: AppState = { ...emptyState, cards: [card("due", 0)] };
    expect(items(s, "this_month").filter(i => i.sourceType === "card_due")).toEqual([]);
    const november = items(s, "next_month").filter(i => i.sourceType === "card_due");
    expect(november.length).toBeGreaterThan(0);
    expect(november.every(i => i.balanceReminder)).toBe(true);
    expect(expensesComingTotal(s, reference, "custom", novemberRange)).toBe(0);
  });
});
