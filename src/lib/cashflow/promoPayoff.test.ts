import { describe, expect, it } from "vitest";
import { projectPromoPayoff } from "./promoPayoff";
import {
  expensesComingBreakdown,
  expensesComingTotal,
  leftToSpendBreakdown,
  pendingIncome,
  spendableCash,
  spendableToday,
  upcomingCardBillItems,
} from "./forecast";
import { zeroAprPayoffPlan } from "./forecastView";
import { reducer } from "./reducer";
import { assignablePlannedExpenses } from "./activityAssignment";
import { emptyState, type AppState, type Card } from "./types";

const ref = new Date(2026, 9, 7, 12);
const card: Card = {
  id: "promo",
  name: "Promo",
  type: "zero_apr",
  limit: 10000,
  currentBalance: 5000,
  statementBalance: 0,
  minimumDue: 40,
  billingDate: 1,
  dueDate: 8,
  apr: 22,
  zeroAprEndDate: "2027-07-09",
  zeroAprPaymentMode: "fixed",
  zeroAprMonthlyPayment: 500,
  zeroAprExpectedMonthlySpend: 0,
  targetUtilizationPercent: 30,
  preferredCategories: [],
};
const state = (): AppState => ({
  ...emptyState,
  profile: { ...emptyState.profile, safeToSpendFloor: 100 },
  cards: [card],
  accounts: [
    {
      id: "cash",
      name: "Checking",
      bankName: "",
      type: "checking",
      balance: 10000,
      createdAt: "2026-10-01",
      updatedAt: "2026-10-01",
    },
  ],
});

