import { describe, expect, it } from "vitest";
import { reducer } from "./reducer";
import { emptyState, type AppState } from "./types";
import { pendingIncome, spendableCash, spendableCashBreakdown, expensesComingTotal } from "./forecast";

const ref = new Date(2026, 9, 8, 12);
const fixture = (linked = true): AppState => ({
  ...emptyState,
  accounts: [
    { id: "a", name: "Checking", bankName: "Bank A", type: "checking", balance: 1000,
      bankLinked: linked, createdAt: "2026-10-01", updatedAt: "2026-10-01" },
    { id: "b", name: "Savings", bankName: "Bank B", type: "savings", balance: 200,
      bankLinked: linked, createdAt: "2026-10-01", updatedAt: "2026-10-01" },
  ],
});

describe("internal account transfer", () => {
  it("records a pair of bank legs once without changing synced balances or counting income/expense", () => {
    const before = fixture();
    const payload = { transactionId: "bank-transfer-debit", fromAccountId: "a", toAccountId: "b",
      amount: 125.42, date: "2026-10-08", bankDebitId: "debit", bankCreditId: "credit",
      debitAlreadySynced: true, creditAlreadySynced: true };
    const after = reducer(before, { type: "ADD_TRANSFER", payload });
    expect(after.accounts.map((account) => account.balance)).toEqual([1000, 200]);
    expect(after.transactions[0]).toMatchObject({ type: "transfer", amount: 125.42,
      accountTransfer: { bankDebitId: "debit", bankCreditId: "credit", fromLocalApplied: 0,
        toLocalApplied: 0 } });
    expect(pendingIncome(after, ref)).toBe(pendingIncome(before, ref));
    expect(expensesComingTotal(after, ref)).toBe(expensesComingTotal(before, ref));
    expect(spendableCash(after)).toBe(spendableCash(before));
    expect(reducer(after, { type: "ADD_TRANSFER", payload })).toBe(after);
  });

  it("links a delayed second bank leg without another transaction or balance move", () => {
    const before = fixture(false); // Bank mapping can arrive before the state is marked bankLinked.
    const first = reducer(before, { type: "ADD_TRANSFER", payload: {
      transactionId: "bank-transfer-debit", fromAccountId: "a", toAccountId: "b",
      amount: 50, date: "2026-10-08", bankDebitId: "debit", debitAlreadySynced: true,
      creditAlreadySynced: true,
    } });
    expect(first.accounts.map((account) => account.balance)).toEqual([1000, 200]);
    const completed = reducer(first, { type: "RECONCILE_ACCOUNT_TRANSFER", id: "bank-transfer-debit",
      leg: "credit", bankId: "credit" });
    expect(completed.accounts).toEqual(first.accounts);
    expect(completed.transactions).toHaveLength(1);
    expect(completed.transactions[0].accountTransfer?.bankCreditId).toBe("credit");
    expect(reducer(completed, { type: "RECONCILE_ACCOUNT_TRANSFER", id: "bank-transfer-debit",
      leg: "credit", bankId: "credit" })).toBe(completed);
  });

  it("reserves an incoming-first transfer until the source bank entry is linked", () => {
    const before = fixture();
    const incomingFirst = reducer(before, { type: "ADD_TRANSFER", payload: {
      transactionId: "bank-transfer-credit", fromAccountId: "a", toAccountId: "b",
      amount: 45.25, date: "2026-10-08", bankCreditId: "credit",
      debitAlreadySynced: true, creditAlreadySynced: true,
    } });
    expect(spendableCash(incomingFirst)).toBe(1154.75);
    expect(spendableCashBreakdown(incomingFirst)[0].items.reduce((sum, item) => sum + item.amount, 0))
      .toBe(1154.75);
    expect(pendingIncome(incomingFirst, ref)).toBe(0);
    const posted = reducer(incomingFirst, { type: "RECONCILE_ACCOUNT_TRANSFER",
      id: "bank-transfer-credit", leg: "debit", bankId: "debit" });
    expect(spendableCash(posted)).toBe(1200);
  });

  it("moves and reverses only locally tracked balances, and rejects invalid transfers", () => {
    const before = fixture(false);
    const after = reducer(before, { type: "ADD_TRANSFER", payload: {
      transactionId: "manual", fromAccountId: "a", toAccountId: "b", amount: 25.15,
      date: "2026-10-08",
    } });
    expect(after.accounts.map((account) => account.balance)).toEqual([974.85, 225.15]);
    const removed = reducer(after, { type: "DELETE_TRANSACTION", id: "manual" });
    expect(removed.accounts.map((account) => account.balance)).toEqual([1000, 200]);
    expect(removed.transactions).toHaveLength(0);
    expect(reducer(before, { type: "ADD_TRANSFER", payload: {
      fromAccountId: "a", toAccountId: "a", amount: 25, date: "2026-10-08",
    } })).toBe(before);
  });
});
