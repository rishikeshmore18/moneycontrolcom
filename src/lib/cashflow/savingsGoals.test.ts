import { describe, expect, it } from "vitest";
import { reducer } from "./reducer";
import { emptyState, type AppState } from "./types";
import {
  expensesComingBreakdown,
  expensesComingTotal,
  spendableCash,
  spendableToday,
} from "./forecast";
import {
  goalAvailable,
  goalBalanceInAccount,
  goalPlanProgress,
  goalUnfundedAmount,
} from "./savingsGoals";

const date = "2026-10-08";
const ref = new Date(2026, 9, 8, 12);
function fixture(): AppState {
  return {
    ...emptyState,
    accounts: [
      {
        id: "checking",
        name: "Checking",
        bankName: "Bank",
        type: "checking",
        balance: 2000,
        availableForSpending: true,
        bankLinked: true,
        createdAt: date,
        updatedAt: date,
      },
      {
        id: "reserve",
        name: "Trip bank",
        bankName: "Bank",
        type: "savings",
        balance: 1000,
        availableForSpending: false,
        bankLinked: true,
        createdAt: date,
        updatedAt: date,
      },
      {
        id: "wallet",
        name: "Cash",
        bankName: "",
        type: "cash",
        balance: 300,
        availableForSpending: true,
        createdAt: date,
        updatedAt: date,
      },
    ],
    cards: [
      {
        id: "card",
        name: "Travel card",
        type: "regular",
        limit: 5000,
        currentBalance: 600,
        statementBalance: 600,
        minimumDue: 25,
        billingDate: 11,
        dueDate: 20,
        apr: 20,
        targetUtilizationPercent: 30,
        preferredCategories: [],
      },
    ],
  };
}
function goalState(): AppState {
  let state = reducer(fixture(), {
    type: "ADD_SAVINGS_GOAL",
    payload: { name: "Trip", targetAmount: 1800, targetDate: "2027-05-01" },
  });
  const goalId = state.savingsGoals![0].id;
  state = reducer(state, {
    type: "ALLOCATE_GOAL",
    goalId,
    accountId: "checking",
    amount: 200,
    date,
  });
  state = reducer(state, {
    type: "ALLOCATE_GOAL",
    goalId,
    accountId: "reserve",
    amount: 400,
    date,
  });
  state = reducer(state, { type: "ALLOCATE_GOAL", goalId, accountId: "wallet", amount: 100, date });
  return state;
}

