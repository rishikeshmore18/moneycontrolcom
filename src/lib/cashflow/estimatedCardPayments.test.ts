import { describe, expect, it } from "vitest";
import {
  expenseAffordabilityById,
  expensesComingBreakdown,
  expensesComingTotal,
  forecastCashProjection,
} from "./forecast";
import { emptyState, type AppState, type Card } from "./types";

const NOW = new Date(2026, 10, 23);
function card(id: string, amount: number, statementDate: number, dueDay: number,
  statementBalance = 0, paymentTiming: "statement" | "due" = "statement"): Card {
  return {
    id, name: id, type: "regular", limit: 10000,
    currentBalance: amount, statementBalance, minimumDue: 0,
    billingDate: statementDate, dueDate: dueDay, apr: 22,
    targetUtilizationPercent: 30, preferredCategories: [], paymentTiming,
    defaultPaymentAccountId: "checking",
  };
}
function state(balance = 6000): AppState {
  return {
    ...emptyState,
    accounts: [{
      id: "checking", name: "Checking", bankName: "Bank", type: "checking",
      balance, bankLinked: true, availableForSpending: true,
      createdAt: "2026-11-01", updatedAt: "2026-11-01",
    }],
    cards: [
      card("Amex BCE", 7.43, 18, 12, 7.43),
      card("Chase", 1590.93, 21, 18),
      card("Discover", 638, 3, 28),
      card("Amazon", 76.05, 6, 3),
      card("Amex 2007", 529.62, 20, 15),
    ],
  };
}
function cardRows(s: AppState) {
  return expensesComingBreakdown(s, NOW, "this_month")
    .find(section => section.title === "Upcoming card bills")?.items ?? [];
}

describe("Statement-generation card payment estimates and status", () => {
  it("counts every November planned card payment once, even without imported statement amounts", () => {
    const s = state();
    const rows = cardRows(s);
    expect(rows).toHaveLength(5);
    expect(rows.filter(item => item.estimatedCardPayment)).toHaveLength(4);
    expect(rows.every(item => !item.balanceReminder)).toBe(true);
    expect(rows.find(item => item.sourceId === "Chase")).toMatchObject({
      amount: 1590.93, cycleEnd: "2026-11-21",
      dueDate: "2026-11-21", isOverdue: true,
    });
    expect(rows.find(item => item.sourceId === "Amex BCE")?.estimatedCardPayment)
      .toBeFalsy();
    expect(expensesComingTotal(s, NOW, "this_month")).toBeCloseTo(2842.03, 2);
  });

  it("protects the same estimated cash once in the 90-day forecast and exposes affordability", () => {
    const s = state();
    const projection = forecastCashProjection(s, NOW, "next_30_days", undefined, {}, true);
    expect(projection.totalExpenses).toBeCloseTo(2842.03, 2);
    expect(projection.events.filter(event => event.sourceItem?.sourceType === "card_due"))
      .toHaveLength(5);
    expect(projection.events.every(event => event.date >= "2026-11-23")).toBe(true);
    const affordability = expenseAffordabilityById(s, NOW, "this_month");
    const chase = cardRows(s).find(item => item.sourceId === "Chase")!;
    expect(affordability[chase.id]?.affordable).toBe(true);
    expect(affordability[chase.id]?.date).toBe("2026-11-23");
  });

  it("shows a cash-short status when planned card payments exceed available cash", () => {
    const s = state(100);
    const affordability = expenseAffordabilityById(s, NOW, "this_month");
    const rows = cardRows(s);
    expect(rows.some(item => affordability[item.id]?.affordable === false)).toBe(true);
    expect(expensesComingTotal(s, NOW, "this_month")).toBeCloseTo(2842.03, 2);
  });

  it("does not count a skipped estimated statement, while keeping its unpaid debt visible", () => {
    const s = state();
    s.plannedExpenseOverrides = [{
      id: "skip-chase-nov", sourceType: "card_due",
      sourceId: "statement-estimate:Chase:2026-11-21",
      month: "2026-11", action: "skip", manualCardSkip: true,
    }];
    expect(cardRows(s).some(item => item.sourceId === "Chase")).toBe(false);
    expect(expensesComingTotal(s, NOW, "this_month")).toBeCloseTo(1251.10, 2);
    expect(expensesComingBreakdown(s, NOW, "this_month")
      .find(section => section.title === "Other unpaid card balances")?.items
      .some(item => item.sourceId === "Chase")).toBe(true);
  });

  it("respects pay-on-due-date rather than counting its unconfirmed statement in November", () => {
    const s = state();
    s.cards = [card("Chase", 1590.93, 21, 18, 0, "due")];
    expect(expensesComingTotal(s, NOW, "this_month")).toBe(0);
    const december = expensesComingBreakdown(s, NOW, "custom", {
      start: "2026-12-01", end: "2026-12-31",
    }).flatMap(section => section.items).filter(item => item.sourceId === "Chase");
    expect(december.length).toBeGreaterThan(0);
    expect(december.every(item => item.balanceReminder)).toBe(true);
  });
});

describe("bank-confirmed statements never turn all outstanding debt into one overdue bill", () => {
  it("uses issuer statement and actual due date while preserving extra card debt for a later cycle", () => {
    const s = state();
    s.cards = [card("Chase", 1590.93, 21, 18, 0, "statement")];
    s.cards[0]!.plaidLiability = {
      accountId: "plaid_chase", statementBalance: 900,
      statementIssueDate: "2026-11-21", issuerDueDate: "2026-12-18",
      minimumDue: 35, issuerOverdue: false, lastPaymentAmount: null,
      lastPaymentDate: null, syncedAt: "2026-11-22T23:00:00.000Z",
    };
    const rows = cardRows(s);
    const confirmed = rows.find(item => item.id === "Chase:generated-statement:2026-11-21");
    expect(confirmed?.amount).toBe(900);
    expect(confirmed?.detail).toContain("issuer due Dec");
    expect(confirmed?.issuerOverdue).toBe(false);
    expect(confirmed?.plannedStatementPayment).toBe(true);
    expect(confirmed?.isOverdue).toBe(true); // Preferred early day missed, not issuer overdue
  });
  it("respects a confirmed zero statement while maintaining unbilled debt", () => {
    const s = state();
    s.cards = [card("Chase", 500, 21, 18, 0, "statement")];
    s.cards[0]!.plaidLiability = {
      accountId: "plaid_chase", statementBalance: 0,
      statementIssueDate: "2026-11-21", issuerDueDate: "2026-12-18",
      minimumDue: 0, issuerOverdue: false, lastPaymentAmount: null,
      lastPaymentDate: null, syncedAt: "2026-11-22T23:00:00.000Z",
    };
    expect(cardRows(s).some(item => item.id.startsWith("statement-estimate:"))).toBe(false);
  });
});
