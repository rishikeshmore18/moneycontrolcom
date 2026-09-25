import { describe, expect, it } from "vitest";
import { expensesComingBreakdown } from "./forecast";
import { imminentCardPayments, matchingPlannedExpenses } from "./plannedReview";
import { reducer } from "./reducer";
import { type AppState, emptyState } from "./types";

const reference = new Date(2026, 8, 24);

function sampleState(): AppState {
  return {
    ...emptyState,
    accounts: [{ id: "checking", bankName: "Bank", name: "Checking", type: "checking", balance: 500, createdAt: "2026-09-01", updatedAt: "2026-09-01" }],
    recurringBills: [{ id: "membership", name: "AAA Membership", amount: 5.67, dueDay: 24, paymentMethod: "account", accountId: "checking", active: true }],
    plannedExpenseOverrides: [{ id: "restaurant", sourceType: "one_time", month: "2026-09", action: "add", name: "Via Italian Table", amount: 16.96, dueDate: "2026-09-23", paymentMethod: "account", accountId: "checking" }],
  };
}

function upcomingNames(state: AppState): string[] {
  return expensesComingBreakdown(state, reference, "this_month").flatMap((section) => section.items.map((item) => item.label));
}

describe("bank review and planned expense reconciliation", () => {
  it("offers the exact named amount on its linked account, then records it once in activity and removes this month's bill", () => {
    const state = sampleState();
    const [match] = matchingPlannedExpenses(state, { name: "aaa  MEMBERSHIP", amount: 5.67, date: "2026-09-24", accountId: "checking" });
    expect(match?.sourceId).toBe("membership");
    const recorded = reducer(state, { type: "ADD_EXPENSE", payload: { amount: 5.67, category: "Bills", description: "AAA Membership", date: "2026-09-24", method: "debit", sourceAccountId: "checking", balanceAlreadySynced: true } });
    const settled = reducer(recorded, { type: "MARK_PLANNED_EXPENSE_PAID", payload: { sourceType: "recurring_bill", sourceId: match.sourceId, month: "2026-09" } });
    expect(settled.accounts[0].balance).toBe(500);
    expect(settled.transactions[0].balanceAlreadySynced).toBe(true);
    expect(settled.transactions).toHaveLength(1);
    expect(upcomingNames(settled)).not.toContain("AAA Membership");
    expect(upcomingNames(settled)).toContain("Via Italian Table");
    expect(expensesComingBreakdown(settled, new Date(2026, 9, 24), "this_month").flatMap((section) => section.items).map((item) => item.label)).toContain("AAA Membership");
  });

  it("removes the matched one-time item and does not invent a second transaction when an existing expense is merged", () => {
    const recorded = reducer(sampleState(), { type: "ADD_EXPENSE", payload: { amount: 16.96, category: "Dining", description: "Via Italian Table", date: "2026-09-23", method: "debit", sourceAccountId: "checking" } });
    const [match] = matchingPlannedExpenses(recorded, { name: "Via Italian Table", amount: 16.96, date: "2026-09-23", accountId: "checking" });
    expect(match?.overrideId).toBe("restaurant");
    const settled = reducer(recorded, { type: "MARK_PLANNED_EXPENSE_PAID", payload: { sourceType: "one_time", overrideId: match.overrideId, month: "2026-09" } });
    expect(settled.transactions).toHaveLength(1);
    expect(upcomingNames(settled)).not.toContain("Via Italian Table");
  });

  it("rejects wrong amount, wrong account and distant charge dates", () => {
    const state = sampleState();
    expect(matchingPlannedExpenses(state, { name: "AAA Membership", amount: 5.68, date: "2026-09-24", accountId: "checking" })).toEqual([]);
    expect(matchingPlannedExpenses(state, { name: "AAA Membership", amount: 5.67, date: "2026-09-24", accountId: "other" })).toEqual([]);
    expect(matchingPlannedExpenses(state, { name: "AAA Membership", amount: 5.67, date: "2026-09-10", accountId: "checking" })).toEqual([]);
  });

  it("keeps a posted bank balance stable if the reviewed expense is edited later", () => {
    const recorded = reducer(sampleState(), { type: "ADD_EXPENSE", payload: { amount: 5.67, category: "Bills", description: "AAA Membership", date: "2026-09-24", method: "debit", sourceAccountId: "checking", balanceAlreadySynced: true } });
    const edited = reducer(recorded, { type: "UPDATE_TRANSACTION", payload: { id: recorded.transactions[0].id, amount: 6, category: "Bills", description: "AAA Membership", date: "2026-09-24", sourceAccountId: "checking" } });
    expect(edited.accounts[0].balance).toBe(500);
    expect(edited.transactions[0].amount).toBe(6);
  });

  it("does not credit posted bank income twice, while a pending expense still affects the balance", () => {
    const posted = reducer(sampleState(), { type: "ADD_INCOME", payload: { accountId: "checking", amount: 30, date: "2026-09-24", description: "Deposit", balanceAlreadySynced: true } });
    expect(posted.accounts[0].balance).toBe(500);
    expect(posted.transactions[0].amount).toBe(30);
    const pending = reducer(posted, { type: "ADD_EXPENSE", payload: { amount: 5.67, category: "Bills", date: "2026-09-24", method: "debit", sourceAccountId: "checking", balanceAlreadySynced: false } });
    expect(pending.accounts[0].balance).toBe(494.33);
  });
});

describe("imminent card payment reminder", () => {
  it("shows an unpaid statement today or within two days, never a paid or later bill", () => {
    const state = sampleState();
    state.cards = [{ id: "card", name: "Chase", type: "regular", limit: 1000, currentBalance: 105, statementBalance: 105, minimumDue: 25, billingDate: 27, dueDate: 26, apr: 20, targetUtilizationPercent: 30, preferredCategories: [] }];
    expect(imminentCardPayments(state, reference)).toMatchObject([{ cardName: "Chase", amount: 105, daysUntilDue: 2 }]);
    expect(imminentCardPayments(state, new Date(2026, 8, 26))[0]?.daysUntilDue).toBe(0);
    expect(imminentCardPayments(state, new Date(2026, 8, 23))).toEqual([]);
    state.cards[0].currentBalance = 0;
    expect(imminentCardPayments(state, reference)).toEqual([]);
  });
});
