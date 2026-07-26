import { describe, expect, it } from "vitest";
import { actualCategorySpend, monthlyBudgetSummary, resolveBudgetConfig } from "./budget";
import { forecastCashProjection } from "./forecast";
import { emptyState, type AppState } from "./types";

function budgetState(): AppState {
  return {
    ...emptyState,
    profile: { ...emptyState.profile },
    categoryBudgets: [
      {
        id: "groceries",
        category: "Groceries",
        amount: 600,
        startMonth: "2026-06",
        protectInSpendableToday: true,
        rolloverPolicy: "reset",
        active: true,
      },
    ],
    categoryBudgetOverrides: [],
    transactions: [
      {
        id: "grocery-card",
        type: "expense",
        amount: 250,
        category: "groceries",
        description: "Food",
        cardId: "card",
        date: "2026-07-05",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "card-payment",
        type: "card_payment",
        amount: 250,
        category: "Credit card bill",
        description: "Card payment",
        date: "2026-07-20",
        createdAt: "",
        updatedAt: "",
      },
    ],
  };
}

describe("monthly budgets", () => {
  it("counts purchases once and excludes card payments", () => {
    const state = budgetState();
    expect(actualCategorySpend(state, "Groceries", "2026-07")).toBe(250);
    const summary = monthlyBudgetSummary(state, "2026-07");
    expect(summary.totalSpent).toBe(250);
    expect(summary.totalRemaining).toBe(350);
  });

  it("nets an expense refund against the matching category", () => {
    const state = budgetState();
    state.transactions.push({
      id: "refund",
      type: "expense",
      amount: -50,
      category: "Groceries",
      description: "Refund",
      date: "2026-07-08",
      createdAt: "",
      updatedAt: "",
    });
    expect(actualCategorySpend(state, "Groceries", "2026-07")).toBe(200);
  });

  it("separates spent, committed, and remaining amounts", () => {
    const summary = monthlyBudgetSummary(budgetState(), "2026-07", [
      { amount: 80, category: "Groceries" },
    ]);
    expect(summary.categories[0]).toMatchObject({
      spent: 250,
      committed: 80,
      remaining: 270,
      overBy: 0,
    });
  });

  it("reports over-budget and unbudgeted spending", () => {
    const state = budgetState();
    state.transactions = [
      ...state.transactions,
      {
        id: "extra",
        type: "expense",
        amount: 400,
        category: "Groceries",
        description: "",
        date: "2026-07-10",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "cab",
        type: "expense",
        amount: 45,
        category: "Cab",
        description: "",
        date: "2026-07-11",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const summary = monthlyBudgetSummary(state, "2026-07");
    expect(summary.totalOverBy).toBe(50);
    expect(summary.unbudgetedSpent).toBe(45);
  });

  it("supports month-only and future-effective overrides", () => {
    const state = budgetState();
    state.categoryBudgetOverrides = [
      {
        id: "july",
        budgetId: "groceries",
        month: "2026-07",
        scope: "month",
        amount: 700,
        protectInSpendableToday: true,
        rolloverPolicy: "reset",
      },
      {
        id: "august-forward",
        budgetId: "groceries",
        month: "2026-08",
        scope: "from_month",
        amount: 650,
        protectInSpendableToday: false,
        rolloverPolicy: "reset",
      },
    ];
    const budget = state.categoryBudgets[0];
    expect(resolveBudgetConfig(state, budget, "2026-06")?.amount).toBe(600);
    expect(resolveBudgetConfig(state, budget, "2026-07")?.amount).toBe(700);
    expect(resolveBudgetConfig(state, budget, "2026-09")).toMatchObject({
      amount: 650,
      protectInSpendableToday: false,
    });
  });

  it("carries only unused money when rollover is enabled", () => {
    const state = budgetState();
    state.categoryBudgets[0].rolloverPolicy = "carry_remaining";
    state.transactions = [
      {
        id: "june",
        type: "expense",
        amount: 500,
        category: "Groceries",
        description: "",
        date: "2026-06-10",
        createdAt: "",
        updatedAt: "",
      },
    ];
    const july = monthlyBudgetSummary(state, "2026-07");
    expect(july.categories[0].rolloverAmount).toBe(100);
    expect(july.categories[0].limit).toBe(700);
  });

  it("protects unused allowance once in the cash forecast", () => {
    const state = budgetState();
    state.accounts = [
      {
        id: "cash",
        bankName: "",
        name: "Cash",
        type: "cash",
        balance: 1_000,
        availableForSpending: true,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const projection = forecastCashProjection(
      state,
      new Date(2026, 6, 5),
      "this_month",
      undefined,
      {},
      false,
    );
    expect(projection.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Groceries budget reserve",
          amount: -350,
        }),
      ]),
    );
    expect(projection.safeSurplus).toBe(550);
  });

  it("does not double count a committed expense inside a protected budget", () => {
    const state = budgetState();
    state.accounts = [
      {
        id: "cash",
        bankName: "",
        name: "Cash",
        type: "cash",
        balance: 1_000,
        availableForSpending: true,
        createdAt: "",
        updatedAt: "",
      },
    ];
    state.plannedExpenseOverrides = [
      {
        id: "planned-groceries",
        sourceType: "one_time",
        month: "2026-07",
        action: "add",
        name: "Grocery order",
        amount: 80,
        dueDate: "2026-07-20",
        paymentMethod: "account",
        accountId: "cash",
        category: "Groceries",
      },
    ];
    const projection = forecastCashProjection(
      state,
      new Date(2026, 6, 5),
      "this_month",
      undefined,
      {},
      false,
    );
    expect(
      projection.events.find((event) => event.label === "Groceries budget reserve")?.amount,
    ).toBe(-270);
    expect(projection.events.find((event) => event.label === "Grocery order")?.amount).toBe(-80);
    expect(projection.safeSurplus).toBe(550);
  });

  it("does not reserve a track-only budget", () => {
    const state = budgetState();
    state.categoryBudgets[0].protectInSpendableToday = false;
    state.accounts = [
      {
        id: "cash",
        bankName: "",
        name: "Cash",
        type: "cash",
        balance: 1_000,
        availableForSpending: true,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const projection = forecastCashProjection(
      state,
      new Date(2026, 6, 5),
      "this_month",
      undefined,
      {},
      false,
    );
    expect(projection.events.some((event) => event.label.includes("budget reserve"))).toBe(false);
    expect(projection.safeSurplus).toBe(900);
  });
});
