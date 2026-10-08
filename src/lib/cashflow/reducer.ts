import {
  Account,
  AppState,
  CategoryBudget,
  CategoryBudgetOverride,
  Card,
  DEFAULT_CATEGORIES,
  Debt,
  Job,
  PlannedExpenseOverride,
  PlannedIncomeOverride,
  RecurringBill,
  TimesheetEntry,
  Transaction,
  SavingsGoal,
  emptyState,
} from "./types";
import { clampNonNegative } from "./money";
import { newId, todayISO, toISODate } from "./dates";
import { expensesComingBreakdown } from "./forecast";
import { isFriendExpenseCategory, validISODate } from "./friendRepayment";
import { canMergeExpenses, canMergeIncome } from "./transactionMerge";
import { assignablePlannedExpenses, assignablePlannedIncome, validAssignmentSelection } from "./activityAssignment";
import { allocatedInAccount, backedGoalInAccount, goalAvailable, goalAvailableInAccount, goalBalanceInAccount,
  goalCents, goalMoney, validGoalAmount } from "./savingsGoals";
import {
  recordCardPayment,
  removeCardPayment,
  validCardPayment,
  type CardPaymentInput,
} from "./cardPaymentLedger";

export type Action =
  | { type: "HYDRATE"; state: AppState }
  | { type: "RESET" }
  | { type: "COMPLETE_ONBOARDING"; payload: Partial<AppState> }
  | { type: "UPDATE_PROFILE"; payload: Partial<AppState["profile"]> }
  | { type: "ADD_SAVINGS_GOAL"; payload: { name: string; plan?: SavingsGoal["plan"]; targetAmount?: number; targetDate?: string } }
  | { type: "UPDATE_SAVINGS_GOAL"; id: string; payload: { name: string; plan?: SavingsGoal["plan"]; targetAmount?: number; targetDate?: string } }
  | { type: "ALLOCATE_GOAL"; goalId: string; accountId: string; amount: number; date: string }
  | { type: "RELEASE_GOAL"; goalId: string; accountId: string; amount: number; date: string }
  | { type: "DELETE_SAVINGS_GOAL"; id: string }
  | { type: "ADD_ACCOUNT"; payload: Omit<Account, "id" | "createdAt" | "updatedAt"> }
  | { type: "UPDATE_ACCOUNT"; payload: Account }
  | { type: "DELETE_ACCOUNT"; id: string }
  | { type: "ADD_CARD"; payload: Omit<Card, "id"> }
  | { type: "UPDATE_CARD"; payload: Card }
  | { type: "SYNC_ACCOUNT_BALANCE"; id: string; balance: number }
  | { type: "SYNC_CARD_BALANCE"; id: string; balance: number; limit: number }
  | { type: "UPDATE_CARD_PAYMENT"; id: string; payload: CardPaymentInput }
  | { type: "RECONCILE_CARD_PAYMENT"; id: string; leg: "cash" | "card"; bankId: string }
  | { type: "RECONCILE_ACCOUNT_TRANSFER"; id: string; leg: "debit" | "credit"; bankId: string }
  | { type: "CONVERT_CARD_PAYMENT"; id: string; payload: CardPaymentInput; mergeIntoId?: string }
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
  | {
      type: "MARK_PLANNED_EXPENSE_PAID";
      payload: {
        sourceType: "recurring_bill" | "one_time";
        sourceId?: string;
        overrideId?: string;
        month: string;
      };
    }
  | { type: "ADD_PLANNED_INCOME_OVERRIDE"; payload: Omit<PlannedIncomeOverride, "id"> }
  | { type: "UPDATE_PLANNED_INCOME_OVERRIDE"; payload: PlannedIncomeOverride }
  | { type: "DELETE_PLANNED_INCOME_OVERRIDE"; id: string }
  | { type: "ADD_CATEGORY_BUDGET"; payload: Omit<CategoryBudget, "id"> }
  | { type: "UPDATE_CATEGORY_BUDGET"; payload: CategoryBudget }
  | { type: "DELETE_CATEGORY_BUDGET"; id: string }
  | {
      type: "SET_CATEGORY_BUDGET_OVERRIDE";
      payload: Omit<CategoryBudgetOverride, "id">;
    }
  | { type: "DELETE_CATEGORY_BUDGET_OVERRIDE"; id: string }
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
        /** Null removes a linked expectation; undefined leaves its date alone. */
        friendRepaymentDate?: string | null;
        savingsGoalId?: string;
      };
    }
  | { type: "DELETE_TRANSACTION"; id: string }
  | { type: "DELETE_INCOME_TRANSACTION"; id: string; bankBalanceAuthoritative: boolean }
  | {
      type: "UPDATE_INCOME_TRANSACTION";
      id: string;
      description: string;
      category: string;
      date: string;
      notes?: string;
    }
  | {
      type: "MERGE_INCOME_TRANSACTIONS";
      sourceId: string;
      targetId: string;
      bankBalanceAuthoritative: boolean;
    }
  | { type: "LINK_INCOME_TRANSACTION"; id: string; itemId: string; appliedAmount?: number }
  | { type: "ASSIGN_PLANNED_ITEMS"; id: string; itemIds: string[];
      mode: "combined" | "duplicates"; updateFutureBillAmount?: boolean }
  | {
      type: "LINK_EXPENSE_TRANSACTION";
      id: string;
      itemId: string;
      updateFutureBillAmount?: boolean;
    }
  | { type: "UNLINK_PLANNED_TRANSACTION"; id: string }
  | {
      type: "MERGE_TRANSACTIONS";
      sourceId: string;
      targetId: string;
      bankBalanceAuthoritative?: boolean;
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
        balanceAlreadySynced?: boolean;
        friendRepaymentDate?: string;
        savingsGoalId?: string;
      };
    }
  | {
      type: "PAY_CREDIT_CARD";
      payload: CardPaymentInput;
    }
  | {
      type: "PAY_DEBT";
      payload: {
        debtId: string;
        amount: number;
        sourceAccountId: string;
        date: string;
        notes?: string;
        principalAmount?: number;
        balanceAlreadySynced?: boolean;
      };
    }
  | {
      type: "REVIEW_DEBT_PAYMENT";
      payload: {
        debtId: string;
        amount: number;
        principalAmount: number;
        sourceAccountId: string;
        date: string;
        balanceAlreadySynced: boolean;
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
        transactionId?: string;
        bankDebitId?: string;
        bankCreditId?: string;
        debitAlreadySynced?: boolean;
        creditAlreadySynced?: boolean;
        savingsGoalId?: string;
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
  | {
      type: "ADD_INCOME";
      payload: {
        accountId: string;
        amount: number;
        date: string;
        description: string;
        category?: string;
        notes?: string;
        balanceAlreadySynced?: boolean;
        transactionId?: string;
        plannedIncomeOverrideId?: string;
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

function updateAccount(state: AppState, id: string, delta: number): Account[] {
  return state.accounts.map((a) =>
    a.id === id ? { ...a, balance: a.balance + delta, updatedAt: now() } : a,
  );
}

function updateAccountCents(state: AppState, id: string, delta: number): Account[] {
  return state.accounts.map((account) =>
    account.id === id
      ? { ...account, balance: Math.round((account.balance + delta) * 100) / 100, updatedAt: now() }
      : account,
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

function undoIncomeLink(state: AppState, tx: Transaction): AppState {
  if (tx.linkedPlannedIncomes?.length) {
    return [tx.linkedPlannedIncome, ...tx.linkedPlannedIncomes].filter(Boolean).reduce(
      (next, link) => undoIncomeLink(next, { ...tx, linkedPlannedIncome: link,
        linkedPlannedIncomes: undefined }), state);
  }
  const link = tx.linkedPlannedIncome;
  if (!link) return state;
  const previous = new Map((link.originalEntries ?? []).map((entry) => [entry.id, entry]));
  const added = new Set(link.addedEntryIds ?? []);
  return {
    ...state,
    timesheet: state.timesheet.flatMap((entry) => {
      if (entry.linkedTransactionId !== tx.id || link.originalOverride ||
          (link.linkedEntryIds && !link.linkedEntryIds.includes(entry.id))) return [entry];
      if (added.has(entry.id))
        return [
          {
            ...entry,
            paid: false,
            payStatus: "unpaid",
            actualAmount: undefined,
            paidAccountId: undefined,
            linkedTransactionId: undefined,
            userEdited: true,
            updatedAt: now(),
          },
        ];
      return [previous.get(entry.id) ?? { ...entry, linkedTransactionId: undefined }];
    }),
    plannedIncomeOverrides:
      link.originalOverride &&
      !state.plannedIncomeOverrides.some((override) => override.id === link.originalOverride?.id)
        ? [...state.plannedIncomeOverrides, link.originalOverride]
        : state.plannedIncomeOverrides,
  };
}

function undoExpenseLink(state: AppState, tx: Transaction): AppState {
  if (tx.linkedPlannedExpenses?.length) {
    return [tx.linkedPlannedExpense, ...tx.linkedPlannedExpenses].filter(Boolean).reduce(
      (next, link) => undoExpenseLink(next, { ...tx, linkedPlannedExpense: link,
        linkedPlannedExpenses: undefined }), state);
  }
  const link = tx.linkedPlannedExpense;
  if (!link) return state;
  if (link.sourceType === "one_time") {
    return {
      ...state,
      plannedExpenseOverrides:
        link.originalOverride &&
        !state.plannedExpenseOverrides.some((override) => override.id === link.originalOverride?.id)
          ? [...state.plannedExpenseOverrides, link.originalOverride]
          : state.plannedExpenseOverrides,
    };
  }
  if (
    !link.createdOverrideId ||
    !state.plannedExpenseOverrides.some((override) => override.id === link.createdOverrideId)
  )
    return state;
  return {
    ...state,
    recurringBills:
      link.priorRecurringAmount === undefined
        ? state.recurringBills
        : state.recurringBills.map((bill) =>
            bill.id === link.sourceId && bill.amount === link.matchedRecurringAmount
              ? { ...bill, amount: link.priorRecurringAmount! }
              : bill,
          ),
    plannedExpenseOverrides: [
      ...state.plannedExpenseOverrides.filter(
        (override) =>
          override.id !== link.createdOverrideId && override.id !== link.originalOverride?.id,
      ),
      ...(link.originalOverride ? [link.originalOverride] : []),
    ],
  };
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
  const today = new Date();
  const priorMonth = toISODate(new Date(today.getFullYear(), today.getMonth() - 1, 1)).slice(0, 7);
  return {
    ...state,
    cards: state.cards.map((card) => ({
      ...card,
      paymentScheduleStartDate: card.paymentScheduleStartDate ?? todayISO(),
    })),
    recurringBills: state.recurringBills.map((bill) => ({
      ...bill,
      startMonth:
        bill.startMonth ??
        [
          priorMonth,
          ...(state.plannedExpenseOverrides ?? [])
            .filter(
              (override) =>
                override.sourceType === "recurring_bill" && override.sourceId === bill.id,
            )
            .map((override) => override.month),
        ].sort()[0],
    })),
    categories: mergeCategories(
      DEFAULT_CATEGORIES,
      state.categories,
      state.transactions?.map((t) => t.category),
      state.cards?.flatMap((c) => c.preferredCategories),
      state.plannedExpenseOverrides?.map((p) => p.category ?? ""),
    ),
    // Older payment entry code hid whole card obligations, including partial payments.
    // Recompute these from the remaining balance; retain explicit amount/date overrides.
    plannedExpenseOverrides: (state.plannedExpenseOverrides ?? []).filter(
      (override) =>
        !(
          override.sourceType === "card_due" &&
          override.action === "skip" &&
          !override.manualCardSkip &&
          state.transactions.some(
            (tx) =>
              tx.type === "card_payment" &&
              tx.cardId &&
              !tx.cardPayment &&
              override.month === tx.date.slice(0, 7) &&
              (override.sourceId === tx.cardId || override.sourceId?.startsWith(`${tx.cardId}:`)),
          )
        ),
    ),
    plannedIncomeOverrides: state.plannedIncomeOverrides ?? [],
    categoryBudgets: state.categoryBudgets ?? [],
    categoryBudgetOverrides: state.categoryBudgetOverrides ?? [],
    savingsGoals: state.savingsGoals ?? [],
  };
}

function addGoalMovement(state: AppState, goalId: string, accountId: string, amount: number,
  date: string, kind: SavingsGoal["movements"][number]["kind"], transactionId?: string): AppState {
  return { ...state, savingsGoals: (state.savingsGoals ?? []).map((goal) => goal.id === goalId
    ? { ...goal, movements: [...goal.movements, { id: newId(), accountId, amount,
      date, kind, transactionId }] } : goal) };
}

function removeGoalTransactionMovements(state: AppState, transactionId: string): AppState {
  return { ...state, savingsGoals: (state.savingsGoals ?? []).map((goal) => ({ ...goal,
    movements: goal.movements.filter((movement) => movement.transactionId !== transactionId) })) };
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

    case "ADD_SAVINGS_GOAL": {
      const { name, plan, targetAmount, targetDate } = action.payload;
      if (!name.trim() || name.trim().length > 80 ||
          (targetAmount !== undefined && !validGoalAmount(targetAmount)) ||
          (targetDate && !validISODate(targetDate)) ||
          (plan && (!(["weekly", "monthly", "lump_sum"] as const).includes(plan.cadence) ||
            (plan.cadence === "lump_sum" ? plan.amount !== undefined || targetAmount === undefined :
              !validGoalAmount(plan.amount ?? 0))))) return state;
      return { ...state, savingsGoals: [...(state.savingsGoals ?? []), {
        id: newId(), name: name.trim(), plan, targetAmount, targetDate,
        createdAt: now(), movements: [],
      }] };
    }
    case "UPDATE_SAVINGS_GOAL": {
      if (!state.savingsGoals?.some((goal) => goal.id === action.id)) return state;
      const { name, plan, targetAmount, targetDate } = action.payload;
      if (!name.trim() || name.trim().length > 80 ||
          (targetAmount !== undefined && !validGoalAmount(targetAmount)) ||
          (targetDate && !validISODate(targetDate)) ||
          (plan && (!(["weekly", "monthly", "lump_sum"] as const).includes(plan.cadence) ||
            (plan.cadence === "lump_sum" ? plan.amount !== undefined || targetAmount === undefined :
              !validGoalAmount(plan.amount ?? 0))))) return state;
      return { ...state, savingsGoals: state.savingsGoals.map((goal) => goal.id === action.id
        ? { ...goal, name: name.trim(), plan, targetAmount, targetDate } : goal) };
    }
    case "ALLOCATE_GOAL":
    case "RELEASE_GOAL": {
      const { goalId, accountId, amount, date } = action;
      const goal = state.savingsGoals?.find((item) => item.id === goalId);
      const account = state.accounts.find((item) => item.id === accountId);
      if (!goal || !account || !validGoalAmount(amount) || !validISODate(date)) return state;
      if (action.type === "ALLOCATE_GOAL" && goalCents(amount) >
          goalCents(Math.max(0, account.balance - allocatedInAccount(state, accountId)))) return state;
      if (action.type === "RELEASE_GOAL" && goalCents(amount) >
          goalCents(goalAvailableInAccount(state, goal, accountId))) return state;
      return addGoalMovement(state, goalId, accountId,
        action.type === "ALLOCATE_GOAL" ? amount : -amount, date,
        action.type === "ALLOCATE_GOAL" ? "save" : "release");
    }
    case "DELETE_SAVINGS_GOAL": {
      const goal = state.savingsGoals?.find((item) => item.id === action.id);
      if (!goal || goal.movements.length || state.transactions.some((tx) => tx.savingsGoalId === goal.id)) return state;
      return { ...state, savingsGoals: state.savingsGoals!.filter((item) => item.id !== goal.id) };
    }

    case "SYNC_ACCOUNT_BALANCE":
      return {
        ...state,
        accounts: state.accounts.map((account) =>
          account.id === action.id
            ? { ...account, balance: action.balance, bankLinked: true, updatedAt: now() }
            : account,
        ),
      };
    case "SYNC_CARD_BALANCE":
      return {
        ...state,
        cards: state.cards.map((card) =>
          card.id === action.id
            ? { ...card, currentBalance: action.balance, limit: action.limit, bankLinked: true }
            : card,
        ),
      };

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
      return {
        ...state,
        cards: [
          ...state.cards,
          {
            ...action.payload,
            paymentScheduleStartDate: action.payload.paymentScheduleStartDate ?? todayISO(),
            id: newId(),
          },
        ],
      };
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
        recurringBills: [
          ...state.recurringBills,
          {
            ...action.payload,
            startMonth: action.payload.startMonth ?? todayISO().slice(0, 7),
            id: newId(),
          },
        ],
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

    case "MARK_PLANNED_EXPENSE_PAID": {
      const { sourceType, sourceId, overrideId, month } = action.payload;
      if (sourceType === "one_time") {
        if (
          !overrideId ||
          !state.plannedExpenseOverrides.some(
            (override) =>
              override.id === overrideId &&
              override.sourceType === "one_time" &&
              override.month === month &&
              override.action === "add",
          )
        )
          return state;
        return reducer(state, { type: "DELETE_PLANNED_EXPENSE_OVERRIDE", id: overrideId });
      }
      if (!sourceId || !state.recurringBills.some((bill) => bill.id === sourceId)) return state;
      return reducer(state, {
        type: "ADD_PLANNED_EXPENSE_OVERRIDE",
        payload: { sourceType: "recurring_bill", sourceId, month, action: "skip" },
      });
    }

    case "ADD_CATEGORY_BUDGET": {
      const category = cleanCategory(action.payload.category);
      if (!category || action.payload.amount < 0) return state;
      const duplicate = (state.categoryBudgets ?? []).some(
        (budget) => budget.category.toLowerCase() === category.toLowerCase(),
      );
      if (duplicate) return state;
      const budget: CategoryBudget = {
        ...action.payload,
        category,
        amount: Math.max(0, action.payload.amount),
        id: newId(),
      };
      return normalizeState({
        ...state,
        categories: mergeCategories(state.categories, [category]),
        categoryBudgets: [...(state.categoryBudgets ?? []), budget],
      });
    }

    case "UPDATE_CATEGORY_BUDGET": {
      const category = cleanCategory(action.payload.category);
      if (!category || action.payload.amount < 0) return state;
      return normalizeState({
        ...state,
        categories: mergeCategories(state.categories, [category]),
        categoryBudgets: (state.categoryBudgets ?? []).map((budget) =>
          budget.id === action.payload.id
            ? { ...action.payload, category, amount: Math.max(0, action.payload.amount) }
            : budget,
        ),
      });
    }

    case "DELETE_CATEGORY_BUDGET":
      return {
        ...state,
        categoryBudgets: (state.categoryBudgets ?? []).filter((budget) => budget.id !== action.id),
        categoryBudgetOverrides: (state.categoryBudgetOverrides ?? []).filter(
          (override) => override.budgetId !== action.id,
        ),
      };

    case "SET_CATEGORY_BUDGET_OVERRIDE": {
      const payload = {
        ...action.payload,
        amount: Math.max(0, action.payload.amount),
      };
      const overrides = [...(state.categoryBudgetOverrides ?? [])];
      const existingIndex = overrides.findIndex(
        (override) =>
          override.budgetId === payload.budgetId &&
          override.month === payload.month &&
          override.scope === payload.scope,
      );
      const override: CategoryBudgetOverride = {
        ...payload,
        id: existingIndex >= 0 ? overrides[existingIndex].id : newId(),
      };
      if (existingIndex >= 0) overrides[existingIndex] = override;
      else overrides.push(override);
      return { ...state, categoryBudgetOverrides: overrides };
    }

    case "DELETE_CATEGORY_BUDGET_OVERRIDE":
      return {
        ...state,
        categoryBudgetOverrides: (state.categoryBudgetOverrides ?? []).filter(
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
      const goal = p.savingsGoalId ? state.savingsGoals?.find((item) => item.id === p.savingsGoalId) : undefined;
      const unlinked = removeGoalTransactionMovements(state, p.id);
      const candidate = { ...unlinked, transactions: unlinked.transactions.filter((tx) => tx.id !== p.id) };
      const restoredGoal = candidate.savingsGoals?.find((item) => item.id === p.savingsGoalId);
      if (p.savingsGoalId && (!goal || !validGoalAmount(p.amount) ||
          !restoredGoal || (p.cardId ? goalCents(goalAvailable(candidate, restoredGoal)) < goalCents(p.amount) :
            !p.sourceAccountId || goalCents(goalAvailableInAccount(candidate, restoredGoal, p.sourceAccountId)) < goalCents(p.amount)))) return state;
      const linkedRepayment = (state.plannedIncomeOverrides ?? []).find(
        (override) => override.kind === "friend_repayment" && override.linkedExpenseId === p.id,
      );
      if (
        p.friendRepaymentDate &&
        (!isFriendExpenseCategory(p.category) ||
          !validISODate(p.friendRepaymentDate) ||
          !validISODate(p.date) ||
          p.friendRepaymentDate < p.date)
      )
        return state;

      let next = unlinked;

      if (!existing.balanceAlreadySynced && existing.cardId) {
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
      } else if (!existing.balanceAlreadySynced && existing.sourceAccountId) {
        next = {
          ...next,
          accounts: updateAccount(next, existing.sourceAccountId, existing.amount),
        };
      }

      if (!existing.balanceAlreadySynced && p.cardId) {
        next = {
          ...next,
          cards: next.cards.map((card) =>
            card.id === p.cardId
              ? { ...card, currentBalance: card.currentBalance + p.amount }
              : card,
          ),
        };
      } else if (!existing.balanceAlreadySynced && p.sourceAccountId) {
        next = {
          ...next,
          accounts: updateAccount(next, p.sourceAccountId, -p.amount),
        };
      }

      const editedRepayments = (next.plannedIncomeOverrides ?? [])
        .filter((override) => p.friendRepaymentDate !== null || override.linkedExpenseId !== p.id)
        .map((override) =>
          override.linkedExpenseId === p.id && override.kind === "friend_repayment"
            ? {
                ...override,
                payDate: p.friendRepaymentDate ?? override.payDate,
                amount: override.amount === existing.amount ? p.amount : override.amount,
                label:
                  override.label === `Repayment: ${existing.description.trim() || "friend"}`
                    ? `Repayment: ${p.description.trim() || "friend"}`
                    : override.label,
              }
            : override,
        );
      if (p.friendRepaymentDate && !linkedRepayment) {
        editedRepayments.push({
          id: newId(),
          sourceId: `friend-repayment-${p.id}`,
          linkedExpenseId: p.id,
          kind: "friend_repayment",
          payDate: p.friendRepaymentDate,
          action: "add",
          label: `Repayment: ${p.description.trim() || "friend"}`,
          amount: p.amount,
          accountId: p.sourceAccountId,
        });
      }
      const result: AppState = {
        ...next,
        categories: mergeCategories(next.categories, [p.category]),
        plannedIncomeOverrides: editedRepayments,
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
                savingsGoalId: goal?.id,
                savingsGoalAmount: goal ? p.amount : undefined,
                updatedAt: now(),
              }
            : transaction,
        ),
      };
      return goal && !p.cardId && p.sourceAccountId ? addGoalMovement(result,
        goal.id, p.sourceAccountId, -p.amount, p.date, "spend", p.id) : result;
    }

    case "DELETE_TRANSACTION": {
      const transaction = state.transactions.find((tx) => tx.id === action.id);
      if (transaction?.type === "transfer") {
        const fromApplied = transaction.accountTransfer?.fromLocalApplied ?? transaction.amount;
        const toApplied = transaction.accountTransfer?.toLocalApplied ?? transaction.amount;
        return { ...removeGoalTransactionMovements(state, transaction.id),
          accounts: state.accounts.map((account) => account.id === transaction.sourceAccountId && !account.bankLinked
            ? { ...account, balance: Math.round((account.balance + fromApplied) * 100) / 100 }
            : account.id === transaction.targetAccountId && !account.bankLinked
              ? { ...account, balance: Math.round((account.balance - toApplied) * 100) / 100 }
              : account),
          transactions: state.transactions.filter((tx) => tx.id !== transaction.id) };
      }
      if (transaction?.type === "card_payment") return removeCardPayment(state, transaction);
      if (transaction?.type === "debt_payment") {
        const principal = transaction.debtPrincipalAmount ?? transaction.amount;
        const debt = state.debts.find((item) => item.id === transaction.debtId);
        if (!debt || !Number.isFinite(principal) || principal < 0) return state;
        const nextBalance = Math.round((debt.balance + principal) * 100) / 100;
        return {
          ...state,
          debts: state.debts.map((item) =>
            item.id === debt.id
              ? {
                  ...item,
                  balance: nextBalance,
                  status:
                    item.status === "paid_off" && nextBalance > 0
                      ? (transaction.debtStatusBeforePayment ?? "active")
                      : item.status,
                }
              : item,
          ),
          accounts:
            transaction.balanceAlreadySynced || !transaction.sourceAccountId
              ? state.accounts
              : updateAccount(state, transaction.sourceAccountId, transaction.amount),
          transactions: state.transactions.filter((tx) => tx.id !== transaction.id),
        };
      }
      const expense = transaction;
      if (!expense || expense.type !== "expense" || expense.reconciledByPaymentId) return state;
      let next = undoExpenseLink(state, expense);
      if (!expense.balanceAlreadySynced && expense.cardId) {
        next = {
          ...next,
          cards: next.cards.map((card) =>
            card.id === expense.cardId
              ? { ...card, currentBalance: clampNonNegative(card.currentBalance - expense.amount) }
              : card,
          ),
        };
      } else if (!expense.balanceAlreadySynced && expense.sourceAccountId) {
        next = { ...next, accounts: updateAccount(next, expense.sourceAccountId, expense.amount) };
      }
      return {
        ...removeGoalTransactionMovements(next, expense.id),
        transactions: next.transactions.filter((tx) => tx.id !== expense.id),
        plannedIncomeOverrides: (next.plannedIncomeOverrides ?? []).filter(
          (override) => override.linkedExpenseId !== expense.id,
        ),
      };
    }

    case "UPDATE_INCOME_TRANSACTION": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (
        !tx ||
        tx.type !== "income" ||
        !validISODate(action.date) ||
        !action.description.trim() ||
        !action.category.trim()
      )
        return state;
      return {
        ...state,
        transactions: state.transactions.map((item) =>
          item.id === tx.id
            ? {
                ...item,
                description: action.description.trim(),
                category: action.category.trim(),
                date: action.date,
                notes: action.notes?.trim() || undefined,
                updatedAt: now(),
              }
            : item,
        ),
      };
    }

    case "DELETE_INCOME_TRANSACTION": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (!tx || tx.type !== "income") return state;
      const next = undoIncomeLink(state, tx);
      return {
        ...next,
        accounts:
          tx.balanceAlreadySynced || action.bankBalanceAuthoritative || !tx.targetAccountId
            ? next.accounts
            : updateAccountCents(next, tx.targetAccountId, -tx.amount),
        transactions: next.transactions.filter((item) => item.id !== tx.id),
      };
    }

    case "UNLINK_PLANNED_TRANSACTION": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (!tx || (!tx.linkedPlannedExpense && !tx.linkedPlannedIncome)) return state;
      const restored = tx.linkedPlannedIncome
        ? undoIncomeLink(state, tx)
        : undoExpenseLink(state, tx);
      return {
        ...restored,
        transactions: restored.transactions.map((item) =>
          item.id === tx.id
            ? {
                ...item,
                linkedPlannedIncome: undefined,
                linkedPlannedExpense: undefined,
                linkedPlannedIncomes: undefined,
                linkedPlannedExpenses: undefined,
                updatedAt: now(),
              }
            : item,
        ),
      };
    }

    case "ASSIGN_PLANNED_ITEMS": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (!tx || (tx.type !== "expense" && tx.type !== "income") ||
          !validISODate(tx.date) || !action.itemIds.length ||
          new Set(action.itemIds).size !== action.itemIds.length) return state;
      // Restore old matches in memory, then validate every choice before changing anything.
      const reset = tx.linkedPlannedExpense || tx.linkedPlannedIncome
        ? reducer(state, { type: "UNLINK_PLANNED_TRANSACTION", id: tx.id }) : state;
      const fresh = reset.transactions.find((item) => item.id === tx.id)!;
      const candidates = tx.type === "expense"
        ? assignablePlannedExpenses(reset, fresh) : assignablePlannedIncome(reset, fresh);
      const selected = action.itemIds.map((id) => candidates.find((item) => item.id === id));
      if (selected.some((item) => !item) ||
          !validAssignmentSelection(tx.amount, selected.filter((item) => !!item), action.mode))
        return state;
      let next = reset;
      for (const item of selected) {
        if (!item) return state;
        const updated = reducer(next, tx.type === "expense"
          ? { type: "LINK_EXPENSE_TRANSACTION", id: tx.id, itemId: item.id,
              updateFutureBillAmount: selected.length === 1 && action.updateFutureBillAmount }
          : { type: "LINK_INCOME_TRANSACTION", id: tx.id, itemId: item.id,
              appliedAmount: selected.length === 1 ? tx.amount :
                action.mode === "duplicates" ? (item === selected[0] ? tx.amount : 0) : item.amount });
        if (updated === next) return state;
        next = updated;
      }
      return next;
    }

    case "MERGE_INCOME_TRANSACTIONS": {
      const source = state.transactions.find((item) => item.id === action.sourceId);
      const target = state.transactions.find((item) => item.id === action.targetId);
      if (
        !source ||
        !target ||
        !canMergeIncome(source, target) ||
        (source.linkedPlannedIncome && target.linkedPlannedIncome)
      )
        return state;
      // The linked bank balance is already authoritative. Do not subtract a manual
      // payday again after the bank has mirrored the deposited cash.
      const synced = Boolean(source.balanceAlreadySynced || target.balanceAlreadySynced);
      return {
        ...state,
        accounts:
          synced || action.bankBalanceAuthoritative || !source.targetAccountId
            ? state.accounts
            : updateAccountCents(state, source.targetAccountId, -source.amount),
        timesheet: state.timesheet.map((entry) =>
          entry.linkedTransactionId === source.id
            ? { ...entry, linkedTransactionId: target.id }
            : entry,
        ),
        transactions: state.transactions
          .filter((item) => item.id !== source.id)
          .map((item) =>
            item.id === target.id
              ? {
                  ...item,
                  balanceAlreadySynced: synced,
                  updatedAt: now(),
                  linkedPlannedIncome: item.linkedPlannedIncome ?? source.linkedPlannedIncome,
                  linkedPlannedIncomes: item.linkedPlannedIncome
                    ? item.linkedPlannedIncomes
                    : source.linkedPlannedIncomes,
                }
              : item,
          ),
      };
    }

    case "LINK_INCOME_TRANSACTION": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (
        !tx ||
        tx.type !== "income" ||
        !tx.targetAccountId ||
        !validISODate(tx.date)
      )
        return state;
      const item = assignablePlannedIncome(state, { ...tx, linkedPlannedIncome: undefined }).find(
        (candidate) => candidate.id === action.itemId,
      );
      if (!item) return state;
      if (item.incomeSourceType === "one_time") {
        const override = state.plannedIncomeOverrides.find(
          (candidate) => candidate.id === item.overrideId,
        );
        if (!override) return state;
        return {
          ...state,
          plannedIncomeOverrides: state.plannedIncomeOverrides.filter(
            (candidate) => candidate.id !== override.id,
          ),
          transactions: state.transactions.map((candidate) =>
            candidate.id === tx.id
              ? {
                  ...candidate,
                  linkedPlannedIncome: candidate.linkedPlannedIncome ?? {
                    itemId: item.id,
                    label: item.label,
                    originalOverride: override,
                  },
                  linkedPlannedIncomes: candidate.linkedPlannedIncome
                    ? [...(candidate.linkedPlannedIncomes ?? []), { itemId: item.id,
                        label: item.label, originalOverride: override }]
                    : candidate.linkedPlannedIncomes,
                  updatedAt: now(),
                }
              : candidate,
          ),
        };
      }
      const entries = item.incomeEntries ?? [];
      if (entries.length === 0 || entries.some((entry) => entry.paid)) return state;
      const total = entries.reduce(
        (sum, entry) => sum + (entry.actualAmount ?? entry.expectedAmount),
        0,
      );
      if (total <= 0) return state;
      let allocated = 0;
      const addedEntryIds: string[] = [];
      const originalEntries: TimesheetEntry[] = [];
      const replacements = new Map<string, TimesheetEntry>();
      entries.forEach((entry, index) => {
        const id = entry.auto ? newId() : entry.id;
        const share =
          index === entries.length - 1
            ? Math.round(((action.appliedAmount ?? tx.amount) - allocated) * 100) / 100
            : Math.round((action.appliedAmount ?? tx.amount) * ((entry.actualAmount ?? entry.expectedAmount) / total) * 100) /
              100;
        allocated += share;
        if (entry.auto) addedEntryIds.push(id);
        else originalEntries.push(entry);
        replacements.set(entry.id, {
          ...entry,
          id,
          auto: false,
          paid: true,
          payStatus: "paid",
          userEdited: true,
          paidAccountId: tx.targetAccountId,
          actualAmount: share,
          linkedTransactionId: tx.id,
          updatedAt: now(),
        });
      });
      return {
        ...state,
        timesheet: [
          ...state.timesheet.map((entry) => replacements.get(entry.id) ?? entry),
          ...entries.filter((entry) => entry.auto).map((entry) => replacements.get(entry.id)!),
        ],
        transactions: state.transactions.map((candidate) =>
          candidate.id === tx.id
            ? {
                ...candidate,
                linkedPlannedIncome: candidate.linkedPlannedIncome ?? {
                  itemId: item.id,
                  label: item.label,
                  originalEntries,
                  addedEntryIds,
                  linkedEntryIds: [...replacements.values()].map((entry) => entry.id),
                },
                linkedPlannedIncomes: candidate.linkedPlannedIncome
                  ? [...(candidate.linkedPlannedIncomes ?? []), { itemId: item.id,
                      label: item.label, originalEntries, addedEntryIds,
                      linkedEntryIds: [...replacements.values()].map((entry) => entry.id) }]
                  : candidate.linkedPlannedIncomes,
                updatedAt: now(),
              }
            : candidate,
        ),
      };
    }

    case "LINK_EXPENSE_TRANSACTION": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (!tx || tx.type !== "expense" || !validISODate(tx.date))
        return state;
      const item = assignablePlannedExpenses(state, { ...tx, linkedPlannedExpense: undefined }).find(
        (candidate) => candidate.id === action.itemId,
      );
      if (!item || (item.sourceType !== "one_time" && item.sourceType !== "recurring_bill"))
        return state;
      // A monthly bill can have a due-date override in the following month.
      // The occurrence key, not the displayed due date, controls which month is paid.
      const month =
        item.sourceType === "recurring_bill"
          ? item.id.slice(-7)
          : (state.plannedExpenseOverrides.find((override) => override.id === item.overrideId)
              ?.month ?? "");
      const original = state.plannedExpenseOverrides.find((override) =>
        item.sourceType === "one_time"
          ? override.id === item.overrideId
          : override.sourceType === "recurring_bill" &&
            override.sourceId === item.sourceId &&
            override.month === month,
      );
      if (item.sourceType === "one_time" && !original) return state;
      const createdOverrideId = item.sourceType === "recurring_bill" ? newId() : undefined;
      const recurringBill =
        item.sourceType === "recurring_bill"
          ? state.recurringBills.find((bill) => bill.id === item.sourceId)
          : undefined;
      if (item.sourceType === "recurring_bill" && !recurringBill) return state;
      const link: NonNullable<Transaction["linkedPlannedExpense"]> = {
        label: item.label,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        month,
        createdOverrideId,
        originalOverride: original,
        ...(action.updateFutureBillAmount && recurringBill && recurringBill.amount !== tx.amount
          ? { priorRecurringAmount: recurringBill.amount, matchedRecurringAmount: tx.amount }
          : {}),
      };
      return {
        ...state,
        recurringBills:
          link.priorRecurringAmount === undefined
            ? state.recurringBills
            : state.recurringBills.map((bill) =>
                bill.id === recurringBill?.id ? { ...bill, amount: tx.amount } : bill,
              ),
        plannedExpenseOverrides: [
          ...state.plannedExpenseOverrides.filter((override) => override.id !== original?.id),
          ...(createdOverrideId
            ? [
                {
                  id: createdOverrideId,
                  sourceType: "recurring_bill" as const,
                  sourceId: item.sourceId,
                  month,
                  action: "skip" as const,
                },
              ]
            : []),
        ],
        transactions: state.transactions.map((candidate) =>
          candidate.id === tx.id
            ? { ...candidate, linkedPlannedExpense: candidate.linkedPlannedExpense ?? link,
                linkedPlannedExpenses: candidate.linkedPlannedExpense
                  ? [...(candidate.linkedPlannedExpenses ?? []), link]
                  : candidate.linkedPlannedExpenses, updatedAt: now() }
            : candidate,
        ),
      };
    }

    case "MERGE_TRANSACTIONS": {
      const source = state.transactions.find((tx) => tx.id === action.sourceId);
      const target = state.transactions.find((tx) => tx.id === action.targetId);
      if (!source || !target || !canMergeExpenses(source, target)) return state;
      // Reverse the duplicate's local impact. If the duplicate is bank-synced,
      // the remaining record must also be bank-synced, so reverse its manual impact instead.
      const toReverse = source.balanceAlreadySynced
        ? target.balanceAlreadySynced
          ? null
          : target
        : source;
      let next = state;
      // A bank-linked balance already contains the single real charge.
      if (!action.bankBalanceAuthoritative && toReverse?.cardId) {
        next = {
          ...next,
          cards: next.cards.map((card) =>
            card.id === toReverse.cardId
              ? {
                  ...card,
                  currentBalance: clampNonNegative(card.currentBalance - toReverse.amount),
                }
              : card,
          ),
        };
      } else if (!action.bankBalanceAuthoritative && toReverse?.sourceAccountId) {
        next = {
          ...next,
          accounts: updateAccount(next, toReverse.sourceAccountId, toReverse.amount),
        };
      }
      const linked = (next.plannedIncomeOverrides ?? []).filter(
        (override) => override.linkedExpenseId === target.id,
      );
      return {
        ...next,
        savingsGoals: (next.savingsGoals ?? []).map((goal) => ({ ...goal,
          movements: goal.movements.flatMap((movement) => movement.transactionId === source.id
            ? target.savingsGoalId ? [] : [{ ...movement, transactionId: target.id }] : [movement]) })),
        transactions: next.transactions
          .filter((tx) => tx.id !== source.id)
          .map((tx) =>
            tx.id === target.id
              ? {
                  ...tx,
                  balanceAlreadySynced: Boolean(
                    source.balanceAlreadySynced || target.balanceAlreadySynced,
                  ),
                  linkedPlannedExpense: tx.linkedPlannedExpense ?? source.linkedPlannedExpense,
                  linkedPlannedExpenses: tx.linkedPlannedExpense
                    ? tx.linkedPlannedExpenses
                    : source.linkedPlannedExpenses,
                  savingsGoalId: tx.savingsGoalId ?? source.savingsGoalId,
                  savingsGoalAmount: tx.savingsGoalAmount ?? source.savingsGoalAmount,
                  updatedAt: now(),
                }
              : tx,
          ),
        plannedIncomeOverrides: (next.plannedIncomeOverrides ?? [])
          .filter((override) => override.linkedExpenseId !== source.id || linked.length === 0)
          .map((override) =>
            override.linkedExpenseId === source.id
              ? {
                  ...override,
                  linkedExpenseId: target.id,
                  sourceId: `friend-repayment-${target.id}`,
                  label:
                    override.label === `Repayment: ${source.description.trim() || "friend"}`
                      ? `Repayment: ${target.description.trim() || "friend"}`
                      : override.label,
                }
              : override,
          ),
      };
    }

    case "ADD_EXPENSE": {
      const p = action.payload;
      const goal = p.savingsGoalId ? state.savingsGoals?.find((item) => item.id === p.savingsGoalId) : undefined;
      if (p.savingsGoalId && (!goal || !validGoalAmount(p.amount) ||
          (p.method !== "credit_card" && (!p.sourceAccountId ||
            goalCents(goalAvailableInAccount(state, goal, p.sourceAccountId)) < goalCents(p.amount))) ||
          (p.method === "credit_card" && goalCents(goalAvailable(state, goal)) < goalCents(p.amount)))) return state;
      if (
        p.friendRepaymentDate &&
        (!isFriendExpenseCategory(p.category) ||
          p.method === "other" ||
          !validISODate(p.friendRepaymentDate) ||
          !validISODate(p.date) ||
          p.friendRepaymentDate < p.date ||
          !Number.isFinite(p.amount) ||
          p.amount <= 0 ||
          (p.method === "credit_card"
            ? !state.cards.some((card) => card.id === p.cardId)
            : !state.accounts.some((account) => account.id === p.sourceAccountId)))
      )
        return state;
      let next = state;
      if (!p.balanceAlreadySynced && p.method === "credit_card" && p.cardId) {
        next = {
          ...next,
          cards: next.cards.map((c) =>
            c.id === p.cardId ? { ...c, currentBalance: c.currentBalance + p.amount } : c,
          ),
        };
      } else if (!p.balanceAlreadySynced && p.sourceAccountId) {
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
        balanceAlreadySynced: p.balanceAlreadySynced,
        savingsGoalId: goal?.id,
        savingsGoalAmount: goal ? p.amount : undefined,
      };
      const transactionId = newId();
      const timestamp = now();
      const repayment: PlannedIncomeOverride[] = p.friendRepaymentDate
        ? [
            {
              id: newId(),
              sourceId: `friend-repayment-${transactionId}`,
              linkedExpenseId: transactionId,
              kind: "friend_repayment",
              payDate: p.friendRepaymentDate,
              action: "add",
              label: `Repayment: ${p.description?.trim() || "friend"}`,
              amount: p.amount,
              accountId: p.sourceAccountId,
            },
          ]
        : [];
      const result: AppState = {
        ...next,
        categories: mergeCategories(next.categories, [p.category]),
        plannedIncomeOverrides: [...(next.plannedIncomeOverrides ?? []), ...repayment],
        transactions: [
          { ...tx, id: transactionId, createdAt: timestamp, updatedAt: timestamp },
          ...next.transactions,
        ],
      };
      return goal && p.method !== "credit_card" && p.sourceAccountId
        ? addGoalMovement(result, goal.id, p.sourceAccountId, -p.amount, p.date,
          "spend", transactionId) : result;
    }

    case "PAY_CREDIT_CARD":
      return recordCardPayment(state, action.payload);

    case "UPDATE_CARD_PAYMENT": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (!tx || tx.type !== "card_payment")
        return state;
      // Bank-linked evidence is immutable: correcting metadata must not invent a different transfer.
      if (
        (tx.cardPayment?.bankCreditId || tx.cardPayment?.bankDebitId) &&
        (action.payload.amount !== tx.amount ||
          action.payload.cardId !== tx.cardId ||
          action.payload.sourceAccountId !== tx.sourceAccountId)
      )
        return state;
      const undone = removeCardPayment(state, tx);
      const updated = {
        ...action.payload,
        savingsGoalId: action.payload.savingsGoalId === "" ? undefined : action.payload.savingsGoalId ?? tx.savingsGoalId,
        savingsGoalAmount: action.payload.savingsGoalId === "" ? undefined : action.payload.savingsGoalAmount ?? tx.savingsGoalAmount,
        transactionId: tx.id,
        cashPosted: tx.cardPayment?.bankDebitId ? true : action.payload.cashPosted,
        cardPosted: tx.cardPayment?.bankCreditId ? true : action.payload.cardPosted,
        bankDebitId: tx.cardPayment?.bankDebitId,
        bankCreditId: tx.cardPayment?.bankCreditId,
        cashAlreadySynced: Boolean(tx.cardPayment?.bankDebitId),
        cardAlreadySynced: Boolean(tx.cardPayment?.bankCreditId),
      };
      if (!validCardPayment(undone, updated)) return state;
      const result = recordCardPayment(undone, updated);
      return {
        ...result,
        transactions: result.transactions.map((item) =>
          item.id === tx.id ? { ...item, createdAt: tx.createdAt } : item,
        ),
      };
    }

    case "RECONCILE_CARD_PAYMENT": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (!tx || tx.type !== "card_payment") return state;
      const prior = tx.cardPayment ?? {
        version: 2 as const,
        cashPosted: !state.accounts.find((account) => account.id === tx.sourceAccountId)
          ?.bankLinked,
        cardPosted: false,
        cashLocalApplied: tx.amount,
        cardLocalApplied: tx.amount,
        statementLocalApplied: 0,
      };
      const key = action.leg === "cash" ? "bankDebitId" : "bankCreditId";
      if (prior[key] && prior[key] !== action.bankId) return state;
      if (
        state.transactions.some(
          (item) => item.id !== tx.id && item.cardPayment?.[key] === action.bankId,
        )
      )
        return state;
      return {
        ...state,
        transactions: state.transactions.map((item) =>
          item.id === tx.id
            ? {
                ...item,
                cardPayment: {
                  ...prior,
                  [key]: action.bankId,
                  ...(action.leg === "cash"
                    ? { cashPosted: true, cashLocalApplied: 0 }
                    : { cardPosted: true, cardLocalApplied: 0, statementLocalApplied: 0 }),
                },
                updatedAt: now(),
              }
            : item,
        ),
      };
    }

    case "CONVERT_CARD_PAYMENT": {
      const expense = state.transactions.find((item) => item.id === action.id);
      if (
        !expense ||
        expense.type !== "expense" ||
        expense.cardId ||
        expense.linkedPlannedExpense ||
        expense.reconciledByPaymentId
      )
        return state;
      const kept = action.mergeIntoId
        ? state.transactions.find((item) => item.id === action.mergeIntoId)
        : undefined;
      if (
        action.mergeIntoId &&
        (!kept ||
          kept.type !== "card_payment" ||
          kept.cardId !== action.payload.cardId ||
          kept.sourceAccountId !== expense.sourceAccountId ||
          Math.round(kept.amount * 100) !== Math.round(expense.amount * 100))
      )
        return state;
      const account = state.accounts.find((item) => item.id === expense.sourceAccountId);
      // Undo the local expense, then replace it with one transfer, never a second expense.
      const undone = removeGoalTransactionMovements({
        ...state,
        accounts:
          !expense.balanceAlreadySynced && account && !account.bankLinked
            ? updateAccountCents(state, account.id, expense.amount)
            : state.accounts,
        transactions: state.transactions.filter((item) => item.id !== expense.id),
      }, expense.id);
      if (kept) {
        const applyCash =
          kept.cardPayment?.cashPosted === false &&
          !account?.bankLinked &&
          !expense.balanceAlreadySynced;
        return {
          ...undone,
          accounts: applyCash
            ? updateAccountCents(undone, expense.sourceAccountId!, -expense.amount)
            : undone.accounts,
          transactions: undone.transactions.map((item) =>
            item.id === kept.id
              ? {
                  ...item,
                  cardPayment: {
                    ...(item.cardPayment ?? {
                      version: 2 as const,
                      cardPosted: false,
                      cardLocalApplied: item.amount,
                      statementLocalApplied: 0,
                      cashLocalApplied: item.amount,
                    }),
                    ...(applyCash ? { cashLocalApplied: expense.amount } : {}),
                    cashPosted: !!expense.balanceAlreadySynced || !account?.bankLinked,
                  },
                  updatedAt: now(),
                }
              : item,
          ),
        };
      }
      return recordCardPayment(undone, {
        ...action.payload,
        savingsGoalId: action.payload.savingsGoalId || expense.savingsGoalId,
        savingsGoalAmount: action.payload.savingsGoalAmount ?? expense.savingsGoalAmount,
        amount: expense.amount,
        sourceAccountId: expense.sourceAccountId!,
        transactionId: expense.id,
        cashPosted: !!expense.balanceAlreadySynced || !account?.bankLinked,
        cashAlreadySynced: expense.balanceAlreadySynced || account?.bankLinked,
      });
    }

    case "PAY_DEBT": {
      const p = action.payload;
      const debt = state.debts.find((d) => d.id === p.debtId);
      if (!debt) return state;
      const principal = p.principalAmount ?? Math.min(p.amount, debt.balance);
      const pay = p.principalAmount === undefined ? principal : p.amount;
      if (
        !Number.isFinite(pay) ||
        pay <= 0 ||
        !Number.isFinite(principal) ||
        principal < 0 ||
        principal > pay ||
        principal > debt.balance ||
        !state.accounts.some((account) => account.id === p.sourceAccountId)
      )
        return state;
      const nextBalance = clampNonNegative(debt.balance - principal);
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
        accounts: p.balanceAlreadySynced
          ? state.accounts
          : updateAccount(state, p.sourceAccountId, -pay),
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
        debtPrincipalAmount: p.principalAmount,
        debtStatusBeforePayment: debt.status,
        balanceAlreadySynced: p.balanceAlreadySynced,
      };
      return { ...next, transactions: addTx(next, tx) };
    }

    case "REVIEW_DEBT_PAYMENT": {
      const p = action.payload;
      const cents = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
      if (
        !validISODate(p.date) ||
        !cents(p.amount) ||
        !cents(p.principalAmount) ||
        !Number.isFinite(p.amount) ||
        !Number.isFinite(p.principalAmount)
      )
        return state;
      const planned = expensesComingBreakdown(state, new Date(`${p.date}T12:00:00`), "this_month")
        .flatMap((section) => section.items)
        .find(
          (item) =>
            item.sourceType === "debt_plan" &&
            item.sourceId === p.debtId &&
            item.dueDate?.slice(0, 7) === p.date.slice(0, 7),
        );
      const paid = reducer(state, { type: "PAY_DEBT", payload: p });
      if (paid === state || !planned) return paid;
      const remaining = Math.round((planned.amount - p.amount) * 100) / 100;
      return reducer(paid, {
        type: "ADD_PLANNED_EXPENSE_OVERRIDE",
        payload: {
          sourceType: "debt_plan",
          sourceId: p.debtId,
          month: p.date.slice(0, 7),
          action: remaining <= 0 ? "skip" : "override",
          ...(remaining > 0 ? { amount: remaining } : {}),
        },
      });
    }

    case "ADD_TRANSFER": {
      const p = action.payload;
      const goal = state.savingsGoals?.find((item) => item.id === p.savingsGoalId);
      if (!Number.isFinite(p.amount) || p.amount <= 0 ||
          Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 0.00001 ||
          !validISODate(p.date) || p.fromAccountId === p.toAccountId ||
          !state.accounts.some((account) => account.id === p.fromAccountId) ||
          !state.accounts.some((account) => account.id === p.toAccountId) ||
          (p.transactionId && state.transactions.some((tx) => tx.id === p.transactionId)) ||
          (p.savingsGoalId && (!goal || goalCents(backedGoalInAccount(state, goal.id, p.fromAccountId)) < goalCents(p.amount)))) return state;
      const fromLocalApplied = state.accounts.find((a) => a.id === p.fromAccountId)?.bankLinked ||
        p.debitAlreadySynced ? 0 : p.amount;
      const toLocalApplied = state.accounts.find((a) => a.id === p.toAccountId)?.bankLinked ||
        p.creditAlreadySynced ? 0 : p.amount;
      const next: AppState = {
        ...state,
        accounts: state.accounts.map((a) => {
          if (a.id === p.fromAccountId)
            return { ...a, balance: Math.round((a.balance - fromLocalApplied) * 100) / 100, updatedAt: now() };
          if (a.id === p.toAccountId)
            return { ...a, balance: Math.round((a.balance + toLocalApplied) * 100) / 100, updatedAt: now() };
          return a;
        }),
      };
      const tx: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        type: "transfer",
        amount: p.amount,
        category: "Transfer",
        description: `${state.accounts.find((a) => a.id === p.fromAccountId)?.name} to ${state.accounts.find((a) => a.id === p.toAccountId)?.name}`,
        date: p.date,
        sourceAccountId: p.fromAccountId,
        targetAccountId: p.toAccountId,
        savingsGoalId: goal?.id,
        savingsGoalAmount: goal ? p.amount : undefined,
        notes: p.notes,
        accountTransfer: { version: 1, bankDebitId: p.bankDebitId,
          bankCreditId: p.bankCreditId, fromLocalApplied, toLocalApplied },
      };
      const stamp = now();
      const transactionId = p.transactionId ?? newId();
      const result = { ...next, transactions: [{ ...tx, id: transactionId,
        createdAt: stamp, updatedAt: stamp }, ...next.transactions] };
      return goal ? addGoalMovement(addGoalMovement(result, goal.id, p.fromAccountId,
        -p.amount, p.date, "transfer_out", transactionId), goal.id, p.toAccountId,
        p.amount, p.date, "transfer_in", transactionId) : result;
    }

    case "RECONCILE_ACCOUNT_TRANSFER": {
      const tx = state.transactions.find((item) => item.id === action.id);
      if (!tx || tx.type !== "transfer" || !tx.accountTransfer || !action.bankId) return state;
      const key = action.leg === "debit" ? "bankDebitId" : "bankCreditId";
      if (tx.accountTransfer[key] === action.bankId) return state;
      if (tx.accountTransfer[key] || state.transactions.some((item) =>
        item.id !== tx.id && (item.accountTransfer?.bankDebitId === action.bankId ||
          item.accountTransfer?.bankCreditId === action.bankId))) return state;
      return { ...state, transactions: state.transactions.map((item) => item.id === tx.id
        ? { ...item, accountTransfer: { ...tx.accountTransfer!, [key]: action.bankId }, updatedAt: now() }
        : item) };
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

    case "ADD_INCOME": {
      const p = action.payload;
      const account = state.accounts.find((a) => a.id === p.accountId);
      const plannedOverride = p.plannedIncomeOverrideId
        ? state.plannedIncomeOverrides.find(
            (override) => override.id === p.plannedIncomeOverrideId && override.action === "add",
          )
        : undefined;
      if (
        !account ||
        !Number.isFinite(p.amount) ||
        p.amount <= 0 ||
        (p.plannedIncomeOverrideId && !plannedOverride) ||
        (p.transactionId && state.transactions.some((tx) => tx.id === p.transactionId))
      )
        return state;
      const next: AppState = {
        ...state,
        accounts: p.balanceAlreadySynced
          ? state.accounts
          : updateAccount(state, p.accountId, p.amount),
        plannedIncomeOverrides: plannedOverride
          ? state.plannedIncomeOverrides.filter((override) => override.id !== plannedOverride.id)
          : state.plannedIncomeOverrides,
      };
      const tx: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        type: "income",
        amount: p.amount,
        category: p.category || "Income",
        description: p.description || "Income",
        date: p.date,
        targetAccountId: p.accountId,
        notes: p.notes,
        balanceAlreadySynced: p.balanceAlreadySynced,
        linkedPlannedIncome: plannedOverride
          ? {
              itemId: plannedOverride.id,
              label: plannedOverride.label ?? "One-time income",
              originalOverride: plannedOverride,
            }
          : undefined,
      };
      return {
        ...next,
        transactions: p.transactionId
          ? [
              { ...tx, id: p.transactionId, createdAt: now(), updatedAt: now() },
              ...next.transactions,
            ]
          : addTx(next, tx),
      };
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
      const transactionId = newId();
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
                linkedTransactionId: transactionId,
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
        linkedPlannedIncome: {
          itemId: entry.id,
          label: entry.jobName,
          originalEntries: [entry],
          addedEntryIds: [],
        },
      };
      return {
        ...next,
        transactions: [
          { ...tx, id: transactionId, createdAt: now(), updatedAt: now() },
          ...next.transactions,
        ],
      };
    }
    case "UNMARK_TIMESHEET_PAID": {
      const entry = state.timesheet.find((t) => t.id === action.payload.id);
      if (!entry || !entry.paid || !entry.paidAccountId) return state;
      const linked = state.transactions.find((tx) => tx.id === entry.linkedTransactionId);
      if (linked?.balanceAlreadySynced) return state;
      if (linked?.linkedPlannedIncome && linked.type === "income") {
        const restored = undoIncomeLink(state, linked);
        return {
          ...restored,
          accounts: linked.targetAccountId
            ? updateAccountCents(restored, linked.targetAccountId, -linked.amount)
            : restored.accounts,
          transactions: restored.transactions.filter((tx) => tx.id !== linked.id),
        };
      }
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
