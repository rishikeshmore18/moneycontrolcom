import {
  Account,
  AppState,
  Card,
  DEFAULT_CATEGORIES,
  Debt,
  Job,
  PlannedExpenseOverride,
  PlannedIncomeOverride,
  RecurringBill,
  TimesheetEntry,
  Transaction,
  emptyState,
} from "./types";
import { clampNonNegative } from "./money";
import { newId, todayISO } from "./dates";
import { cycleForDate, expensesInCycle } from "./cardLogic";
import { upcomingCardBillItems } from "./forecast";

export type Action =
  | { type: "HYDRATE"; state: AppState }
  | { type: "RESET" }
  | { type: "COMPLETE_ONBOARDING"; payload: Partial<AppState> }
  | { type: "UPDATE_PROFILE"; payload: Partial<AppState["profile"]> }
  | { type: "ADD_ACCOUNT"; payload: Omit<Account, "id" | "createdAt" | "updatedAt"> }
  | { type: "UPDATE_ACCOUNT"; payload: Account }
  | { type: "DELETE_ACCOUNT"; id: string }
  | { type: "ADD_CARD"; payload: Omit<Card, "id"> }
  | { type: "UPDATE_CARD"; payload: Card }
  | { type: "DELETE_CARD"; id: string }
  | { type: "ADD_DEBT"; payload: Omit<Debt, "id"> }
  | { type: "UPDATE_DEBT"; payload: Debt }
  | { type: "DELETE_DEBT"; id: string }
  | { type: "ADD_JOB"; payload: Omit<Job, "id"> }
  | { type: "UPDATE_JOB"; payload: Job }
  | { type: "DELETE_JOB"; id: string }
  | { type: "ADD_RECURRING"; payload: Omit<RecurringBill, "id"> }
  | { type: "UPDATE_RECURRING"; payload: RecurringBill }
  | { type: "DELETE_RECURRING"; id: string }
  | { type: "ADD_CATEGORY"; category: string }
  | { type: "ADD_PLANNED_EXPENSE_OVERRIDE"; payload: Omit<PlannedExpenseOverride, "id"> }
  | { type: "UPDATE_PLANNED_EXPENSE_OVERRIDE"; payload: PlannedExpenseOverride }
  | { type: "DELETE_PLANNED_EXPENSE_OVERRIDE"; id: string }
  | { type: "ADD_PLANNED_INCOME_OVERRIDE"; payload: Omit<PlannedIncomeOverride, "id"> }
  | { type: "UPDATE_PLANNED_INCOME_OVERRIDE"; payload: PlannedIncomeOverride }
  | { type: "DELETE_PLANNED_INCOME_OVERRIDE"; id: string }
  | {
      type: "UPDATE_TRANSACTION";
      payload: {
        id: string;
        amount: number;
        category: string;
        description: string;
        date: string;
        notes?: string;
        sourceAccountId?: string;
        cardId?: string;
      };
    }
  | {
      type: "ADD_EXPENSE";
      payload: {
        amount: number;
        category: string;
        description?: string;
        date: string;
        method: "credit_card" | "debit" | "cash" | "other";
        sourceAccountId?: string;
        cardId?: string;
      };
    }
  | {
      type: "PAY_CREDIT_CARD";
      payload: {
        cardId: string;
        amount: number;
        sourceAccountId: string;
        date: string;
        notes?: string;
        plannedExpenseItemId?: string;
      };
    }
  | {
      type: "PAY_DEBT";
      payload: {
        debtId: string;
        amount: number;
        sourceAccountId: string;
        date: string;
        notes?: string;
      };
    }
  | {
      type: "ADD_TRANSFER";
      payload: {
        fromAccountId: string;
        toAccountId: string;
        amount: number;
        date: string;
        notes?: string;
      };
    }
  | {
      type: "ADD_ADJUSTMENT";
      payload: {
        accountId?: string;
        cardId?: string;
        newBalance: number;
        reason: string;
        notes?: string;
        date: string;
      };
    }
  | { type: "UPSERT_TIMESHEET"; payload: TimesheetEntry }
  | { type: "DELETE_TIMESHEET"; id: string }
  | {
      type: "MARK_TIMESHEET_PAID";
      payload: { id: string; paidAccountId: string; actualAmount: number; date?: string };
    }
  | { type: "UNMARK_TIMESHEET_PAID"; payload: { id: string } };

