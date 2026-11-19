import { describe, expect, it } from "vitest";
import { reducer } from "./reducer";
import { spendableCash, spendableCashBreakdown } from "./forecast";
import { emptyState, type AppState } from "./types";

const fixture = (): AppState => ({
  ...emptyState,
  accounts: [
    { id: "bank", name: "Mnt Saving", bankName: "Mnt", type: "savings",
      bankLinked: true, balance: 2407.05, createdAt: "2026-11-19", updatedAt: "2026-11-19" },
    { id: "cash", name: "Cash", bankName: "Cash", type: "cash",
      balance: 3111, createdAt: "2026-11-19", updatedAt: "2026-11-19" },
  ],
  savingsGoals: [
    { id: "car", name: "Car Maintenance", createdAt: "2026-11-19",
      movements: [{ id: "reserve", accountId: "bank", amount: 110, date: "2026-11-19", kind: "save" }] },
  ],
  cards: [{ id: "visa", name: "Visa", type: "regular", limit: 8000,
    currentBalance: 500, statementBalance: 100, minimumDue: 25,
    billingDate: 15, dueDate: 12, apr: 22,
    targetUtilizationPercent: 30, preferredCategories: [] }],
});

function spendableItems(state: AppState) {
  return spendableCashBreakdown(state).find((section) =>
    section.title === "Spendable accounts")!.items;
}

describe("Bank sync is authoritative; Cash is manually maintainable", () => {
  it("displays the full synced balance and separates savings reserves without changing spendable totals", () => {
    const state = fixture();
    const rows = spendableItems(state);
    expect(rows.find((row) => row.id === "bank")?.amount).toBe(2407.05);
    expect(rows.find((row) => row.id === "bank:goal-reserve")?.amount).toBe(-110);
    expect(rows.find((row) => row.id === "cash")?.amount).toBe(3111);
    expect(spendableCash(state)).toBeCloseTo(5408.05, 2);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(spendableCash(state), 2);
  });

  it("keeps the bank synced balance even when a manually logged debit, deposit or transfer is recorded", () => {
    const first = fixture();
    const expense = reducer(first, { type: "ADD_EXPENSE", payload: {
      amount: 35, category: "Fuel", date: "2026-11-19",
      method: "debit", sourceAccountId: "bank",
    } });
    expect(expense.accounts.find((a) => a.id === "bank")?.balance).toBe(2407.05);
    const income = reducer(expense, { type: "ADD_INCOME", payload: {
      amount: 100, category: "Income", description: "Bank deposit",
      date: "2026-11-19", accountId: "bank",
    } });
    expect(income.accounts.find((a) => a.id === "bank")?.balance).toBe(2407.05);
    const moved = reducer(income, { type: "ADD_TRANSFER", payload: {
      fromAccountId: "bank", toAccountId: "cash", amount: 25,
      date: "2026-11-19",
    } });
    expect(moved.accounts.find((a) => a.id === "bank")?.balance).toBe(2407.05);
    expect(moved.accounts.find((a) => a.id === "cash")?.balance).toBe(3136);
    expect(spendableItems(moved).find((row) => row.id === "bank")?.amount).toBe(2407.05);
  });

  it("does not let a Profile save overwrite the bank snapshot but allows changing the cash balance", () => {
    const state = fixture();
    const original = state.accounts[0];
    const saved = reducer(state, { type: "UPDATE_ACCOUNT",
      payload: { ...original, balance: 1, bankLinked: false, type: "cash", name: "Renamed" },
    });
    expect(saved.accounts[0]).toMatchObject({
      balance: 2407.05, bankLinked: true, type: "savings", name: "Renamed",
    });
    const cash = reducer(saved, { type: "UPDATE_ACCOUNT",
      payload: { ...saved.accounts[1], balance: 3220 },
    });
    expect(cash.accounts[1].balance).toBe(3220);
    expect(spendableItems(cash).find((row) => row.id === "cash")?.amount).toBe(3220);
  });

  it("accepts an authoritative bank refresh without modifying manually entered cash", () => {
    const state = fixture();
    const synced = reducer(state, { type: "SYNC_ACCOUNT_BALANCE", id: "bank", balance: 1393.38 });
    expect(synced.accounts[0].balance).toBe(1393.38);
    expect(synced.accounts[1].balance).toBe(3111);
    expect(spendableItems(synced).find((row) => row.id === "bank")?.amount).toBe(1393.38);
  });

  it("rejects a manual adjustment to a synced bank but allows a cash correction", () => {
    const state = fixture();
    const bad = reducer(state, { type: "ADD_ADJUSTMENT", payload: {
      accountId: "bank", newBalance: 1, reason: "Correction", date: "2026-11-19",
    } });
    expect(bad).toBe(state);
    const corrected = reducer(state, { type: "ADD_ADJUSTMENT", payload: {
      accountId: "cash", newBalance: 3200, reason: "Cash count", date: "2026-11-19",
    } });
    expect(corrected.accounts[0].balance).toBe(2407.05);
    expect(corrected.accounts[1].balance).toBe(3200);
    expect(spendableItems(corrected).find((row) => row.id === "cash")?.amount).toBe(3200);
  });

  it("ignores a bank-sync action mistakenly sent to the physical Cash account", () => {
    const state = fixture();
    const next = reducer(state, { type: "SYNC_ACCOUNT_BALANCE", id: "cash", balance: 10 });
    expect(next.accounts[1].balance).toBe(3111);
    expect(next.accounts[1].bankLinked).toBeUndefined();
  });

  it("keeps the bank balance unchanged while a card payment awaits withdrawal", () => {
    const state = fixture();
    const paid = reducer(state, { type: "PAY_CREDIT_CARD",
      payload: { cardId: "visa", sourceAccountId: "bank", amount: 35, date: "2026-11-19" },
    });
    const rows = spendableItems(paid);
    expect(paid.accounts[0].balance).toBe(2407.05);
    expect(rows.find((row) => row.id === "bank")?.amount).toBe(2407.05);
    expect(rows.find((row) => row.id === "bank:pending-withdrawal")?.amount).toBe(-35);
    expect(rows.reduce((sum, row) => sum + row.amount, 0))
      .toBeCloseTo(spendableCash(paid), 2);
  });
});
