import { describe, expect, it } from "vitest";
import { expensesComingBreakdown, expensesComingTotal, spendableToday } from "./forecast";
import { reducer } from "./reducer";
import { addMonths, fromISODate } from "./dates";
import { type AppState, emptyState } from "./types";

function stateWithOverdueBill(): AppState {
  return {
    ...emptyState,
    profile: { ...emptyState.profile, safeToSpendFloor: 100 },
    accounts: [
      {
        id: "checking",
        bankName: "Bank",
        name: "Checking",
        type: "checking",
        balance: 5_000,
        availableForSpending: true,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    recurringBills: [
      {
        id: "rent",
        startMonth: "2026-08",
        name: "Rent",
        amount: 1_200,
        dueDay: 5,
        paymentMethod: "account",
        accountId: "checking",
        active: true,
      },
    ],
  };
}

describe("Overdue expenses in Expenses coming breakdown", () => {
  it("keeps a past-due bill visible and marks it overdue", () => {
    const ref = new Date(2026, 7, 12); // Aug 12, bill due Aug 5
    const sections = expensesComingBreakdown(stateWithOverdueBill(), ref, "this_month");
    const billsSection = sections.find((section) => section.title === "Bills");
    const rent = billsSection?.items.find((item) => item.label === "Rent");

    expect(rent).toBeDefined();
    expect(rent?.isOverdue).toBe(true);
    expect(rent?.dueDate).toBe("2026-08-05");
  });

  it("does not mark a future-due bill as overdue", () => {
    const ref = new Date(2026, 7, 3); // Aug 3, bill due Aug 5
    const sections = expensesComingBreakdown(stateWithOverdueBill(), ref, "this_month");
    const billsSection = sections.find((section) => section.title === "Bills");
    const rent = billsSection?.items.find((item) => item.label === "Rent");

    expect(rent).toBeDefined();
    expect(rent?.isOverdue).toBeFalsy();
    expect(rent?.dueDate).toBe("2026-08-05");
  });

  it("includes a past-due bill even in next_30_days period", () => {
    const ref = new Date(2026, 7, 12); // Aug 12, bill due Aug 5
    const sections = expensesComingBreakdown(stateWithOverdueBill(), ref, "next_30_days");
    const billsSection = sections.find((section) => section.title === "Bills");
    const rent = billsSection?.items.find((item) => item.label === "Rent");

    expect(rent).toBeDefined();
    expect(rent?.isOverdue).toBe(true);
  });

  it("carries each unpaid occurrence across months until that occurrence is marked paid", () => {
    const state = stateWithOverdueBill();
    state.recurringBills[0].startMonth = "2026-08";
    state.plannedExpenseOverrides = [
      {
        id: "one",
        sourceType: "one_time",
        month: "2026-09",
        action: "add",
        name: "One-time bill",
        amount: 25.25,
        dueDate: "2026-09-22",
      },
    ];
    const ref = new Date(2026, 9, 7);
    const items = expensesComingBreakdown(state, ref).flatMap((section) => section.items);
    expect(
      items
        .filter((item) => item.sourceId === "rent")
        .map((item) => [item.occurrenceMonth, item.dueDate, item.isOverdue]),
    ).toEqual([
      ["2026-08", "2026-08-05", true],
      ["2026-09", "2026-09-05", true],
      ["2026-10", "2026-10-05", true],
    ]);
    expect(items.find((item) => item.id === "one")?.isOverdue).toBe(true);
    expect(expensesComingTotal(state, ref)).toBe(3625.25);
    const paid = reducer(state, {
      type: "MARK_PLANNED_EXPENSE_PAID",
      payload: {
        sourceType: "recurring_bill",
        sourceId: "rent",
        month: "2026-09",
      },
    });
    const paidOneTime = reducer(paid, {
      type: "MARK_PLANNED_EXPENSE_PAID",
      payload: {
        sourceType: "one_time",
        overrideId: "one",
        month: "2026-09",
      },
    });
    expect(expensesComingTotal(paidOneTime, ref)).toBe(2400);
    expect(
      expensesComingBreakdown(paidOneTime, ref, "next_30_days")
        .flatMap((section) => section.items)
        .filter((item) => item.sourceId === "rent")
        .map((item) => item.occurrenceMonth),
    ).toEqual(["2026-08", "2026-10", "2026-11"]);
    expect(spendableToday(paidOneTime, ref)).toBeGreaterThan(spendableToday(state, ref));
  });

  it("does not invent old months for a bill newly added to the profile", () => {
    const base = stateWithOverdueBill();
    base.recurringBills = [];
    const created = reducer(base, {
      type: "ADD_RECURRING",
      payload: {
        name: "Phone",
        amount: 42,
        dueDay: 5,
        paymentMethod: "account",
        accountId: "checking",
        active: true,
        startMonth: "2026-10",
      },
    });
    const items = expensesComingBreakdown(created, new Date(2026, 9, 7)).flatMap(
      (section) => section.items,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ occurrenceMonth: "2026-10", isOverdue: true });
  });

  it("saves a starting month for older bill records so missed months do not disappear later", () => {
    const hydrated = reducer(stateWithOverdueBill(), {
      type: "HYDRATE",
      state: stateWithOverdueBill(),
    });
    const startMonth = hydrated.recurringBills[0].startMonth;
    expect(startMonth).toMatch(/^\d{4}-\d{2}$/);
    const later = addMonths(fromISODate(`${startMonth}-01`), 2);
    const overdue = expensesComingBreakdown(hydrated, later)
      .flatMap((section) => section.items)
      .find((item) => item.occurrenceMonth === startMonth);
    expect(overdue?.isOverdue).toBe(true);
  });
});
