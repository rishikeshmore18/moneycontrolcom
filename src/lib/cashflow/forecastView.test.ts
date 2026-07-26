import { describe, expect, it } from "vitest";
import { forecastCashProjection } from "./forecast";
import {
  forecastScenarioOptions,
  reservedCashTotal,
  zeroAprPayoffPlan,
  type CustomForecastScenario,
} from "./forecastView";
import { emptyState, type AppState, type Card } from "./types";

const REF = new Date(2026, 6, 10);
const CUSTOM: CustomForecastScenario = {
  unexpectedExpenseAmount: 250,
  unexpectedExpenseDate: "2026-07-15",
  variableExpenseReductionPercent: 10,
};

function baseState(): AppState {
  return {
    ...emptyState,
    onboarded: true,
    profile: { ...emptyState.profile, safeToSpendFloor: 100 },
    accounts: [
      {
        id: "checking",
        bankName: "Bank",
        name: "Checking",
        type: "checking",
        balance: 1_000,
        availableForSpending: true,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
      {
        id: "reserve",
        bankName: "Bank",
        name: "Emergency",
        type: "savings",
        balance: 500,
        availableForSpending: false,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    plannedExpenseOverrides: [
      {
        id: "july-plan",
        sourceType: "one_time",
        month: "2026-07",
        action: "add",
        name: "July expense",
        amount: 100,
        dueDate: "2026-07-20",
        accountId: "checking",
      },
      {
        id: "august-plan",
        sourceType: "one_time",
        month: "2026-08",
        action: "add",
        name: "August expense",
        amount: 200,
        dueDate: "2026-08-05",
        accountId: "checking",
      },
    ],
  };
}

describe("Forecast presentation projections", () => {
  it("keeps scenarios temporary and changes the projected balance", () => {
    const state = baseState();
    const expected = forecastCashProjection(
      state,
      REF,
      "this_month",
      undefined,
      forecastScenarioOptions("expected", REF, CUSTOM, true),
    );
    const best = forecastCashProjection(
      state,
      REF,
      "this_month",
      undefined,
      forecastScenarioOptions("best", REF, CUSTOM, true),
    );
    const worst = forecastCashProjection(
      state,
      REF,
      "this_month",
      undefined,
      forecastScenarioOptions("worst", REF, CUSTOM, false),
    );

    expect(expected.endingBalance).toBe(900);
    expect(best.endingBalance).toBe(920);
    expect(worst.endingBalance).toBe(400);
    expect(state.plannedExpenseOverrides).toHaveLength(2);
  });

  it("changes selected-period results without changing the source records", () => {
    const state = baseState();
    const month = forecastCashProjection(state, REF, "this_month");
    const sixMonths = forecastCashProjection(state, REF, "next_6_months");

    expect(month.totalExpenses).toBe(100);
    expect(sixMonths.totalExpenses).toBe(300);
    expect(month.endingBalance).toBe(900);
    expect(sixMonths.endingBalance).toBe(700);
  });

  it("reports the first day cash drops below the safety floor", () => {
    const state = baseState();
    state.accounts[0].balance = 150;
    state.plannedExpenseOverrides[0].amount = 75;

    const projection = forecastCashProjection(state, REF, "this_month");

    expect(projection.runwayDate).toBe("2026-07-20");
    expect(projection.runwayDays).toBe(10);
  });

  it("counts the configured floor and excluded accounts as reserved cash", () => {
    expect(reservedCashTotal(baseState())).toBe(600);
  });
});

describe("0% APR payoff recommendation", () => {
  const card: Card = {
    id: "promo-card",
    name: "Promo",
    type: "zero_apr",
    limit: 5_000,
    currentBalance: 900,
    statementBalance: 0,
    minimumDue: 40,
    billingDate: 15,
    dueDate: 10,
    apr: 0,
    zeroAprEndDate: "2026-10-15",
    targetUtilizationPercent: 30,
    preferredCategories: [],
  };

  it("uses remaining statement cycles and never recommends below the minimum", () => {
    const plan = zeroAprPayoffPlan(card, [], REF);

    expect(plan.statementCyclesRemaining).toBeGreaterThan(0);
    expect(plan.recommendedMonthlyPayment).toBeGreaterThanOrEqual(card.minimumDue);
    expect(
      plan.recommendedMonthlyPayment * (plan.statementCyclesRemaining ?? 0),
    ).toBeGreaterThanOrEqual(card.currentBalance);
  });

  it("recommends the full balance after the promotional deadline", () => {
    const plan = zeroAprPayoffPlan({ ...card, zeroAprEndDate: "2026-07-01" }, [], REF);

    expect(plan.recommendedMonthlyPayment).toBe(card.currentBalance);
    expect(plan.statementCyclesRemaining).toBe(0);
  });
});
