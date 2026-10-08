import { describe, expect, it } from "vitest";
import { reducer } from "./reducer";
import { emptyState, type AppState } from "./types";
import {
  expensesComingTotal,
  spendableCash,
  spendableCashBreakdown,
  spendableToday,
  upcomingCardBillItems,
} from "./forecast";
import { pendingCashForAccount } from "./cardPaymentLedger";
import { paymentForBankItem, scanCardPayments } from "../plaid/cardPayments";
import { reconcilePayments } from "../plaid/reconcilePayments";
import type { Connection, InboxItem } from "../plaid/plaid.functions";

const ref = new Date(2026, 9, 6, 12);
const payment = {
  cardId: "td",
  sourceAccountId: "cash",
  amount: 550,
  date: "2026-10-06",
  transactionId: "payment",
};
function fixture(linked = false): AppState {
  return {
    ...emptyState,
    profile: { ...emptyState.profile, safeToSpendFloor: 100 },
    accounts: [
      {
        id: "cash",
        name: linked ? "Checking" : "Cash wallet",
        bankName: "",
        type: linked ? "checking" : "cash",
        balance: 10000,
        bankLinked: linked,
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01",
      },
    ],
    cards: [
      {
        id: "td",
        name: "TD",
        type: "zero_apr",
        limit: 6000,
        currentBalance: 5536.7,
        statementBalance: 0,
        minimumDue: 40,
        billingDate: 11,
        dueDate: 8,
        apr: 22,
        targetUtilizationPercent: 30,
        zeroAprEndDate: "2027-08-11",
        preferredCategories: [],
        bankLinked: linked,
      },
    ],
  };
}
const connections: Connection[] = [
  {
    id: "connection",
    institutionName: "Bank",
    status: "active",
    errorMessage: null,
    lastSyncedAt: "2026-10-10",
    accounts: [
      {
        id: "a",
        accountId: "bank",
        name: "Checking",
        mask: null,
        type: "depository",
        subtype: null,
        currentBalance: 9450,
        availableBalance: 9450,
        limitAmount: null,
        linkedLocalId: "cash",
        linkedLocalKind: "account",
        isActive: true,
      },
      {
        id: "b",
        accountId: "credit",
        name: "TD",
        mask: null,
        type: "credit",
        subtype: null,
        currentBalance: 4986.7,
        availableBalance: null,
        limitAmount: 6000,
        linkedLocalId: "td",
        linkedLocalKind: "card",
        isActive: true,
      },
    ],
  },
];
function bankItem(id: string, card = false, extra: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    plaidAccountId: card ? "credit" : "bank",
    transactionId: id,
    pending: false,
    amount: card ? -550 : 550,
    date: card ? "2026-10-10" : "2026-10-07",
    name: "Card payment",
    merchantName: null,
    plaidCategory: null,
    paymentChannel: null,
    ...extra,
  };
}

