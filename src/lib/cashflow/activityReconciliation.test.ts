import { describe, expect, it } from "vitest";
import { expensesComingTotal, pendingIncome, pendingIncomeBreakdown } from "./forecast";
import { reducer } from "./reducer";
import { canMergeIncome } from "./transactionMerge";
import { emptyState, type AppState, type Transaction } from "./types";

const day = "2026-10-01";
const reference = new Date(2026, 9, 1);

function income(id: string, synced: boolean): Transaction {
  return {
    id, type: "income", amount: 1165.78, category: synced ? "Income" : "Salary",
    description: synced ? "DEPOSIT - DETAIL NOT YET AVAILABLE" : "Full-time",
    date: day, targetAccountId: "checking", balanceAlreadySynced: synced,
    createdAt: `${day}T12:00:00Z`, updatedAt: `${day}T12:00:00Z`,
  };
}

function fixture(): AppState {
  return {
    ...emptyState,
    accounts: [{ id: "checking", bankName: "Bank", name: "Checking", type: "checking",
      balance: 5000, availableForSpending: true,
      createdAt: day, updatedAt: day }],
  };
}

describe("post-entry income reconciliation", () => {
  it("suggests only matching income deposits, not a different account, amount, or date", () => {
    const manual = income("manual", false);
    expect(canMergeIncome(manual, income("bank", true))).toBe(true);
    expect(canMergeIncome(manual, { ...income("other-account", true), targetAccountId: "savings" })).toBe(false);
    expect(canMergeIncome(manual, { ...income("other-amount", true), amount: 1165.79 })).toBe(false);
    expect(canMergeIncome(manual, { ...income("late", true), date: "2026-10-06" })).toBe(false);
  });

  it("merges the screenshot's manual payday with its synced bank deposit without changing bank cash", () => {
    const before = { ...fixture(), transactions: [income("manual", false), income("bank", true)] };
    const merged = reducer(before, { type: "MERGE_INCOME_TRANSACTIONS",
      sourceId: "bank", targetId: "manual", bankBalanceAuthoritative: true });
    expect(merged.accounts[0].balance).toBe(5000);
    expect(merged.transactions).toMatchObject([
      { id: "manual", description: "Full-time", amount: 1165.78, balanceAlreadySynced: true },
    ]);
    expect(reducer(merged, { type: "MERGE_INCOME_TRANSACTIONS",
      sourceId: "bank", targetId: "manual", bankBalanceAuthoritative: true })).toBe(merged);
    expect(reducer(before, { type: "DELETE_INCOME_TRANSACTION", id: "bank",
      bankBalanceAuthoritative: true }).accounts[0].balance).toBe(5000);
    expect(reducer(before, { type: "DELETE_INCOME_TRANSACTION", id: "manual",
      bankBalanceAuthoritative: true }).accounts[0].balance).toBe(5000);
  });

  it("reverses a standalone manual deposit when there is no bank-linked account", () => {
    const before = { ...fixture(), transactions: [income("manual", false)] };
    expect(reducer(before, { type: "DELETE_INCOME_TRANSACTION", id: "manual",
      bankBalanceAuthoritative: false }).accounts[0].balance).toBe(3834.22);
    const doubled = { ...before, transactions: [income("manual", false), income("other", false)] };
    expect(reducer(doubled, { type: "MERGE_INCOME_TRANSACTIONS", sourceId: "manual",
      targetId: "other", bankBalanceAuthoritative: false }).accounts[0].balance).toBe(3834.22);
  });

  it("links a posted deposit to an unpaid salary without adding cash, and restores the payday on delete", () => {
    const before = fixture();
    before.transactions = [income("bank", true)];
    before.jobs = [{ id: "job", name: "Full-time", type: "full_time", netHourlyRate: 0,
      netPaycheckAmount: 1165.78, payFrequency: "weekly", paydayWeekday: 4,
      defaultDepositAccountId: "checking" }];
    const item = pendingIncomeBreakdown(before, reference).flatMap((section) => section.items)[0];
    expect(item.label).toBe("Full-time");
    const linked = reducer(before, { type: "LINK_INCOME_TRANSACTION", id: "bank", itemId: item.id });
    expect(linked.accounts[0].balance).toBe(5000);
    expect(linked.timesheet).toMatchObject([{ paid: true, actualAmount: 1165.78, linkedTransactionId: "bank" }]);
    expect(pendingIncome(linked, reference)).toBeLessThan(pendingIncome(before, reference));
    const removed = reducer(linked, { type: "DELETE_INCOME_TRANSACTION", id: "bank",
      bankBalanceAuthoritative: true });
    expect(removed.accounts[0].balance).toBe(5000);
    expect(removed.timesheet).toMatchObject([{ paid: false, linkedTransactionId: undefined }]);
    expect(pendingIncome(removed, reference)).toBe(pendingIncome(before, reference));
  });

  it("marks one-time expected income received and restores it if the linked record is deleted", () => {
    const before = fixture();
    before.transactions = [income("bank", true)];
    before.plannedIncomeOverrides = [{ id: "expected", sourceId: "one-time-income-expected",
      payDate: day, action: "add", label: "Client payment", amount: 1165.78,
      accountId: "checking" }];
    const linked = reducer(before, { type: "LINK_INCOME_TRANSACTION", id: "bank", itemId: "expected" });
    expect(linked.plannedIncomeOverrides).toHaveLength(0);
    expect(linked.accounts[0].balance).toBe(5000);
    const removed = reducer(linked, { type: "DELETE_INCOME_TRANSACTION", id: "bank",
      bankBalanceAuthoritative: true });
    expect(removed.plannedIncomeOverrides).toEqual(before.plannedIncomeOverrides);
  });

  it("matches an accepted expense to a recurring bill, then reopens that bill on delete", () => {
    const before = fixture();
    before.transactions = [{ id: "expense", type: "expense", amount: 96.61,
      category: "Bills", description: "T-Mobile", date: day,
      sourceAccountId: "checking", balanceAlreadySynced: true,
      createdAt: `${day}T12:00:00Z`, updatedAt: `${day}T12:00:00Z` }];
    before.recurringBills = [{ id: "mobile", name: "T-Mobile", amount: 96.61, dueDay: 1,
      paymentMethod: "account", accountId: "checking", active: true }];
    const beforeAmount = expensesComingTotal(before, reference);
    const linked = reducer(before, { type: "LINK_EXPENSE_TRANSACTION", id: "expense", itemId: "mobile:2026-10" });
    expect(linked.transactions[0].linkedPlannedExpense?.label).toBe("T-Mobile");
    expect(expensesComingTotal(linked, reference)).toBe(beforeAmount - 96.61);
    expect(linked.accounts[0].balance).toBe(5000);
    const removed = reducer(linked, { type: "DELETE_TRANSACTION", id: "expense" });
    expect(expensesComingTotal(removed, reference)).toBe(beforeAmount);
    expect(removed.accounts[0].balance).toBe(5000);
  });

  it("keeps a bank-linked balance unchanged when merging a duplicate expense", () => {
    const original: Transaction = { id: "manual", type: "expense", amount: 29.14,
      category: "Gas", description: "Shell", date: day, sourceAccountId: "checking",
      createdAt: day, updatedAt: day };
    const before = { ...fixture(), transactions: [original,
      { ...original, id: "bank", balanceAlreadySynced: true }] };
    const after = reducer(before, { type: "MERGE_TRANSACTIONS", sourceId: "bank",
      targetId: "manual", bankBalanceAuthoritative: true });
    expect(after.accounts[0].balance).toBe(5000);
    expect(after.transactions).toMatchObject([{ id: "manual", balanceAlreadySynced: true }]);
  });

  it("requires undoing a bank-linked payday through its activity record", () => {
    const entry = { id: "entry", jobId: "job", jobName: "Full-time", entryType: "salary_paycheck" as const,
      date: day, startTime: "", endTime: "", hours: 0, rate: 0, expectedAmount: 1165.78,
      actualAmount: 1165.78, paid: true, payStatus: "paid" as const,
      paidAccountId: "checking", linkedTransactionId: "bank", userEdited: true,
      createdAt: day, updatedAt: day };
    const before = { ...fixture(), timesheet: [entry], transactions: [income("bank", true)] };
    expect(reducer(before, { type: "UNMARK_TIMESHEET_PAID", payload: { id: "entry" } })).toBe(before);
  });

  it("unmarking a manually recorded payday removes its activity row and reverses only that cash", () => {
    const before = fixture();
    before.timesheet = [{ id: "entry", jobId: "job", jobName: "Full-time",
      entryType: "salary_paycheck", date: day, startTime: "", endTime: "", hours: 0,
      rate: 0, expectedAmount: 1165.78, paid: false, payStatus: "unpaid", userEdited: true,
      createdAt: day, updatedAt: day }];
    const marked = reducer(before, { type: "MARK_TIMESHEET_PAID", payload: {
      id: "entry", paidAccountId: "checking", actualAmount: 1165.78, date: day } });
    expect(marked.accounts[0].balance).toBe(6165.78);
    const undone = reducer(marked, { type: "UNMARK_TIMESHEET_PAID", payload: { id: "entry" } });
    expect(undone.accounts[0].balance).toBe(5000);
    expect(undone.transactions).toHaveLength(0);
    expect(undone.timesheet[0].paid).toBe(false);
  });
});
