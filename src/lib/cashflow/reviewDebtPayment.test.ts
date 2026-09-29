import { describe, expect, it } from "vitest";
import { expensesComingBreakdown, expensesComingTotal, spendableCash } from "./forecast";
import { reducer } from "./reducer";
import { emptyState, type AppState } from "./types";

const reference = new Date(2026, 8, 28);

function loanState(status: "active" | "not_started" = "active"): AppState {
  return {
    ...emptyState,
    accounts: [
      {
        id: "checking",
        bankName: "Bank",
        name: "Checking",
        type: "checking",
        balance: 8_000,
        availableForSpending: true,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    debts: [
      {
        id: "student",
        name: "Student Loan",
        balance: 42_350,
        minimumPayment: 2_650,
        dueDate: 30,
        status,
        payoffMode: "minimum",
        defaultPaymentAccountId: "checking",
      },
    ],
  };
}

function reviewPayment(
  state: AppState,
  options: Partial<{
    amount: number;
    principalAmount: number;
    debtId: string;
    sourceAccountId: string;
    date: string;
    balanceAlreadySynced: boolean;
  }> = {},
): AppState {
  return reducer(state, {
    type: "REVIEW_DEBT_PAYMENT",
    payload: {
      debtId: "student",
      amount: 2_611,
      principalAmount: 2_000,
      sourceAccountId: "checking",
      date: "2026-09-28",
      balanceAlreadySynced: true,
      ...options,
    },
  });
}

function plannedAmount(state: AppState, date = reference): number {
  return (
    expensesComingBreakdown(state, date, "this_month")
      .flatMap((section) => section.items)
      .find((item) => item.sourceType === "debt_plan" && item.sourceId === "student")?.amount ?? 0
  );
}

describe("reviewed debt payment", () => {
  it("records the full posted bank outflow once, applies only confirmed principal and leaves the unpaid plan visible", () => {
    const before = loanState();
    expect(plannedAmount(before)).toBe(2_650);
    const paid = reviewPayment(before);
    expect(paid.accounts[0].balance).toBe(8_000);
    expect(paid.debts[0].balance).toBe(40_350);
    expect(paid.transactions[0]).toMatchObject({
      type: "debt_payment",
      amount: 2_611,
      debtPrincipalAmount: 2_000,
      debtId: "student",
      sourceAccountId: "checking",
      balanceAlreadySynced: true,
    });
    expect(plannedAmount(paid)).toBe(39);
    expect(spendableCash(paid) - expensesComingTotal(paid, reference)).toBe(7_961);
    expect(plannedAmount(paid, new Date(2026, 9, 1))).toBe(2_650);
  });

  it("reduces an unsynced account and the planned amount by the gross payment, not the principal", () => {
    const before = loanState();
    const paid = reviewPayment(before, {
      amount: 100.25,
      principalAmount: 80.25,
      balanceAlreadySynced: false,
    });
    expect(paid.accounts[0].balance).toBe(7_899.75);
    expect(paid.debts[0].balance).toBe(42_269.75);
    expect(plannedAmount(paid)).toBe(2_549.75);
    expect(spendableCash(before) - expensesComingTotal(before, reference)).toBe(
      spendableCash(paid) - expensesComingTotal(paid, reference),
    );
  });

  it("allows an existing not-started loan and skips a fully covered plan for an active loan", () => {
    const notStarted = reviewPayment(loanState("not_started"), { principalAmount: 2_611 });
    expect(notStarted.debts[0]).toMatchObject({ balance: 39_739, status: "not_started" });
    expect(notStarted.plannedExpenseOverrides).toHaveLength(0);
    const paid = reviewPayment(loanState(), { amount: 2_650, principalAmount: 2_400 });
    expect(plannedAmount(paid)).toBe(0);
    expect(paid.plannedExpenseOverrides[0]).toMatchObject({
      sourceType: "debt_plan",
      sourceId: "student",
      month: "2026-09",
      action: "skip",
    });
  });

  it("applies the payment only to the debt ID the user selected", () => {
    const before = loanState("not_started");
    before.debts.push({
      ...before.debts[0],
      id: "friend",
      name: "Trishali",
      balance: 205,
    });
    const paid = reviewPayment(before);
    expect(paid.debts.find((debt) => debt.id === "student")?.balance).toBe(40_350);
    expect(paid.debts.find((debt) => debt.id === "friend")?.balance).toBe(205);
    expect(paid.transactions[0].debtId).toBe("student");
  });

  it("rejects an invalid principal, missing payment account, non-cent amount or bad date without changing state", () => {
    const before = loanState();
    expect(reviewPayment(before, { principalAmount: 2_612 })).toBe(before);
    expect(reviewPayment(before, { principalAmount: 42_351, amount: 50_000 })).toBe(before);
    expect(reviewPayment(before, { sourceAccountId: "missing" })).toBe(before);
    expect(reviewPayment(before, { amount: 2_611.001 })).toBe(before);
    expect(reviewPayment(before, { date: "2026-09-31" })).toBe(before);
  });
});
