import { describe, expect, it } from "vitest";
import { reducer } from "./reducer";
import { canMergeExpenses } from "./transactionMerge";
import { emptyState, type AppState, type Transaction } from "./types";

function expense(id: string, options: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: "expense",
    amount: 29.14,
    category: "Gas",
    description: id,
    date: "2026-09-25",
    sourceAccountId: "checking",
    createdAt: "2026-09-25T10:00:00Z",
    updatedAt: "2026-09-25T10:00:00Z",
    ...options,
  };
}

function state(transactions: Transaction[], balance = 441.72): AppState {
  return {
    ...emptyState,
    accounts: [
      {
        id: "checking",
        bankName: "Bank",
        name: "Checking",
        type: "checking",
        balance,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    transactions,
  };
}

describe("activity expense merge and delete", () => {
  it("only offers matching expenses from the same source within four calendar days", () => {
    const selected = expense("selected");
    expect(canMergeExpenses(selected, expense("same", { date: "2026-09-29" }))).toBe(true);
    expect(canMergeExpenses(selected, expense("late", { date: "2026-09-30" }))).toBe(false);
    expect(canMergeExpenses(selected, expense("different amount", { amount: 29.15 }))).toBe(false);
    expect(
      canMergeExpenses(selected, expense("different account", { sourceAccountId: "savings" })),
    ).toBe(false);
    expect(canMergeExpenses(selected, expense("paid", { reconciledByPaymentId: "payment" }))).toBe(
      false,
    );
    expect(canMergeExpenses(selected, expense("friend", { category: "Gave to friend" }))).toBe(
      false,
    );
    expect(canMergeExpenses(selected, selected)).toBe(false);
  });

  it("deletes a manual expense and restores its cash; a bank-synced expense leaves bank cash alone", () => {
    const manual = expense("manual");
    const synced = expense("bank", { balanceAlreadySynced: true });
    const deleted = reducer(state([manual, synced]), { type: "DELETE_TRANSACTION", id: manual.id });
    expect(deleted.accounts[0].balance).toBe(470.86);
    expect(deleted.transactions).toEqual([synced]);
    const noDoubleCredit = reducer(deleted, { type: "DELETE_TRANSACTION", id: synced.id });
    expect(noDoubleCredit.accounts[0].balance).toBe(470.86);
    expect(reducer(deleted, { type: "DELETE_TRANSACTION", id: manual.id })).toBe(deleted);
    expect(
      reducer(state([expense("paid", { reconciledByPaymentId: "payment" })]), {
        type: "DELETE_TRANSACTION",
        id: "paid",
      }).transactions,
    ).toHaveLength(1);
  });

  it("removes a duplicate without summing and preserves the bank-synced status on the survivor", () => {
    const manual = expense("manual");
    const synced = expense("bank", { balanceAlreadySynced: true, date: "2026-09-26" });
    const merged = reducer(state([manual, synced]), {
      type: "MERGE_TRANSACTIONS",
      sourceId: synced.id,
      targetId: manual.id,
    });
    expect(merged.transactions).toMatchObject([
      { id: manual.id, amount: 29.14, balanceAlreadySynced: true },
    ]);
    expect(merged.accounts[0].balance).toBe(470.86);
    expect(
      reducer(state([manual, synced]), {
        type: "MERGE_TRANSACTIONS",
        sourceId: manual.id,
        targetId: synced.id,
      }).accounts[0].balance,
    ).toBe(470.86);
    expect(
      reducer(state([manual, expense("other")]), {
        type: "MERGE_TRANSACTIONS",
        sourceId: manual.id,
        targetId: "manual",
      }),
    ).toEqual(state([manual, expense("other")]));
  });

  it("reverses an unpaid card charge only once and will not remove a reconciled charge", () => {
    const charge = expense("card-duplicate", { sourceAccountId: undefined, cardId: "card" });
    const original = expense("card-original", { sourceAccountId: undefined, cardId: "card" });
    const withCard: AppState = {
      ...state([charge, original]),
      cards: [
        {
          id: "card",
          name: "Card",
          type: "regular",
          limit: 1000,
          currentBalance: 158.28,
          statementBalance: 0,
          minimumDue: 0,
          billingDate: 1,
          dueDate: 20,
          apr: 0,
          targetUtilizationPercent: 30,
          preferredCategories: [],
        },
      ],
    };
    const merged = reducer(withCard, {
      type: "MERGE_TRANSACTIONS",
      sourceId: charge.id,
      targetId: original.id,
    });
    expect(merged.cards[0].currentBalance).toBe(129.14);
    expect(merged.transactions).toHaveLength(1);
    expect(
      reducer(withCard, { type: "DELETE_TRANSACTION", id: charge.id }).cards[0].currentBalance,
    ).toBe(129.14);
    expect(
      reducer(
        { ...withCard, transactions: [{ ...charge, reconciledByPaymentId: "payment" }, original] },
        { type: "MERGE_TRANSACTIONS", sourceId: charge.id, targetId: original.id },
      ).cards[0].currentBalance,
    ).toBe(158.28);
  });

  it("cleans up a deleted friend's expected repayment and moves one to the survivor when merging", () => {
    const first = expense("first", { category: "Gave to friend" });
    const second = expense("second", { category: "Gave to friend" });
    const withRepayment: AppState = {
      ...state([first, second]),
      plannedIncomeOverrides: [
        {
          id: "return",
          sourceId: "friend-repayment-first",
          linkedExpenseId: "first",
          kind: "friend_repayment",
          payDate: "2026-10-25",
          action: "add",
          amount: 29.14,
        },
      ],
    };
    const merged = reducer(withRepayment, {
      type: "MERGE_TRANSACTIONS",
      sourceId: "first",
      targetId: "second",
    });
    expect(merged.plannedIncomeOverrides).toMatchObject([
      { linkedExpenseId: "second", sourceId: "friend-repayment-second" },
    ]);
    expect(
      reducer(merged, { type: "DELETE_TRANSACTION", id: "second" }).plannedIncomeOverrides,
    ).toEqual([]);
  });
});