function now(): string {
  return new Date().toISOString();
}

function monthFromISO(date: string): string {
  return date.slice(0, 7);
}

function updateAccount(state: AppState, id: string, delta: number): Account[] {
  return state.accounts.map((a) =>
    a.id === id ? { ...a, balance: a.balance + delta, updatedAt: now() } : a,
  );
}

function addTx(
  state: AppState,
  tx: Omit<Transaction, "id" | "createdAt" | "updatedAt">,
): Transaction[] {
  const full: Transaction = {
    ...tx,
    id: newId(),
    createdAt: now(),
    updatedAt: now(),
  };
  return [full, ...state.transactions];
}

function cleanCategory(category: string): string {
  return category.trim();
}

function mergeCategories(...groups: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  groups
    .flatMap((group) => group ?? [])
    .forEach((category) => {
      const clean = cleanCategory(category);
      if (!clean) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(clean);
    });
  return result;
}

function normalizeState(state: AppState): AppState {
  return {
    ...state,
    categories: mergeCategories(
      DEFAULT_CATEGORIES,
      state.categories,
      state.transactions?.map((t) => t.category),
      state.cards?.flatMap((c) => c.preferredCategories),
      state.plannedExpenseOverrides?.map((p) => p.category ?? ""),
    ),
    plannedExpenseOverrides: state.plannedExpenseOverrides ?? [],
    plannedIncomeOverrides: state.plannedIncomeOverrides ?? [],
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "HYDRATE":
      return normalizeState(action.state);
    case "RESET":
      return { ...emptyState };
    case "COMPLETE_ONBOARDING":
      return normalizeState({ ...state, ...action.payload, onboarded: true });
    case "UPDATE_PROFILE":
      return { ...state, profile: { ...state.profile, ...action.payload } };

    case "ADD_ACCOUNT": {
      const acc: Account = {
        availableForSpending: true,
        ...action.payload,
        id: newId(),
        createdAt: now(),
        updatedAt: now(),
      };
      return { ...state, accounts: [...state.accounts, acc] };
    }
    case "UPDATE_ACCOUNT":
      return {
        ...state,
        accounts: state.accounts.map((a) =>
          a.id === action.payload.id ? { ...action.payload, updatedAt: now() } : a,
        ),
      };
    case "DELETE_ACCOUNT":
      return { ...state, accounts: state.accounts.filter((a) => a.id !== action.id) };

    case "ADD_CARD":
      return { ...state, cards: [...state.cards, { ...action.payload, id: newId() }] };
    case "UPDATE_CARD":
      return {
        ...state,
        cards: state.cards.map((c) => (c.id === action.payload.id ? action.payload : c)),
      };
    case "DELETE_CARD":
      return { ...state, cards: state.cards.filter((c) => c.id !== action.id) };

    case "ADD_DEBT":
      return {
        ...state,
        debts: [...state.debts, { payoffMode: "minimum", ...action.payload, id: newId() }],
      };
    case "UPDATE_DEBT":
      return {
        ...state,
        debts: state.debts.map((d) => (d.id === action.payload.id ? action.payload : d)),
      };
    case "DELETE_DEBT":
      return { ...state, debts: state.debts.filter((d) => d.id !== action.id) };

    case "ADD_JOB":
      return { ...state, jobs: [...state.jobs, { ...action.payload, id: newId() }] };
    case "UPDATE_JOB":
      return {
        ...state,
        jobs: state.jobs.map((j) => (j.id === action.payload.id ? action.payload : j)),
      };
    case "DELETE_JOB":
      return {
        ...state,
        jobs: state.jobs.filter((j) => j.id !== action.id),
        plannedIncomeOverrides: (state.plannedIncomeOverrides ?? []).filter(
          (override) => override.jobId !== action.id,
        ),
      };

    case "ADD_RECURRING":
      return {
        ...state,
        recurringBills: [...state.recurringBills, { ...action.payload, id: newId() }],
      };
    case "UPDATE_RECURRING":
      return {
        ...state,
        recurringBills: state.recurringBills.map((b) =>
          b.id === action.payload.id ? action.payload : b,
        ),
      };
    case "DELETE_RECURRING":
      return {
        ...state,
        recurringBills: state.recurringBills.filter((b) => b.id !== action.id),
        plannedExpenseOverrides: (state.plannedExpenseOverrides ?? []).filter(
          (override) =>
            !(override.sourceType === "recurring_bill" && override.sourceId === action.id),
        ),
      };

    case "ADD_CATEGORY": {
      const category = cleanCategory(action.category);
      if (!category) return state;
      return { ...state, categories: mergeCategories(state.categories, [category]) };
    }

    case "ADD_PLANNED_EXPENSE_OVERRIDE": {
      const payload = action.payload;
      const plannedExpenseOverrides = [...(state.plannedExpenseOverrides ?? [])];
      const replacementIndex =
        payload.sourceType !== "one_time" && payload.sourceId
          ? plannedExpenseOverrides.findIndex(
              (override) =>
                override.sourceType === payload.sourceType &&
                override.sourceId === payload.sourceId &&
                override.month === payload.month,
            )
          : -1;
      const nextOverride: PlannedExpenseOverride = { ...payload, id: newId() };
      if (replacementIndex >= 0) plannedExpenseOverrides[replacementIndex] = nextOverride;
      else plannedExpenseOverrides.push(nextOverride);
      return normalizeState({ ...state, plannedExpenseOverrides });
    }

    case "UPDATE_PLANNED_EXPENSE_OVERRIDE":
      return normalizeState({
        ...state,
        plannedExpenseOverrides: (state.plannedExpenseOverrides ?? []).map((override) =>
          override.id === action.payload.id ? action.payload : override,
        ),
      });

    case "DELETE_PLANNED_EXPENSE_OVERRIDE":
      return {
        ...state,
        plannedExpenseOverrides: (state.plannedExpenseOverrides ?? []).filter(
          (override) => override.id !== action.id,
        ),
      };

    case "ADD_PLANNED_INCOME_OVERRIDE": {
      const payload = action.payload;
      const plannedIncomeOverrides = [...(state.plannedIncomeOverrides ?? [])];
      const replacementIndex = plannedIncomeOverrides.findIndex(
        (override) =>
          override.sourceId === payload.sourceId && override.payDate === payload.payDate,
      );
      const nextOverride: PlannedIncomeOverride = { ...payload, id: newId() };
      if (replacementIndex >= 0) plannedIncomeOverrides[replacementIndex] = nextOverride;
      else plannedIncomeOverrides.push(nextOverride);
      return { ...state, plannedIncomeOverrides };
    }

    case "UPDATE_PLANNED_INCOME_OVERRIDE":
      return {
        ...state,
        plannedIncomeOverrides: (state.plannedIncomeOverrides ?? []).map((override) =>
          override.id === action.payload.id ? action.payload : override,
        ),
      };

    case "DELETE_PLANNED_INCOME_OVERRIDE":
      return {
        ...state,
        plannedIncomeOverrides: (state.plannedIncomeOverrides ?? []).filter(
          (override) => override.id !== action.id,
        ),
      };

    case "UPDATE_TRANSACTION": {
      const p = action.payload;
      const existing = state.transactions.find((transaction) => transaction.id === p.id);
      if (!existing || existing.type !== "expense") return state;

      let next = state;

      if (existing.cardId) {
        next = {
          ...next,
          cards: next.cards.map((card) =>
            card.id === existing.cardId
              ? {
                  ...card,
                  currentBalance: clampNonNegative(card.currentBalance - existing.amount),
                }
              : card,
          ),
        };
      } else if (existing.sourceAccountId) {
        next = {
          ...next,
          accounts: updateAccount(next, existing.sourceAccountId, existing.amount),
        };
      }

      if (p.cardId) {
        next = {
          ...next,
          cards: next.cards.map((card) =>
            card.id === p.cardId
              ? { ...card, currentBalance: card.currentBalance + p.amount }
              : card,
          ),
        };
      } else if (p.sourceAccountId) {
        next = {
          ...next,
          accounts: updateAccount(next, p.sourceAccountId, -p.amount),
        };
      }

      return {
        ...next,
        categories: mergeCategories(next.categories, [p.category]),
        transactions: next.transactions.map((transaction) =>
          transaction.id === p.id
            ? {
                ...transaction,
                amount: p.amount,
                category: p.category,
                description: p.description,
                date: p.date,
                notes: p.notes?.trim() ? p.notes.trim() : undefined,
                sourceAccountId: p.sourceAccountId,
                cardId: p.cardId,
                updatedAt: now(),
              }
            : transaction,
        ),
      };
    }

    case "ADD_EXPENSE": {
      const p = action.payload;
      let next = state;
      if (p.method === "credit_card" && p.cardId) {
        next = {
          ...next,
          cards: next.cards.map((c) =>
            c.id === p.cardId ? { ...c, currentBalance: c.currentBalance + p.amount } : c,
          ),
        };
      } else if (p.sourceAccountId) {
        next = { ...next, accounts: updateAccount(next, p.sourceAccountId, -p.amount) };
      }
      const tx: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        type: "expense",
        amount: p.amount,
        category: p.category,
        description: p.description ?? "",
        date: p.date,
        sourceAccountId: p.sourceAccountId,
        cardId: p.cardId,
      };
      return {
        ...next,
        categories: mergeCategories(next.categories, [p.category]),
        transactions: addTx(next, tx),
      };
    }

    case "PAY_CREDIT_CARD": {
      const p = action.payload;
      const card = state.cards.find((c) => c.id === p.cardId);
      if (!card) return state;
      const pay = Math.min(p.amount, card.currentBalance);

      // Figure out which billing cycle this payment settles.
      const cycle = cycleForDate(card, p.date);
      const cycleExpenses = expensesInCycle(state.transactions, card.id, cycle);
      const cycleTotal = cycleExpenses.reduce((s, t) => s + t.amount, 0);

      // Reconcile expenses up to the amount actually paid (oldest first).
      let remaining = pay;
      const reconciledIds: string[] = [];
      const ordered = [...cycleExpenses].sort((a, b) => a.date.localeCompare(b.date));
      for (const ex of ordered) {
        if (remaining <= 0) break;
        if (ex.amount <= remaining + 0.001) {
          reconciledIds.push(ex.id);
          remaining -= ex.amount;
        }
      }
      const paymentId = newId();
      const transactionsAfterRecon = state.transactions.map((t) =>
        reconciledIds.includes(t.id)
          ? { ...t, reconciledByPaymentId: paymentId, updatedAt: now() }
          : t,
      );

      const next: AppState = {
        ...state,
        cards: state.cards.map((c) =>
          c.id === p.cardId
            ? {
                ...c,
                currentBalance: clampNonNegative(c.currentBalance - pay),
                statementBalance: clampNonNegative(c.statementBalance - pay),
              }
            : c,
        ),
        accounts: updateAccount(state, p.sourceAccountId, -pay),
        transactions: transactionsAfterRecon,
      };
      const forecastMonth = monthFromISO(p.date);
      const monthRef = new Date(`${forecastMonth}-01T00:00:00`);
      const plannedCardItems = upcomingCardBillItems(state, monthRef)
        .filter((item) => item.sourceId === p.cardId)
        .sort((a, b) => {
          const dueDateOrder = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
          if (dueDateOrder !== 0) return dueDateOrder;
          return a.id.localeCompare(b.id);
        });
      const skipItemIds = new Set<string>();
      if (p.plannedExpenseItemId) {
        skipItemIds.add(p.plannedExpenseItemId);
      } else {
        let remainingForPlanning = pay;
        for (const item of plannedCardItems) {
          if (remainingForPlanning + 0.001 < item.amount) continue;
          skipItemIds.add(item.id);
          remainingForPlanning -= item.amount;
        }
      }
      const plannedExpenseOverrides =
        skipItemIds.size === 0
          ? next.plannedExpenseOverrides
          : [
              ...(next.plannedExpenseOverrides ?? []).filter(
                (override) =>
                  !(
                    override.sourceType === "card_due" &&
                    override.month === forecastMonth &&
                    skipItemIds.has(override.sourceId ?? "")
                  ),
              ),
              ...[...skipItemIds].map((itemId) => ({
                id: newId(),
                sourceType: "card_due" as const,
                sourceId: itemId,
                month: forecastMonth,
                action: "skip" as const,
              })),
            ];
      const noteSummary =
        reconciledIds.length > 0
          ? `Reconciled ${reconciledIds.length} expense${reconciledIds.length === 1 ? "" : "s"} from ${cycle.cycleStart} → ${cycle.cycleEnd}`
          : `No matching cycle expenses for ${cycle.cycleStart} → ${cycle.cycleEnd}`;
      const fullPayment: Transaction = {
        id: paymentId,
        type: "card_payment",
        amount: pay,
        category: "Credit card bill",
        description: `Payment to ${card.name}`,
        date: p.date,
        sourceAccountId: p.sourceAccountId,
        cardId: p.cardId,
        notes: p.notes ? `${p.notes} · ${noteSummary}` : noteSummary,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        reconciledExpenseIds: reconciledIds,
        createdAt: now(),
        updatedAt: now(),
      };
      // Suppress unused warning
      void cycleTotal;
      return {
        ...next,
        plannedExpenseOverrides,
        transactions: [fullPayment, ...next.transactions],
      };
    }

    case "PAY_DEBT": {
      const p = action.payload;
      const debt = state.debts.find((d) => d.id === p.debtId);
      if (!debt) return state;
      const pay = Math.min(p.amount, debt.balance);
      if (pay <= 0) return state;
      const nextBalance = clampNonNegative(debt.balance - pay);
      const next: AppState = {
        ...state,
        debts: state.debts.map((d) =>
          d.id === p.debtId
            ? {
                ...d,
                balance: nextBalance,
                status: nextBalance <= 0 ? "paid_off" : d.status,
              }
            : d,
        ),
        accounts: updateAccount(state, p.sourceAccountId, -pay),
      };
      const tx: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        type: "debt_payment",
        amount: pay,
        category: "Debt payment",
        description: `Payment to ${debt.name}`,
        date: p.date,
        sourceAccountId: p.sourceAccountId,
        debtId: p.debtId,
        notes: p.notes,
      };
      return { ...next, transactions: addTx(next, tx) };
    }

    case "ADD_TRANSFER": {
      const p = action.payload;
      const next: AppState = {
        ...state,
        accounts: state.accounts.map((a) => {
          if (a.id === p.fromAccountId)
            return { ...a, balance: a.balance - p.amount, updatedAt: now() };
          if (a.id === p.toAccountId)
            return { ...a, balance: a.balance + p.amount, updatedAt: now() };
          return a;
        }),
      };
      const tx: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        type: "transfer",
        amount: p.amount,
        category: "Transfer",
        description: "Account transfer",
        date: p.date,
        sourceAccountId: p.fromAccountId,
        targetAccountId: p.toAccountId,
        notes: p.notes,
      };
      return { ...next, transactions: addTx(next, tx) };
    }

    case "ADD_ADJUSTMENT": {
      const p = action.payload;
      let next = state;
      let delta = 0;
      let label = "Manual adjustment";
      if (p.accountId) {
        const a = state.accounts.find((x) => x.id === p.accountId);
        if (!a) return state;
        delta = p.newBalance - a.balance;
        next = {
          ...next,
          accounts: next.accounts.map((x) =>
            x.id === p.accountId ? { ...x, balance: p.newBalance, updatedAt: now() } : x,
          ),
        };
        label = `Adjust ${a.name}`;
      } else if (p.cardId) {
        const c = state.cards.find((x) => x.id === p.cardId);
        if (!c) return state;
        delta = p.newBalance - c.currentBalance;
        next = {
          ...next,
          cards: next.cards.map((x) =>
            x.id === p.cardId ? { ...x, currentBalance: p.newBalance } : x,
          ),
        };
        label = `Adjust ${c.name}`;
      }
      const tx: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        type: "adjustment",
        amount: delta,
        category: p.reason,
        description: label,
        date: p.date,
        sourceAccountId: p.accountId,
        cardId: p.cardId,
        notes: p.notes,
      };
      return { ...next, transactions: addTx(next, tx) };
    }

    case "UPSERT_TIMESHEET": {
      const existing = state.timesheet.find((t) => t.id === action.payload.id);
      const list = existing
        ? state.timesheet.map((t) => (t.id === action.payload.id ? action.payload : t))
        : [...state.timesheet, action.payload];
      return { ...state, timesheet: list };
    }
    case "DELETE_TIMESHEET": {
      const entry = state.timesheet.find((t) => t.id === action.id);
      // If was paid, reverse it first.
      let next = state;
      if (entry && entry.paid && entry.paidAccountId && entry.actualAmount) {
        next = { ...next, accounts: updateAccount(next, entry.paidAccountId, -entry.actualAmount) };
      }
      return { ...next, timesheet: next.timesheet.filter((t) => t.id !== action.id) };
    }
    case "MARK_TIMESHEET_PAID": {
      const { id, paidAccountId, actualAmount, date } = action.payload;
      const entry = state.timesheet.find((t) => t.id === id);
      if (!entry || entry.paid) return state;
      const next: AppState = {
        ...state,
        accounts: updateAccount(state, paidAccountId, actualAmount),
        timesheet: state.timesheet.map((t) =>
          t.id === id
            ? {
                ...t,
                paid: true,
                payStatus: "paid",
                paidAccountId,
                actualAmount,
                updatedAt: now(),
                userEdited: true,
              }
            : t,
        ),
      };
      const tx: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        type: "income",
        amount: actualAmount,
        category: entry.entryType === "salary_paycheck" ? "Salary" : "Wages",
        description: entry.jobName,
        date: date ?? entry.date,
        targetAccountId: paidAccountId,
      };
      return { ...next, transactions: addTx(next, tx) };
    }
    case "UNMARK_TIMESHEET_PAID": {
      const entry = state.timesheet.find((t) => t.id === action.payload.id);
      if (!entry || !entry.paid || !entry.paidAccountId) return state;
      const amount = entry.actualAmount ?? 0;
      const next: AppState = {
        ...state,
        accounts: updateAccount(state, entry.paidAccountId, -amount),
        timesheet: state.timesheet.map((t) =>
          t.id === entry.id
            ? { ...t, paid: false, payStatus: "unpaid", paidAccountId: undefined, updatedAt: now() }
            : t,
        ),
      };
      const tx: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        type: "adjustment",
        amount: -amount,
        category: "Income reversal",
        description: `Unmarked paid: ${entry.jobName}`,
        date: todayISO(),
        sourceAccountId: entry.paidAccountId,
      };
      return { ...next, transactions: addTx(next, tx) };
    }

    default:
      return state;
  }
}
