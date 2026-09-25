import { describe, expect, it } from "vitest";
import { friendReturnDate, isFriendExpenseCategory } from "./friendRepayment";
import { reducer } from "./reducer";
import {
  leftToSpendBreakdown, pendingIncome, pendingIncomeBreakdown,
  spendableToday, spendableTodayBreakdown,
} from "./forecast";
import { emptyState, type AppState } from "./types";

const ref = new Date(2026, 8, 25);

function accountState(): AppState {
  return {
    ...emptyState,
    profile: { ...emptyState.profile, safeToSpendFloor: 100 },
    accounts: [{
      id: "checking", bankName: "Bank", name: "Checking", type: "checking",
      balance: 500, availableForSpending: true,
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }],
    categories: [...emptyState.categories],
    transactions: [], plannedIncomeOverrides: [], plannedExpenseOverrides: [],
  };
}

function lentToFriend() {
  return reducer(accountState(), {
    type: "ADD_EXPENSE",
    payload: {
      amount: 130.25, category: "Gave to friend", description: "Alex",
      date: "2026-09-25", method: "debit", sourceAccountId: "checking",
      friendRepaymentDate: "2026-10-25",
    },
  });
}

describe("friend return date", () => {
  it("counts calendar days from the expense date across months and leap days", () => {
    expect(friendReturnDate("2026-09-25", { mode: "days", days: 30 })).toBe("2026-10-25");
    expect(friendReturnDate("2028-02-28", { mode: "days", days: 1 })).toBe("2028-02-29");
    expect(friendReturnDate("2026-09-25", { mode: "date", date: "2026-10-01" })).toBe("2026-10-01");
    expect(isFriendExpenseCategory("Gave to friends")).toBe(true);
    expect(friendReturnDate("2026-09-25", { mode: "days", days: 1.5 })).toBeNull();
    expect(friendReturnDate("2026-09-25", { mode: "date", date: "2026-09-24" })).toBeNull();
    expect(friendReturnDate("2026-09-25", { mode: "date", date: "2026-02-30" })).toBeNull();
  });

  it("records the outgoing cash once and schedules a linked, unconfirmed repayment", () => {
    const state = lentToFriend();
    const tx = state.transactions[0];
    const repayment = state.plannedIncomeOverrides[0];
    expect(state.accounts[0].balance).toBe(369.75);
    expect(tx.amount).toBe(130.25);
    expect(repayment).toMatchObject({
      amount: 130.25, payDate: "2026-10-25", kind: "friend_repayment",
      linkedExpenseId: tx.id, action: "add",
    });
    expect(pendingIncome(state, ref, "this_month")).toBe(0);
    expect(pendingIncome(state, ref, "next_30_days")).toBe(130.25);
    const row = pendingIncomeBreakdown(state, ref, "next_30_days")[0].items[0];
    expect(row.incomeConfidence).toBe("projected");
    expect(row.detail).toContain("not received");
    expect(spendableToday(state, ref)).toBe(spendableToday({ ...state, plannedIncomeOverrides: [] }, ref));
    const assumptions = spendableTodayBreakdown(state, ref).find(
      (section) => section.title === "Forecast assumptions",
    );
    expect(assumptions?.items.find((item) => item.label === "Income included")?.detail)
      .toContain("$130.25 of expected repayments is excluded until received.");
    expect(leftToSpendBreakdown(state, ref, "next_30_days")[0].items[1].amount).toBe(130.25);
  });

  it("rejects a promised return when no outgoing account or card can be recorded", () => {
    const state = accountState();
    expect(reducer(state, {
      type: "ADD_EXPENSE",
      payload: {
        amount: 130.25, category: "Gave to friend", date: "2026-09-25",
        method: "other", friendRepaymentDate: "2026-10-25",
      },
    })).toBe(state);
    expect(reducer(state, {
      type: "ADD_EXPENSE",
      payload: {
        amount: 130.25, category: "Gave to friend", date: "2026-09-25",
        method: "debit", sourceAccountId: "missing", friendRepaymentDate: "2026-10-25",
      },
    })).toBe(state);
  });

  it("keeps a changed expense and its unedited return amount in sync, but preserves a custom return amount", () => {
    const original = lentToFriend();
    const update = (state: AppState) => reducer(state, {
      type: "UPDATE_TRANSACTION",
      payload: {
        id: state.transactions[0].id, amount: 200, category: "Gave to friend",
        description: "Alex", date: "2026-09-25", sourceAccountId: "checking",
      },
    });
    const changed = update(original);
    expect(changed.accounts[0].balance).toBe(300);
    expect(changed.plannedIncomeOverrides[0].amount).toBe(200);
    const custom = reducer(original, {
      type: "UPDATE_PLANNED_INCOME_OVERRIDE",
      payload: { ...original.plannedIncomeOverrides[0], amount: 80, payDate: "2026-11-01" },
    });
    expect(update(custom).plannedIncomeOverrides[0]).toMatchObject({ amount: 80, payDate: "2026-11-01" });
  });

  it("can reschedule the linked repayment from the expense and remove it when the category changes", () => {
    const original = lentToFriend();
    const tx = original.transactions[0];
    const edited = reducer(original, {
      type: "UPDATE_TRANSACTION",
      payload: {
        id: tx.id, amount: 130.25, category: "Gave to friend", description: "Alex",
        date: "2026-09-25", sourceAccountId: "checking",
        friendRepaymentDate: "2026-11-25",
      },
    });
    expect(edited.plannedIncomeOverrides[0].payDate).toBe("2026-11-25");
    expect(pendingIncome(edited, ref, "next_30_days")).toBe(0);
    expect(pendingIncome(edited, ref, "next_6_months")).toBe(130.25);

    const recategorized = reducer(edited, {
      type: "UPDATE_TRANSACTION",
      payload: {
        id: tx.id, amount: 130.25, category: "Groceries", description: "Alex",
        date: "2026-09-25", sourceAccountId: "checking", friendRepaymentDate: null,
      },
    });
    expect(recategorized.plannedIncomeOverrides).toHaveLength(0);
    expect(recategorized.accounts[0].balance).toBe(369.75);
  });

  it("carries overdue unpaid repayments into the current breakdown and removes them after receipt", () => {
    const original = lentToFriend();
    const overdue = pendingIncomeBreakdown(original, new Date(2026, 10, 2))[0].items[0];
    expect(overdue).toMatchObject({ payDate: "2026-10-25", isOverdue: true, amount: 130.25 });
    expect(overdue.detail).toContain("overdue");
    const received = reducer(original, {
      type: "ADD_INCOME",
      payload: { accountId: "checking", amount: 130.25, date: "2026-11-02", description: "Repayment: Alex", category: "Friend repayment" },
    });
    const settled = reducer(received, { type: "DELETE_PLANNED_INCOME_OVERRIDE", id: original.plannedIncomeOverrides[0].id });
    expect(settled.accounts[0].balance).toBe(500);
    expect(pendingIncome(settled, new Date(2026, 10, 2))).toBe(0);
    expect(settled.transactions.filter((tx) => tx.type === "income")).toHaveLength(1);
  });

  it("does not credit the account again when a repayment is already in the bank balance", () => {
    const original = lentToFriend();
    const synced: AppState = {
      ...original,
      accounts: original.accounts.map((account) => ({ ...account, balance: 500 })),
    };
    const received = reducer(synced, {
      type: "ADD_INCOME",
      payload: {
        accountId: "checking", amount: 130.25, date: "2026-10-25",
        description: "Repayment: Alex", category: "Friend repayment", balanceAlreadySynced: true,
      },
    });
    const settled = reducer(received, { type: "DELETE_PLANNED_INCOME_OVERRIDE", id: original.plannedIncomeOverrides[0].id });
    expect(settled.accounts[0].balance).toBe(500);
    expect(settled.transactions[0].balanceAlreadySynced).toBe(true);
    expect(pendingIncome(settled, new Date(2026, 9, 25))).toBe(0);
  });
});