describe("savings goals keep cash, card obligations and location in sync", () => {
  it("tracks weekly and monthly contributions without treating a plan as cash or an upcoming bill", () => {
    let state = reducer(fixture(), {
      type: "ADD_SAVINGS_GOAL",
      payload: { name: "Car repairs", plan: { cadence: "weekly", amount: 75 } },
    });
    const id = state.savingsGoals![0].id;
    const before = spendableCash(state);
    const bills = expensesComingTotal(state, ref);
    expect(spendableCash(state)).toBe(before);
    expect(expensesComingTotal(state, ref)).toBe(bills);
    state = reducer(state, {
      type: "ALLOCATE_GOAL",
      goalId: id,
      accountId: "checking",
      amount: 40,
      date: "2026-10-08",
    });
    state = reducer(state, {
      type: "ALLOCATE_GOAL",
      goalId: id,
      accountId: "wallet",
      amount: 35,
      date: "2026-10-09",
    });
    expect(goalPlanProgress(state, state.savingsGoals![0], "2026-10-11")?.remaining).toBe(0);
    state = reducer(state, {
      type: "RELEASE_GOAL",
      goalId: id,
      accountId: "wallet",
      amount: 10,
      date: "2026-10-10",
    });
    expect(goalPlanProgress(state, state.savingsGoals![0], "2026-10-11")?.remaining).toBe(10);
    expect(goalPlanProgress(state, state.savingsGoals![0], "2026-10-12")?.remaining).toBe(75);
    expect(expensesComingTotal(state, ref)).toBe(bills);
    state = reducer(state, {
      type: "UPDATE_SAVINGS_GOAL",
      id,
      payload: { name: "Car repairs", plan: { cadence: "monthly", amount: 100 } },
    });
    expect(goalPlanProgress(state, state.savingsGoals![0], "2026-10-31")?.remaining).toBe(35);
    expect(goalPlanProgress(state, state.savingsGoals![0], "2026-11-01")?.remaining).toBe(100);
  });

  it("keeps a one-time target separate and estimates a dated recurring target as a plan only", () => {
    let state = reducer(fixture(), {
      type: "ADD_SAVINGS_GOAL",
      payload: { name: "Trip", plan: { cadence: "lump_sum" }, targetAmount: 500 },
    });
    expect(goalPlanProgress(state, state.savingsGoals![0], date)).toBeNull();
    const id = state.savingsGoals![0].id;
    state = reducer(state, {
      type: "UPDATE_SAVINGS_GOAL",
      id,
      payload: {
        name: "Trip",
        plan: { cadence: "weekly", amount: 50 },
        targetAmount: 500,
        targetDate: "2026-10-18",
      },
    });
    const progress = goalPlanProgress(state, state.savingsGoals![0], "2026-10-08");
    expect(progress?.estimatedAtDeadline).toBe(100);
    expect(spendableCash(state)).toBe(spendableCash(fixture()));
    expect(
      reducer(state, {
        type: "UPDATE_SAVINGS_GOAL",
        id,
        payload: { name: "Trip", plan: { cadence: "monthly", amount: -5 } },
      }),
    ).toBe(state);
  });
  it("earmarks bank and cash without creating money and refuses over allocation", () => {
    const state = goalState();
    const goal = state.savingsGoals![0];
    expect(spendableCash(state)).toBe(2000);
    expect(state.accounts.map((account) => account.balance)).toEqual([2000, 1000, 300]);
    expect(goalBalanceInAccount(goal, "reserve")).toBe(400);
    expect(goalBalanceInAccount(goal, "wallet")).toBe(100);
    expect(
      reducer(state, {
        type: "ALLOCATE_GOAL",
        goalId: goal.id,
        accountId: "wallet",
        amount: 201,
        date,
      }),
    ).toBe(state);
    expect(
      reducer(state, {
        type: "RELEASE_GOAL",
        goalId: goal.id,
        accountId: "reserve",
        amount: 401,
        date,
      }),
    ).toBe(state);
  });

  it("keeps a card purchase due and offsets only its saved portion once", () => {
    const base = goalState();
    const goalId = base.savingsGoals![0].id;
    const before = expensesComingTotal(base, ref);
    const state = reducer(base, {
      type: "ADD_EXPENSE",
      payload: {
        amount: 300,
        category: "Travel",
        description: "Hotel",
        date,
        method: "credit_card",
        cardId: "card",
        savingsGoalId: goalId,
      },
    });
    expect(goalAvailable(state, state.savingsGoals![0])).toBe(400);
    expect(state.cards[0].currentBalance).toBe(900);
    expect(
      expensesComingBreakdown(state, ref)
        .find((section) => section.title === "Covered by savings goals")
        ?.items.reduce((sum, item) => sum + item.amount, 0),
    ).toBe(-300);
    expect(expensesComingTotal(state, ref)).toBe(before);
    expect(spendableToday(state, ref)).toBeCloseTo(spendableToday(base, ref), 2);
  });

  it("moves a saved amount to checking, pays from it, and reverses activity safely", () => {
    let state = goalState();
    const goalId = state.savingsGoals![0].id;
    state = reducer(state, {
      type: "ADD_EXPENSE",
      payload: {
        amount: 300,
        category: "Travel",
        description: "Hotel",
        date,
        method: "credit_card",
        cardId: "card",
        savingsGoalId: goalId,
      },
    });
    state = reducer(state, {
      type: "ADD_TRANSFER",
      payload: {
        fromAccountId: "reserve",
        toAccountId: "checking",
        amount: 300,
        date,
        savingsGoalId: goalId,
      },
    });
    const transfer = state.transactions.find((tx) => tx.type === "transfer")!;
    expect(goalBalanceInAccount(state.savingsGoals![0], "reserve")).toBe(100);
    expect(goalBalanceInAccount(state.savingsGoals![0], "checking")).toBe(500);
    expect(state.accounts[0].balance).toBe(2000); // Bank sync is authoritative.
    const beforePayment = spendableCash(state);
    state = reducer(state, {
      type: "PAY_CREDIT_CARD",
      payload: {
        cardId: "card",
        amount: 300,
        sourceAccountId: "checking",
        date,
        savingsGoalId: goalId,
        savingsGoalAmount: 300,
      },
    });
    const payment = state.transactions.find((tx) => tx.type === "card_payment")!;
    expect(goalBalanceInAccount(state.savingsGoals![0], "checking")).toBe(200);
    expect(spendableCash(state)).toBe(beforePayment); // Pending debit replaces its goal reserve.
    state = reducer(state, { type: "DELETE_TRANSACTION", id: payment.id });
    expect(goalBalanceInAccount(state.savingsGoals![0], "checking")).toBe(500);
    state = reducer(state, { type: "DELETE_TRANSACTION", id: transfer.id });
    expect(goalBalanceInAccount(state.savingsGoals![0], "reserve")).toBe(400);
  });

  it("caps protection to the latest synced bank balance and identifies the gap", () => {
    const state = goalState();
    const synced = reducer(state, { type: "SYNC_ACCOUNT_BALANCE", id: "checking", balance: 100 });
    expect(spendableCash(synced)).toBe(200);
    expect(goalUnfundedAmount(synced)).toBe(100);
    const goalId = synced.savingsGoals![0].id;
    expect(
      reducer(synced, {
        type: "ADD_EXPENSE",
        payload: {
          amount: 150,
          category: "Travel",
          date,
          method: "debit",
          sourceAccountId: "checking",
          savingsGoalId: goalId,
        },
      }),
    ).toBe(synced);
  });

  it("assigns a synced card purchase after review without changing the bank card balance", () => {
    let state = goalState();
    const goalId = state.savingsGoals![0].id;
    state = reducer(state, {
      type: "ADD_EXPENSE",
      payload: {
        amount: 80,
        category: "Travel",
        description: "Train",
        date,
        method: "credit_card",
        cardId: "card",
        balanceAlreadySynced: true,
      },
    });
    const expense = state.transactions[0];
    const balance = state.cards[0].currentBalance;
    const change = {
      id: expense.id,
      amount: 80,
      category: "Travel",
      description: "Train",
      date,
      cardId: "card",
    };
    state = reducer(state, {
      type: "UPDATE_TRANSACTION",
      payload: { ...change, savingsGoalId: goalId },
    });
    expect(state.transactions[0].savingsGoalId).toBe(goalId);
    expect(state.cards[0].currentBalance).toBe(balance);
    state = reducer(state, { type: "UPDATE_TRANSACTION", payload: change });
    expect(state.transactions[0].savingsGoalId).toBeUndefined();
    expect(state.cards[0].currentBalance).toBe(balance);
  });
});