describe("card transfer ledger and delayed posting", () => {
  it("reserves a cash payment once, leaves pending debt visible, and never skips the whole bill", () => {
    const before = fixture();
    const planned = upcomingCardBillItems(before, ref)[0];
    const after = reducer(before, {
      type: "PAY_CREDIT_CARD",
      payload: { ...payment, plannedExpenseItemId: planned.id },
    });
    expect(after.accounts[0].balance).toBe(9450);
    expect(after.cards[0].currentBalance).toBe(5536.7);
    expect(after.plannedExpenseOverrides).toEqual([]);
    expect(expensesComingTotal(after, ref)).toBeCloseTo(expensesComingTotal(before, ref) - 550, 2);
    expect(expensesComingTotal(after, ref)).toBeGreaterThan(0);
    expect(spendableToday(after, ref)).toBeCloseTo(spendableToday(before, ref), 2);
    expect(reducer(after, { type: "PAY_CREDIT_CARD", payload: payment })).toBe(after);
  });

  it("applies only the posted amount on a manually tracked card and supports edit/delete", () => {
    const before = fixture();
    const pending = reducer(before, { type: "PAY_CREDIT_CARD", payload: payment });
    const posted = reducer(pending, {
      type: "UPDATE_CARD_PAYMENT",
      id: "payment",
      payload: { ...payment, cashPosted: true, cardPosted: true },
    });
    expect(posted.cards[0].currentBalance).toBe(4986.7);
    expect(posted.accounts[0].balance).toBe(9450);
    const edited = reducer(posted, {
      type: "UPDATE_CARD_PAYMENT",
      id: "payment",
      payload: { ...payment, amount: 500, cashPosted: true, cardPosted: true },
    });
    expect(edited.cards[0].currentBalance).toBe(5036.7);
    expect(edited.accounts[0].balance).toBe(9500);
    const deleted = reducer(edited, { type: "DELETE_TRANSACTION", id: "payment" });
    expect(deleted.cards[0].currentBalance).toBe(before.cards[0].currentBalance);
    expect(deleted.accounts[0].balance).toBe(10000);
    expect(reducer(deleted, { type: "DELETE_TRANSACTION", id: "payment" })).toBe(deleted);
  });

  it("reserves pending bank cash without rewriting the reported account balance", () => {
    const after = reducer(fixture(true), { type: "PAY_CREDIT_CARD", payload: payment });
    expect(after.accounts[0].balance).toBe(10000);
    expect(pendingCashForAccount(after, "cash")).toBe(550);
    expect(spendableCash(after)).toBe(9450);
    expect(
      spendableCashBreakdown(after)
        .flatMap((section) => section.items)
        .reduce((sum, item) => sum + item.amount, 0),
    ).toBe(9450);
    expect(reducer(after, { type: "DELETE_TRANSACTION", id: "payment" }).accounts[0].balance).toBe(
      10000,
    );
  });

  it("confirms staggered bank legs with no second debit or credit, including repeated sync", () => {
    let state = reducer(fixture(true), { type: "PAY_CREDIT_CARD", payload: payment });
    state = reducer(state, { type: "SYNC_ACCOUNT_BALANCE", id: "cash", balance: 9450 });
    const cash = bankItem("debit");
    state = reconcilePayments(state, [cash], connections).reduce(reducer, state);
    expect(state.transactions).toHaveLength(1);
    expect(spendableCash(state)).toBe(9450);
    expect(state.cards[0].currentBalance).toBe(5536.7);
    expect(state.transactions[0].cardPayment).toMatchObject({
      cashPosted: true,
      cardPosted: false,
      bankDebitId: "debit",
    });
    state = reducer(state, { type: "SYNC_CARD_BALANCE", id: "td", balance: 4986.7, limit: 6000 });
    const credit = bankItem("credit", true);
    state = reconcilePayments(state, [cash, credit], connections).reduce(reducer, state);
    expect(state.transactions).toHaveLength(1);
    expect(state.cards[0].currentBalance).toBe(4986.7);
    expect(state.accounts[0].balance).toBe(9450);
    expect(reconcilePayments(state, [cash, credit], connections)).toEqual([]);
    const deleted = reducer(state, { type: "DELETE_TRANSACTION", id: "payment" });
    expect(deleted.cards).toEqual(state.cards);
    expect(deleted.accounts).toEqual(state.accounts);
  });

  it("records the full bank payment even when the refreshed card already has a zero balance", () => {
    const state = fixture(true);
    state.cards[0].currentBalance = 0;
    state.accounts[0].balance = 9450;
    const after = reconcilePayments(
      state,
      [bankItem("debit"), bankItem("credit", true)],
      connections,
    ).reduce(reducer, state);
    expect(after.transactions[0].amount).toBe(550);
    expect(after.transactions[0].cardPayment).toMatchObject({ cashPosted: true, cardPosted: true });
    expect(after.cards[0].currentBalance).toBe(0);
    expect(after.accounts[0].balance).toBe(9450);
  });

  it("rejects pending entries, refunds, ambiguous matches and cent mismatches", () => {
    const state = reducer(fixture(true), { type: "PAY_CREDIT_CARD", payload: payment });
    expect(
      paymentForBankItem(state, bankItem("pending", true, { pending: true }), connections),
    ).toBeNull();
    expect(
      paymentForBankItem(state, bankItem("refund", true, { name: "Store refund" }), connections),
    ).toBeNull();
    const second = reducer(state, {
      type: "PAY_CREDIT_CARD",
      payload: { ...payment, transactionId: "second" },
    });
    expect(paymentForBankItem(second, bankItem("credit", true), connections)).toBeNull();
    expect(
      scanCardPayments(
        [bankItem("debit"), bankItem("credit", true), bankItem("credit2", true)],
        connections,
      ).matched,
    ).toEqual([]);
    expect(
      scanCardPayments(
        [bankItem("debit", false, { amount: 550.01 }), bankItem("credit", true)],
        connections,
      ).matched,
    ).toEqual([]);
  });

  it("restores old payment-created hidden obligations while preserving explicit date/amount edits", () => {
    const state = fixture();
    state.transactions = [
      {
        ...payment,
        id: "old",
        type: "card_payment",
        category: "Credit card bill",
        description: "Payment",
        createdAt: payment.date,
        updatedAt: payment.date,
      },
    ];
    state.plannedExpenseOverrides = [
      {
        id: "bug",
        sourceType: "card_due",
        sourceId: "td:target-paydown:2026-10-11",
        month: "2026-10",
        action: "skip",
      },
      {
        id: "edit",
        sourceType: "card_due",
        sourceId: "td:minimum-due:2026-10-11",
        month: "2026-10",
        action: "override",
        dueDate: "2026-10-09",
      },
    ];
    const after = reducer(state, { type: "HYDRATE", state });
    expect(after.plannedExpenseOverrides.map((item) => item.id)).toEqual(["edit"]);
    // The old skip ID cannot hide the new single-payment schedule.
    expect(expensesComingTotal(after, ref)).toBe(expensesComingTotal(state, ref));
    expect(upcomingCardBillItems(after, ref)[0].dueDate).toBe("2026-10-09");
  });

  it("reclassifies an imported account expense without charging the account again", () => {
    let state = reducer(fixture(true), {
      type: "ADD_EXPENSE",
      payload: {
        amount: 550,
        date: payment.date,
        category: "Other",
        description: "TD PAYMENT",
        sourceAccountId: "cash",
        method: "debit",
        balanceAlreadySynced: true,
      },
    });
    const id = state.transactions[0].id;
    state = reducer(state, { type: "CONVERT_CARD_PAYMENT", id, payload: payment });
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0]).toMatchObject({ id, type: "card_payment", amount: 550 });
    expect(state.accounts[0].balance).toBe(10000);
    expect(state.cards[0].currentBalance).toBe(5536.7);
  });

  it("merges an already-imported expense into an existing transfer with no second charge", () => {
    let state = reducer(fixture(true), { type: "PAY_CREDIT_CARD", payload: payment });
    state = reducer(state, {
      type: "ADD_EXPENSE",
      payload: {
        amount: 550,
        date: payment.date,
        category: "Other",
        sourceAccountId: "cash",
        method: "debit",
        balanceAlreadySynced: true,
      },
    });
    state = reducer(state, {
      type: "CONVERT_CARD_PAYMENT",
      id: state.transactions[0].id,
      payload: payment,
      mergeIntoId: "payment",
    });
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].cardPayment?.cashPosted).toBe(true);
    expect(state.accounts[0].balance).toBe(10000);
    expect(pendingCashForAccount(state, "cash")).toBe(0);
  });

  it("rejects zero, non-finite, sub-cent and invalid-date payments", () => {
    const state = fixture();
    for (const amount of [0, -1, NaN, Infinity, 0.001]) {
      expect(reducer(state, { type: "PAY_CREDIT_CARD", payload: { ...payment, amount } })).toBe(
        state,
      );
    }
    expect(reducer(state, { type: "PAY_CREDIT_CARD", payload: { ...payment, date: "bad" } })).toBe(
      state,
    );
  });

  it("keeps ambiguous bank confirmations in review instead of choosing the first", () => {
    const state = reducer(fixture(true), { type: "PAY_CREDIT_CARD", payload: payment });
    expect(
      reconcilePayments(state, [bankItem("credit1", true), bankItem("credit2", true)], connections),
    ).toEqual([]);
  });

  it("merges a manually tracked expense into a previously reserved payment without releasing the cash", () => {
    let state = reducer(fixture(), {
      type: "PAY_CREDIT_CARD",
      payload: { ...payment, cashPosted: false },
    });
    state = reducer(state, {
      type: "ADD_EXPENSE",
      payload: {
        amount: 550,
        date: payment.date,
        category: "Other",
        sourceAccountId: "cash",
        method: "debit",
      },
    });
    state = reducer(state, {
      type: "CONVERT_CARD_PAYMENT",
      id: state.transactions[0].id,
      payload: payment,
      mergeIntoId: "payment",
    });
    expect(state.transactions).toHaveLength(1);
    expect(state.accounts[0].balance).toBe(9450);
    expect(pendingCashForAccount(state, "cash")).toBe(0);
    expect(reducer(state, { type: "DELETE_TRANSACTION", id: "payment" }).accounts[0].balance).toBe(
      10000,
    );
  });

  it("does not unconfirm bank evidence through an edit", () => {
    let state = reducer(fixture(true), { type: "PAY_CREDIT_CARD", payload: payment });
    state = reducer(state, {
      type: "RECONCILE_CARD_PAYMENT",
      id: "payment",
      leg: "card",
      bankId: "credit",
    });
    state = reducer(state, {
      type: "UPDATE_CARD_PAYMENT",
      id: "payment",
      payload: { ...payment, cardPosted: false },
    });
    expect(state.transactions[0].cardPayment?.cardPosted).toBe(true);
    expect(state.transactions[0].cardPayment?.bankCreditId).toBe("credit");
  });
});
