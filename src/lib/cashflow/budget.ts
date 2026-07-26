import type {
  AppState,
  BudgetRolloverPolicy,
  CategoryBudget,
  CategoryBudgetOverride,
} from "./types";
import { addMonths, fromISODate, toISODate } from "./dates";

export interface BudgetCommittedItem {
  amount: number;
  category?: string;
}

export interface ResolvedBudgetConfig {
  amount: number;
  protectInSpendableToday: boolean;
  rolloverPolicy: BudgetRolloverPolicy;
}

export interface CategoryBudgetProgress {
  budget: CategoryBudget;
  month: string;
  limit: number;
  baseLimit: number;
  rolloverAmount: number;
  spent: number;
  committed: number;
  remaining: number;
  overBy: number;
  spentPercent: number;
  allocatedPercent: number;
  protectInSpendableToday: boolean;
  rolloverPolicy: BudgetRolloverPolicy;
}

export interface MonthlyBudgetSummary {
  month: string;
  totalLimit: number;
  totalSpent: number;
  totalCommitted: number;
  totalRemaining: number;
  totalOverBy: number;
  spentPercent: number;
  allocatedPercent: number;
  protectedRemaining: number;
  categories: CategoryBudgetProgress[];
  unbudgetedSpent: number;
  unbudgetedCommitted: number;
}

function categoryKey(category: string | undefined): string {
  return (category ?? "").trim().toLocaleLowerCase();
}

export function monthKey(date: Date): string {
  return toISODate(date).slice(0, 7);
}

function nextMonth(month: string): string {
  return monthKey(addMonths(fromISODate(`${month}-01`), 1));
}

function overridesForBudget(state: AppState, budgetId: string): CategoryBudgetOverride[] {
  return (state.categoryBudgetOverrides ?? []).filter((override) => override.budgetId === budgetId);
}

export function resolveBudgetConfig(
  state: AppState,
  budget: CategoryBudget,
  month: string,
): ResolvedBudgetConfig | null {
  if (!budget.active || month < budget.startMonth) return null;
  const overrides = overridesForBudget(state, budget.id);
  const futureOverride = overrides
    .filter((override) => override.scope === "from_month" && override.month <= month)
    .sort((a, b) => a.month.localeCompare(b.month))
    .at(-1);
  const monthOverride = overrides.find(
    (override) => override.scope === "month" && override.month === month,
  );
  const resolved = monthOverride ?? futureOverride;
  return {
    amount: Math.max(0, resolved?.amount ?? budget.amount),
    protectInSpendableToday: resolved?.protectInSpendableToday ?? budget.protectInSpendableToday,
    rolloverPolicy: resolved?.rolloverPolicy ?? budget.rolloverPolicy,
  };
}

export function actualCategorySpend(state: AppState, category: string, month: string): number {
  const key = categoryKey(category);
  const netSpend = (state.transactions ?? [])
    .filter(
      (transaction) =>
        transaction.type === "expense" &&
        transaction.date.slice(0, 7) === month &&
        categoryKey(transaction.category) === key,
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  return Math.max(0, netSpend);
}

function rolloverBeforeMonth(state: AppState, budget: CategoryBudget, targetMonth: string): number {
  let cursor = budget.startMonth;
  let carry = 0;
  let guard = 0;
  while (cursor < targetMonth && guard < 240) {
    const config = resolveBudgetConfig(state, budget, cursor);
    if (!config) return 0;
    const spent = actualCategorySpend(state, budget.category, cursor);
    carry =
      config.rolloverPolicy === "carry_remaining" ? Math.max(0, config.amount + carry - spent) : 0;
    cursor = nextMonth(cursor);
    guard += 1;
  }
  return carry;
}

export function monthlyBudgetSummary(
  state: AppState,
  month: string,
  committedItems: BudgetCommittedItem[] = [],
): MonthlyBudgetSummary {
  const budgets = (state.categoryBudgets ?? []).filter(
    (budget) => resolveBudgetConfig(state, budget, month) !== null,
  );
  const budgetedCategories = new Set(budgets.map((budget) => categoryKey(budget.category)));
  const committedByCategory = new Map<string, number>();
  committedItems.forEach((item) => {
    const key = categoryKey(item.category);
    if (!key) return;
    committedByCategory.set(key, (committedByCategory.get(key) ?? 0) + Math.max(0, item.amount));
  });

  const categories = budgets
    .map((budget): CategoryBudgetProgress => {
      const config = resolveBudgetConfig(state, budget, month)!;
      const rolloverAmount =
        config.rolloverPolicy === "carry_remaining" ? rolloverBeforeMonth(state, budget, month) : 0;
      const limit = config.amount + rolloverAmount;
      const spent = actualCategorySpend(state, budget.category, month);
      const committed = committedByCategory.get(categoryKey(budget.category)) ?? 0;
      const allocated = spent + committed;
      return {
        budget,
        month,
        limit,
        baseLimit: config.amount,
        rolloverAmount,
        spent,
        committed,
        remaining: Math.max(0, limit - allocated),
        overBy: Math.max(0, allocated - limit),
        spentPercent: limit > 0 ? (spent / limit) * 100 : spent > 0 ? 100 : 0,
        allocatedPercent: limit > 0 ? (allocated / limit) * 100 : allocated > 0 ? 100 : 0,
        protectInSpendableToday: config.protectInSpendableToday,
        rolloverPolicy: config.rolloverPolicy,
      };
    })
    .sort((a, b) => b.allocatedPercent - a.allocatedPercent);

  const unbudgetedByCategory = new Map<string, number>();
  (state.transactions ?? [])
    .filter(
      (transaction) =>
        transaction.type === "expense" &&
        transaction.date.slice(0, 7) === month &&
        !budgetedCategories.has(categoryKey(transaction.category)),
    )
    .forEach((transaction) => {
      const key = categoryKey(transaction.category);
      unbudgetedByCategory.set(key, (unbudgetedByCategory.get(key) ?? 0) + transaction.amount);
    });
  const unbudgetedSpent = [...unbudgetedByCategory.values()].reduce(
    (sum, amount) => sum + Math.max(0, amount),
    0,
  );
  const unbudgetedCommitted = committedItems
    .filter((item) => !budgetedCategories.has(categoryKey(item.category)))
    .reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const totalLimit = categories.reduce((sum, category) => sum + category.limit, 0);
  const totalSpent = categories.reduce((sum, category) => sum + category.spent, 0);
  const totalCommitted = categories.reduce((sum, category) => sum + category.committed, 0);
  const totalRemaining = categories.reduce((sum, category) => sum + category.remaining, 0);
  const totalOverBy = categories.reduce((sum, category) => sum + category.overBy, 0);

  return {
    month,
    totalLimit,
    totalSpent,
    totalCommitted,
    totalRemaining,
    totalOverBy,
    spentPercent: totalLimit > 0 ? (totalSpent / totalLimit) * 100 : totalSpent > 0 ? 100 : 0,
    allocatedPercent:
      totalLimit > 0
        ? ((totalSpent + totalCommitted) / totalLimit) * 100
        : totalSpent + totalCommitted > 0
          ? 100
          : 0,
    protectedRemaining: categories
      .filter((category) => category.protectInSpendableToday)
      .reduce((sum, category) => sum + category.remaining, 0),
    categories,
    unbudgetedSpent,
    unbudgetedCommitted,
  };
}
