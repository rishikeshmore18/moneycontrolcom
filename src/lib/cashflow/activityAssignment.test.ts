import { describe, expect, it } from "vitest";
import { assignablePlannedExpenses, assignablePlannedIncome } from "./activityAssignment";
import { expensesComingTotal, pendingIncome } from "./forecast";
import { reducer } from "./reducer";
import { emptyState, type AppState, type Transaction } from "./types";

const sep = new Date(2026, 8, 29);

function fixture(): AppState {
  return {
    ...emptyState,
    accounts: [
      { id: "checking", name: "Old checking", bankName: "Bank", type: "checking", balance: 500,
        createdAt: "2026-09-01", updatedAt: "2026-09-01" },
      { id: "new-card-account", name: "New checking", bankName: "Bank", type: "checking", balance: 800,
        createdAt: "2026-09-01", updatedAt: "2026-09-01" },
    ],
    recurringBills: [{ id: "mobile", name: "Mobile bill", amount: 50, dueDay: 30,
      paymentMethod: "account", accountId: "checking", active: true }],
  };
}

function mobile(): Transaction {
  return { id: "mobile-charge", type: "expense", amount: 96.61, category: "Other", description: "T-Mobile",
    date: "2026-09-29", sourceAccountId: "new-card-account", balanceAlreadySynced: true,
    createdAt: "2026-09-29", updatedAt: "2026-09-29" };
}

describe("assigning activity to an upcoming item", () => {
  it("assigns the $96.61 T-Mobile charge to the $50 mobile bill despite an outdated payment account", () => {
    const before = fixture();
    before.transactions = [mobile()];
    expect(assignablePlannedExpenses(before, mobile())[0]).toMatchObject({
      label: "Mobile bill", amount: 50, dueDate: "2026-09-30", accountId: "checking",
    });
    const linked = reducer(before, { type: "LINK_EXPENSE_TRANSACTION", id: "mobile-charge", itemId: "mobile:2026-09" });
    expect(linked.transactions[0]).toMatchObject({ amount: 96.61, linkedPlannedExpense: { label: "Mobile bill" } });
    expect(linked.accounts).toEqual(before.accounts);
    expect(expensesComingTotal(linked, sep)).toBe(expensesComingTotal(before, sep) - 50);
    expect(expensesComingTotal(linked, new Date(2026, 9, 1))).toBe(50);
    expect(assignablePlannedExpenses(linked, linked.transactions[0])).toEqual([]);
    const undone = reducer(linked, { type: "UNLINK_PLANNED_TRANSACTION", id: "mobile-charge" });
    expect(undone.accounts).toEqual(before.accounts);
    expect(undone.transactions[0].linkedPlannedExpense).toBeUndefined();
    expect(expensesComingTotal(undone, sep)).toBe(expensesComingTotal(before, sep));
  });

  it("changes future estimates only if explicitly chosen, and restores them when unmatched", () => {
    const before = fixture();
    before.transactions = [mobile()];
    const linked = reducer(before, { type: "LINK_EXPENSE_TRANSACTION", id: "mobile-charge",
      itemId: "mobile:2026-09", updateFutureBillAmount: true });
    expect(linked.recurringBills[0].amount).toBe(96.61);
    expect(expensesComingTotal(linked, new Date(2026, 9, 1))).toBe(96.61);
    const undone = reducer(linked, { type: "UNLINK_PLANNED_TRANSACTION", id: "mobile-charge" });
    expect(undone.recurringBills[0].amount).toBe(50);
    const independentlyEdited = { ...linked, recurringBills: [{ ...linked.recurringBills[0], amount: 75 }] };
    expect(reducer(independentlyEdited, { type: "UNLINK_PLANNED_TRANSACTION", id: "mobile-charge" })
      .recurringBills[0].amount).toBe(75);
  });

  it("pays the correct bill month when its due date was moved across a month boundary", () => {
    const before = fixture();
    before.transactions = [mobile()];
    before.plannedExpenseOverrides = [{ id: "rescheduled", sourceType: "recurring_bill",
      sourceId: "mobile", month: "2026-09", action: "override", dueDate: "2026-10-02" }];
    const linked = reducer(before, { type: "LINK_EXPENSE_TRANSACTION", id: "mobile-charge", itemId: "mobile:2026-09" });
    expect(linked.transactions[0].linkedPlannedExpense?.month).toBe("2026-09");
    expect(linked.plannedExpenseOverrides).toMatchObject([{ sourceId: "mobile", month: "2026-09", action: "skip" }]);
    const undone = reducer(linked, { type: "UNLINK_PLANNED_TRANSACTION", id: "mobile-charge" });
    expect(undone.plannedExpenseOverrides).toEqual(before.plannedExpenseOverrides);
  });

  it("lets an actual deposit settle income planned for a different account without double counting", () => {
    const before = fixture();
    const deposit: Transaction = { id: "deposit", type: "income", amount: 1165.78,
      category: "Income", description: "PAYROLL", date: "2026-09-29",
      targetAccountId: "new-card-account", balanceAlreadySynced: true,
      createdAt: "2026-09-29", updatedAt: "2026-09-29" };
    before.transactions = [deposit];
    before.plannedIncomeOverrides = [{ id: "paycheck", sourceId: "one-time-paycheck", action: "add",
      payDate: "2026-09-30", amount: 1100, label: "Expected pay", accountId: "checking" }];
    expect(assignablePlannedIncome(before, deposit)[0]?.id).toBe("paycheck");
    const linked = reducer(before, { type: "LINK_INCOME_TRANSACTION", id: "deposit", itemId: "paycheck" });
    expect(linked.accounts).toEqual(before.accounts);
    expect(pendingIncome(linked, sep)).toBe(0);
    const undone = reducer(linked, { type: "UNLINK_PLANNED_TRANSACTION", id: "deposit" });
    expect(undone.plannedIncomeOverrides).toEqual(before.plannedIncomeOverrides);
    expect(undone.transactions).toMatchObject([{ id: "deposit", amount: 1165.78 }]);
    expect(undone.accounts).toEqual(before.accounts);
  });

  it("never suggests a bill already paid or a card/debt payment for expense assignment", () => {
    const before = fixture();
    before.transactions = [mobile()];
    const paid = reducer(before, { type: "LINK_EXPENSE_TRANSACTION", id: "mobile-charge", itemId: "mobile:2026-09" });
    const second = { ...mobile(), id: "second" };
    expect(assignablePlannedExpenses(paid, second).some((item) => item.id === "mobile:2026-09")).toBe(false);
    const withSecond = { ...paid, transactions: [second, ...paid.transactions] };
    expect(reducer(withSecond, { type: "LINK_EXPENSE_TRANSACTION", id: "second", itemId: "mobile:2026-09" })).toBe(withSecond);
    expect(assignablePlannedExpenses(before, { ...mobile(), type: "card_payment" })).toEqual([]);
  });
});
