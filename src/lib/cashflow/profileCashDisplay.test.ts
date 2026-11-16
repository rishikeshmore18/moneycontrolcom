import { describe, expect, it } from "vitest";
import { spendableCash, spendableCashBreakdown } from "./forecast";
import { type AppState, emptyState } from "./types";

function fixture(cashBalance = 3111, reserved = 235): AppState {
  return {
    ...emptyState,
    accounts: [
      { id: "cash", bankName: "Cash", name: "Cash", type: "cash", balance: cashBalance,
        availableForSpending: true, createdAt: "2026-11-01", updatedAt: "2026-11-01" },
      { id: "checking", bankName: "Mnt", name: "Mnt Checking", type: "checking", balance: 613.38,
        availableForSpending: true, createdAt: "2026-11-01", updatedAt: "2026-11-01" },
    ],
    savingsGoals: [{
      id: "car", name: "Car Maintenance", createdAt: "2026-11-01",
      movements: [{ id: "save", accountId: "cash", amount: reserved,
        date: "2026-11-01", kind: "save" }],
    }],
  };
}

const section = (state: AppState) =>
  spendableCashBreakdown(state).find((item) => item.title === "Spendable accounts")!;

describe("Profile cash and Have now cash agree", () => {
  it("shows the full Profile cash amount with savings reserved on a separate line", () => {
    const state = fixture();
    const items = section(state).items;
    expect(items.find((item) => item.id === "cash")?.amount).toBe(3111);
    expect(items.find((item) => item.id === "cash:goal-reserve")?.amount).toBe(-235);
    expect(spendableCash(state)).toBe(3489.38);
    expect(items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(spendableCash(state), 2);
    expect(spendableCashBreakdown(state).find((item) => item.title === "Savings goals (already excluded)")
      ?.items[0].amount).toBe(235);
  });

  it("uses manually edited Profile cash as the source of truth without changing protected cash", () => {
    const original = fixture();
    const revised: AppState = {
      ...original, accounts: original.accounts.map((account) =>
        account.id === "cash" ? { ...account, balance: 3200 } : account),
    };
    expect(section(revised).items.find((item) => item.id === "cash")?.amount).toBe(3200);
    expect(section(revised).items.find((item) => item.id === "cash:goal-reserve")?.amount).toBe(-235);
    expect(spendableCash(revised) - spendableCash(original)).toBe(89);
  });

  it("keeps the raw cash balance visible when the savings goal exceeds available cash", () => {
    const state = fixture(100, 235);
    const items = section(state).items;
    expect(items.find((item) => item.id === "cash")?.amount).toBe(100);
    expect(items.find((item) => item.id === "cash:goal-reserve")?.amount).toBe(-100);
    expect(items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(spendableCash(state), 2);
  });
});
