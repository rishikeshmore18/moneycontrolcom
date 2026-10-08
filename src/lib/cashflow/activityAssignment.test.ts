import { describe, expect, it } from "vitest";
import { assignablePlannedExpenses, assignablePlannedIncome } from "./activityAssignment";
import { expensesComingTotal, pendingIncome, pendingIncomeBreakdown } from "./forecast";
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
  it("settles two $50 bills with one $100 expense and restores both without moving cash", () => {
    const before = fixture();
    before.transactions = [{ ...mobile(), amount: 100 }];
    before.plannedExpenseOverrides = [{ id: "second-bill", sourceType: "one_time",
      sourceId: "other", month: "2026-09", action: "add", amount: 50,
      dueDate: "2026-09-29", name: "Other bill", accountId: "checking" }];
    const initial = expensesComingTotal(before, sep);
    const linked = reducer(before, { type: "ASSIGN_PLANNED_ITEMS", id: "mobile-charge",
      itemIds: ["mobile:2026-09", "second-bill"], mode: "combined" });
    expect(linked).not.toBe(before);
    expect(linked.transactions[0].linkedPlannedExpenses).toHaveLength(1);
    expect(linked.accounts).toEqual(before.accounts);
    expect(expensesComingTotal(linked, sep)).toBe(initial - 100);
    const restored = reducer(linked, { type: "UNLINK_PLANNED_TRANSACTION", id: "mobile-charge" });
    expect(restored.transactions[0].linkedPlannedExpense).toBeUndefined();
    expect(restored.transactions[0].linkedPlannedExpenses).toBeUndefined();
    expect(expensesComingTotal(restored, sep)).toBe(initial);
  });

  it("clears three duplicate $100 plans with one $100 transaction only when explicitly selected", () => {
    const before = fixture();
    before.transactions = [{ ...mobile(), amount: 100 }];
    before.plannedExpenseOverrides = [1, 2, 3].map((n) => ({
      id: `duplicate-${n}`, sourceType: "one_time" as const, sourceId: `bill-${n}`,
      month: "2026-09", action: "add" as const, amount: 100, dueDate: "2026-09-29",
      name: "Phone bill", accountId: "checking",
    }));
    const ids = ["duplicate-1", "duplicate-2", "duplicate-3"];
    expect(reducer(before, { type: "ASSIGN_PLANNED_ITEMS", id: "mobile-charge",
      itemIds: ids, mode: "combined" })).toBe(before);
    const linked = reducer(before, { type: "ASSIGN_PLANNED_ITEMS", id: "mobile-charge",
      itemIds: ids, mode: "duplicates" });
    expect(linked.transactions[0].linkedPlannedExpenses).toHaveLength(2);
    expect(linked.transactions).toHaveLength(1);
    expect(linked.accounts).toEqual(before.accounts);
    expect(linked.plannedExpenseOverrides).toHaveLength(0);
    expect(reducer(linked, { type: "UNLINK_PLANNED_TRANSACTION", id: "mobile-charge" })
      .plannedExpenseOverrides).toHaveLength(3);
  });

  it("allocates one $100 deposit across two planned $50 incomes", () => {
    const before = fixture();
    before.transactions = [{ id: "deposit", type: "income", amount: 100, category: "Income",
      description: "Deposit", date: "2026-09-29", targetAccountId: "checking",
      balanceAlreadySynced: true, createdAt: "2026-09-29", updatedAt: "2026-09-29" }];
    before.plannedIncomeOverrides = [1, 2].map((n) => ({ id: `income-${n}`,
      sourceId: `income-${n}`, action: "add" as const, payDate: "2026-09-30",
      amount: 50, label: `Income ${n}`, accountId: "checking" }));
    const linked = reducer(before, { type: "ASSIGN_PLANNED_ITEMS", id: "deposit",
      itemIds: ["income-1", "income-2"], mode: "combined" });
    expect(linked.transactions[0].linkedPlannedIncomes).toHaveLength(1);
    expect(pendingIncome(linked, sep)).toBe(0);
    expect(linked.accounts).toEqual(before.accounts);
    expect(reducer(linked, { type: "UNLINK_PLANNED_TRANSACTION", id: "deposit" })
      .plannedIncomeOverrides).toHaveLength(2);
  });

  it("splits a bank deposit across two job paydays and reverses each ledger entry", () => {
    const before = fixture();
    before.transactions = [{ id: "deposit", type: "income", amount: 100,
      category: "Income", description: "Payroll", date: "2026-09-29",
      targetAccountId: "checking", balanceAlreadySynced: true,
      createdAt: "2026-09-29", updatedAt: "2026-09-29" }];
    before.jobs = ["one", "two"].map((id) => ({ id, name: id, type: "full_time" as const,
      netHourlyRate: 0, netPaycheckAmount: 50, payFrequency: "weekly" as const,
      paydayWeekday: 2, defaultDepositAccountId: "checking" }));
    before.timesheet = ["one", "two"].map((id) => ({ id: `pay-${id}`, jobId: id,
      jobName: id, entryType: "salary_paycheck" as const, date: "2026-09-29",
      hours: 0, rate: 0, expectedAmount: 50, paid: false, payStatus: "unpaid" as const,
      createdAt: "2026-09-29", updatedAt: "2026-09-29", userEdited: true }));
    const ids = pendingIncomeBreakdown(before, sep).flatMap((section) => section.items)
      .filter((item) => item.incomeSourceType === "work_paycheck" ||
        item.incomeSourceType === "salary_paycheck").map((item) => item.id).slice(0, 2);
    expect(ids).toHaveLength(2);
    const linked = reducer(before, { type: "ASSIGN_PLANNED_ITEMS", id: "deposit",
      itemIds: ids, mode: "combined" });
    expect(linked).not.toBe(before);
    expect(linked.timesheet.filter((entry) => entry.paid).map((entry) => entry.actualAmount))
      .toEqual([50, 50]);
    expect(linked.accounts).toEqual(before.accounts);
    const undone = reducer(linked, { type: "UNLINK_PLANNED_TRANSACTION", id: "deposit" });
    expect(undone.timesheet.every((entry) => !entry.paid)).toBe(true);
    expect(undone.accounts).toEqual(before.accounts);
  });

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