describe("0% card payoff plan", () => {
  it("pays $5,000 with ten $500 payments and no utilization payment alongside it", () => {
    const plan = projectPromoPayoff(card, ref, card.zeroAprEndDate!);
    expect(plan.payments).toHaveLength(10);
    expect(plan.payments.map((p) => p.amount)).toEqual(Array(10).fill(500));
    expect(plan.projectedBalanceAtDeadline).toBe(0);
    expect(plan.payoffDate).toBe("2027-07-08");
    const upcoming = upcomingCardBillItems(state(), ref);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ amount: 500, dueDate: "2026-10-08" });
    expect(expensesComingBreakdown(state(), ref)[0].items).toHaveLength(1);
    expect(expensesComingTotal(state(), ref)).toBe(500);
  });

  it("recomputes after new spending, and quotes the monthly increase or lump sum", () => {
    const spending = { ...card, zeroAprExpectedMonthlySpend: 100 };
    const plan = projectPromoPayoff(spending, ref, spending.zeroAprEndDate!);
    expect(plan.projectedBalanceAtDeadline).toBe(1000);
    expect(plan.requiredMonthlyPayment).toBe(600);
    expect(plan.additionalMonthlyNeeded).toBe(100);
    expect(plan.lumpSumNeeded).toBe(1000);
    const synced = { ...spending, currentBalance: 5500 };
    expect(projectPromoPayoff(synced, ref, synced.zeroAprEndDate!).projectedBalanceAtDeadline).toBe(
      1500,
    );
    const nextState = reducer(
      { ...state(), cards: [spending] },
      {
        type: "SYNC_CARD_BALANCE",
        id: card.id,
        balance: 5500,
        limit: card.limit,
      },
    );
    expect(nextState.cards[0].zeroAprMonthlyPayment).toBe(500);
    expect(zeroAprPayoffPlan(nextState.cards[0], [], ref).projectedBalanceAtDeadline).toBe(1500);
  });

  it("uses the minimum when larger, caps the final installment, and clamps the due day", () => {
    const special = {
      ...card,
      currentBalance: 100.01,
      minimumDue: 70,
      zeroAprMonthlyPayment: 50,
      dueDate: 31,
      zeroAprEndDate: "2026-11-30",
    };
    const plan = projectPromoPayoff(special, ref, special.zeroAprEndDate!);
    expect(plan.payments.map(({ date, amount }) => ({ date, amount }))).toEqual([
      { date: "2026-10-31", amount: 70 },
      { date: "2026-11-30", amount: 30.01 },
    ]);
    expect(
      projectPromoPayoff({ ...special, zeroAprEndDate: "2026-10-30" }, ref, "2026-10-30")
        .projectedBalanceAtDeadline,
    ).toBe(100.01);
  });

  it("counts a planned card bill within the forecast payment once and protects safety cash", () => {
    const s = state();
    s.recurringBills = [
      {
        id: "phone",
        startMonth: "2026-10",
        name: "Phone",
        amount: 80,
        dueDay: 7,
        paymentMethod: "card",
        accountId: "",
        cardId: card.id,
        active: true,
      },
    ];
    const bill = expensesComingBreakdown(s, ref).flatMap((section) => section.items);
    expect(bill.filter((item) => item.sourceType === "card_due")).toHaveLength(1);
    expect(
      bill.filter((item) => item.label === "Phone" && item.includedInCardPayment),
    ).toHaveLength(1);
    expect(
      bill.reduce((sum, item) => sum + (item.includedInCardPayment ? 0 : item.amount), 0),
    ).toBe(expensesComingTotal(s, ref));
    expect(expensesComingTotal(s, ref)).toBe(500);
    const nextDay = new Date(2026, 9, 8);
    expect(
      expensesComingBreakdown(s, nextDay)
        .flatMap((section) => section.items)
        .find((item) => item.label === "Phone")?.isOverdue,
    ).toBe(true);
    expect(
      assignablePlannedExpenses(s, {
        id: "charge",
        type: "expense",
        amount: 80,
        description: "Phone",
        date: "2026-10-08",
        category: "Bills",
        cardId: card.id,
        createdAt: "2026-10-08",
        updatedAt: "2026-10-08",
      }).some((item) => item.label === "Phone" && item.amount === 80),
    ).toBe(true);
    expect(leftToSpendBreakdown(s, ref)[0].items.reduce((sum, item) => sum + item.amount, 0)).toBe(
      spendableCash(s) + pendingIncome(s, ref) - expensesComingTotal(s, ref),
    );
    expect(spendableToday(s, ref)).toBeLessThan(spendableToday({ ...s, cards: [] }, ref));
  });

  it("retains an unpaid installment after its due date without reserving the balance twice", () => {
    const s = state();
    s.cards = [{ ...card, paymentScheduleStartDate: "2026-10-07" }];
    const late = new Date(2026, 9, 9, 12);
    const due = expensesComingBreakdown(s, late)
      .flatMap((section) => section.items)
      .filter((item) => item.sourceType === "card_due");
    expect(due[0]).toMatchObject({ dueDate: "2026-10-08", amount: 500, isOverdue: true });
    expect(expensesComingTotal(s, late)).toBe(500);
    const next = expensesComingBreakdown(s, new Date(2026, 10, 7, 12))
      .flatMap((section) => section.items)
      .filter((item) => item.sourceType === "card_due");
    expect(next.map((item) => [item.dueDate, item.amount])).toEqual([
      ["2026-10-08", 500],
      ["2026-11-08", 500],
    ]);
    const paid = reducer(s, {
      type: "PAY_CREDIT_CARD",
      payload: {
        cardId: card.id,
        sourceAccountId: "cash",
        amount: 500,
        date: "2026-10-09",
        plannedExpenseItemId: "promo:fixed:2026-10-08",
      },
    });
    expect(
      expensesComingBreakdown(paid, late)
        .flatMap((section) => section.items)
        .filter((item) => item.sourceType === "card_due"),
    ).toHaveLength(0);
    expect(spendableToday(paid, late)).toBeCloseTo(spendableToday(s, late), 2);
  });

  it("includes a known bill beyond the monthly estimate and forecasts a new charge from zero", () => {
    const s = state();
    s.cards = [{ ...card, currentBalance: 0, zeroAprExpectedMonthlySpend: 20 }];
    s.recurringBills = [
      {
        id: "phone",
        startMonth: "2026-10",
        name: "Phone",
        amount: 80,
        dueDay: 7,
        paymentMethod: "card",
        accountId: "",
        cardId: card.id,
        active: true,
      },
    ];
    expect(upcomingCardBillItems(s, ref)[0].amount).toBe(80);
    expect(expensesComingTotal(s, ref)).toBe(80);
    const projected = projectPromoPayoff(s.cards[0], ref, "2026-10-08", [
      { date: "2026-10-07", amount: 80 },
    ]);
    expect(projected.payments[0].amount).toBe(80);
  });

  it("switches to utilization instead of adding it to the fixed payment", () => {
    const s = state();
    s.cards = [{ ...card, zeroAprPaymentMode: "utilization" }];
    expect(upcomingCardBillItems(s, ref)).toHaveLength(1);
    expect(upcomingCardBillItems(s, ref)[0].amount).toBe(2000);
    expect(zeroAprPayoffPlan(s.cards[0], [], ref).paymentMode).toBe("utilization");
  });
});
