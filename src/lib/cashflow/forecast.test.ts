import { describe, expect, it } from "vitest";
import { spendableToday, spendableTodayBreakdown } from "./forecast";
import { type AppState, emptyState } from "./types";

const REF = new Date(2026, 6, 25);

function stateWithCash(balance = 5_000): AppState {
  return {
    ...emptyState,
    profile: { ...emptyState.profile, safeToSpendFloor: 100 },
    accounts: [
      {
        id: "checking",
        bankName: "Bank",
        name: "Checking",
        type: "checking",
        balance,
        availableForSpending: true,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    cards: [],
    debts: [],
    jobs: [],
    timesheet: [],
    transactions: [],
    recurringBills: [],
    categories: [...emptyState.categories],
    plannedExpenseOverrides: [],
    plannedIncomeOverrides: [],
  };
}

function monthlyRentState(): AppState {
  const state = stateWithCash();
  return {
    ...state,
    recurringBills: [
      {
        id: "rent",
        name: "Rent",
        amount: 500,
        dueDay: 4,
        paymentMethod: "account",
        accountId: "checking",
        active: true,
      },
    ],
  };
}

describe("Spendable today safety invariants", () => {
  it("does not change with the dashboard display filter", () => {
    const state = monthlyRentState();

    expect(spendableToday(state, REF, "this_month")).toBe(2_900);
    expect(spendableToday(state, REF, "next_30_days")).toBe(2_900);
    expect(spendableToday(state, REF, "next_6_months")).toBe(2_900);
  });

  it("leaves the safety floor intact when the displayed amount is spent today", () => {
    const state = monthlyRentState();
    const safeAmount = spendableToday(state, REF);
    const withPurchase: AppState = {
      ...state,
      plannedExpenseOverrides: [
        {
          id: "purchase",
          sourceType: "one_time",
          month: "2026-07",
          action: "add",
          name: "Spendable purchase",
          amount: safeAmount,
          dueDate: "2026-07-25",
          paymentMethod: "account",
          accountId: "checking",
        },
      ],
    };

    expect(spendableToday(withPurchase, REF)).toBe(0);
    expect(
      spendableToday(
        {
          ...withPurchase,
          plannedExpenseOverrides: [
            { ...withPurchase.plannedExpenseOverrides[0], amount: safeAmount + 1 },
          ],
        },
        REF,
      ),
    ).toBe(-1);
  });

  it("carries an unpaid past-due bill into today's protection timeline", () => {
    const sections = spendableTodayBreakdown(monthlyRentState(), REF);
    const timeline = sections.find((section) => section.title === "Timeline used");
    const overdueRent = timeline?.items.find(
      (item) => item.label === "Rent" && item.detail?.includes("past due, protected today"),
    );

    expect(overdueRent).toBeDefined();
    expect(overdueRent?.detail).toContain("July 25, 2026");
  });

  it("protects card-funded planned bills once at the card payment date", () => {
    const state = stateWithCash();
    state.cards = [
      {
        id: "card",
        name: "Card",
        type: "regular",
        limit: 10_000,
        currentBalance: 0,
        statementBalance: 0,
        minimumDue: 0,
        billingDate: 18,
        dueDate: 12,
        apr: 20,
        targetUtilizationPercent: 30,
        preferredCategories: [],
        defaultPaymentAccountId: "checking",
      },
    ];
    state.recurringBills = [
      {
        id: "subscription",
        name: "Subscription",
        amount: 500,
        dueDay: 4,
        paymentMethod: "card",
        accountId: "",
        cardId: "card",
        active: true,
      },
    ];

    expect(spendableToday(state, REF)).toBe(3_400);
  });

  it("never schedules more debt payments than the remaining debt balance", () => {
    const state = stateWithCash();
    state.debts = [
      {
        id: "debt",
        name: "Debt",
        balance: 1_750,
        minimumPayment: 875,
        dueDate: 10,
        status: "active",
        payoffMode: "minimum",
        defaultPaymentAccountId: "checking",
      },
    ];

    expect(spendableToday(state, REF)).toBe(3_150);
    const timeline = spendableTodayBreakdown(state, REF).find(
      (section) => section.title === "Timeline used",
    );
    const debtTotal =
      timeline?.items
        .filter((item) => item.label === "Debt")
        .reduce((sum, item) => sum + Math.abs(item.amount), 0) ?? 0;
    expect(debtTotal).toBe(1_750);
  });

  it("does not treat auto-planned part-time shifts as guaranteed spending money", () => {
    const state = stateWithCash(500);
    state.jobs = [
      {
        id: "part-time",
        name: "Weekend job",
        type: "part_time",
        netHourlyRate: 20,
        netPaycheckAmount: 0,
        payFrequency: "weekly",
        paydayWeekday: 6,
        scheduledWeekdays: [5],
        scheduledHoursPerShift: 8,
        defaultDepositAccountId: "checking",
      },
    ];

    expect(spendableToday(state, REF)).toBe(400);
    const assumptions = spendableTodayBreakdown(state, REF).find(
      (section) => section.title === "Forecast assumptions",
    );
    expect(assumptions?.items.find((item) => item.label === "Income included")?.detail).toContain(
      "excluded until the work is entered",
    );
  });

  it("warns when a selected payment account is short even if total cash is sufficient", () => {
    const state = monthlyRentState();
    state.accounts = [
      { ...state.accounts[0], balance: 100 },
      {
        ...state.accounts[0],
        id: "savings",
        name: "Savings",
        balance: 4_900,
      },
    ];

    expect(spendableToday(state, REF)).toBe(2_900);
    const warnings = spendableTodayBreakdown(state, REF).find(
      (section) => section.title === "Account funding warnings",
    );
    expect(warnings?.items[0]?.label).toBe("Checking");
    expect(warnings?.items[0]?.detail).toContain("Move money before this payment");
  });
});
