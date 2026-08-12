import { describe, expect, it } from "vitest";
import { expensesComingBreakdown } from "./forecast";
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
});
