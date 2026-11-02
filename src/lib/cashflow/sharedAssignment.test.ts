import { describe, expect, it } from "vitest";
import { assignablePlannedExpenses, assignablePlannedIncome } from "./activityAssignment";
import { expensesComingTotal, pendingIncome } from "./forecast";
import { reducer } from "./reducer";
import { emptyState, type AppState, type Transaction } from "./types";

const ref = new Date(2026, 8, 20);
const account = { id: "checking", name: "Checking", type: "checking" as const,
  bankName: "Bank", balance: 1000, bankLinked: true,
  createdAt: "2026-09-01", updatedAt: "2026-09-01" };
const expense = (id: string, amount: number): Transaction => ({
  id, type: "expense", amount, description: "Phone", category: "Mobile",
  sourceAccountId: "checking", date: "2026-09-20", balanceAlreadySynced: true,
  createdAt: "2026-09-20", updatedAt: "2026-09-20",
});
const income = (id: string, amount: number): Transaction => ({
  id, type: "income", amount, description: "Bonus", category: "Wages",
  targetAccountId: "checking", date: "2026-09-20", balanceAlreadySynced: true,
  createdAt: "2026-09-20", updatedAt: "2026-09-20",
});
const base = (): AppState => ({ ...emptyState, accounts: [account] });

describe("additional real transactions toward a previously assigned planned item", () => {
  it("keeps an original $10 one-time expense settled when a second $5 expense is assigned", () => {
    const original: AppState = { ...base(), transactions: [expense("a", 10), expense("b", 5)],
      plannedExpenseOverrides: [{ id: "bill", sourceType: "one_time", sourceId: "phone",
        action: "add", month: "2026-09", dueDate: "2026-09-20", amount: 10,
        name: "Phone bill", accountId: "checking" }] };
    const first = reducer(original, { type: "LINK_EXPENSE_TRANSACTION", id: "a", itemId: "bill" });
    expect(expensesComingTotal(first, ref)).toBe(0);
    const previous = assignablePlannedExpenses(first, first.transactions.find(tx => tx.id === "b")!);
    expect(previous.find(item => item.id === "bill")?.historicalMatch).toBe(true);
    const second = reducer(first, { type: "ASSIGN_PLANNED_ITEMS", id: "b", itemIds: ["bill"], mode: "combined" });
    expect(second.transactions.find(tx => tx.id === "b")?.linkedPlannedExpense?.shared).toBe(true);
    expect(second.accounts).toEqual(original.accounts);
    expect(second.plannedExpenseOverrides).toHaveLength(0);
    const removed = reducer(second, { type: "UNLINK_PLANNED_TRANSACTION", id: "a" });
    expect(removed.transactions.find(tx => tx.id === "b")?.linkedPlannedExpense?.shared).toBeFalsy();
    expect(expensesComingTotal(removed, ref)).toBe(0);
    const restored = reducer(removed, { type: "UNLINK_PLANNED_TRANSACTION", id: "b" });
    expect(restored.plannedExpenseOverrides).toHaveLength(1);
    expect(expensesComingTotal(restored, ref)).toBe(10);
  });

  it("supports another payment for a recurring bill and preserves the original cash impact", () => {
    const original: AppState = { ...base(), transactions: [expense("a", 10), expense("b", 5)],
      recurringBills: [{ id: "phone", name: "Phone", amount: 10, dueDay: 20,
        active: true, paymentMethod: "account", accountId: "checking" }] };
    const first = reducer(original, { type: "LINK_EXPENSE_TRANSACTION", id: "a", itemId: "phone:2026-09" });
    const second = reducer(first, { type: "LINK_EXPENSE_TRANSACTION", id: "b", itemId: "phone:2026-09" });
    expect(second.transactions.find(tx => tx.id === "b")?.linkedPlannedExpense?.shared).toBe(true);
    expect(second.accounts).toEqual(original.accounts);
    expect(second.plannedExpenseOverrides).toHaveLength(1);
    const deleted = reducer(second, { type: "DELETE_TRANSACTION", id: "a" });
    expect(deleted.transactions.find(tx => tx.id === "b")?.linkedPlannedExpense?.shared).toBeFalsy();
    expect(deleted.plannedExpenseOverrides).toHaveLength(1);
  });

  it("links a second bank deposit to already received income without adding income again", () => {
    const original: AppState = { ...base(), transactions: [income("first", 10), income("second", 5)],
      plannedIncomeOverrides: [{ id: "bonus", sourceId: "bonus", action: "add",
        payDate: "2026-09-20", amount: 10, label: "Bonus", accountId: "checking" }] };
    const first = reducer(original, { type: "LINK_INCOME_TRANSACTION", id: "first", itemId: "bonus" });
    expect(pendingIncome(first, ref)).toBe(0);
    const previous = assignablePlannedIncome(first, first.transactions.find(tx => tx.id === "second")!);
    expect(previous.find(item => item.id === "bonus")?.historicalMatch).toBe(true);
    const second = reducer(first, { type: "ASSIGN_PLANNED_ITEMS", id: "second", itemIds: ["bonus"], mode: "combined" });
    expect(second.transactions.find(tx => tx.id === "second")?.linkedPlannedIncome?.shared).toBe(true);
    expect(second.accounts).toEqual(original.accounts);
    const removed = reducer(second, { type: "DELETE_INCOME_TRANSACTION", id: "first", bankBalanceAuthoritative: true });
    expect(removed.transactions.find(tx => tx.id === "second")?.linkedPlannedIncome?.shared).toBeFalsy();
    expect(pendingIncome(removed, ref)).toBe(0);
    const restored = reducer(removed, { type: "UNLINK_PLANNED_TRANSACTION", id: "second" });
    expect(pendingIncome(restored, ref)).toBe(10);
    expect(restored.accounts).toEqual(original.accounts);
  });
});
