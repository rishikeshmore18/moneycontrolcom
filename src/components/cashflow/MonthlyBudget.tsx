import { useMemo, useState, type ComponentType } from "react";
import {
  CalendarRange,
  Car,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Fuel,
  HeartPulse,
  Pencil,
  Plane,
  Plus,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Tags,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { useApp } from "@/lib/cashflow/AppContext";
import {
  monthlyBudgetSummary,
  resolveBudgetConfig,
  type CategoryBudgetProgress,
} from "@/lib/cashflow/budget";
import { expensesComingBreakdown } from "@/lib/cashflow/forecast";
import {
  addMonths,
  endOfMonth,
  fromISODate,
  MONTH_NAMES,
  startOfMonth,
  toISODate,
} from "@/lib/cashflow/dates";
import { formatMoney, toNumber } from "@/lib/cashflow/money";
import type { BudgetRolloverPolicy, CategoryBudget } from "@/lib/cashflow/types";
import { Button } from "./Button";
import { Card } from "./Card";
import { Field, Input, Select } from "./Field";
import { Sheet } from "./Sheet";
import { toast } from "./Toast";

type BudgetIcon = ComponentType<{ size?: number; className?: string }>;
type EditorState = { mode: "add" } | { mode: "edit"; budget: CategoryBudget };

function monthKey(date: Date): string {
  return toISODate(date).slice(0, 7);
}

function monthLabel(month: string): string {
  const date = fromISODate(`${month}-01`);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function monthRange(month: string) {
  const ref = fromISODate(`${month}-15`);
  return {
    ref,
    range: {
      start: toISODate(startOfMonth(ref)),
      end: toISODate(endOfMonth(ref)),
    },
  };
}

function committedItemsForMonth(state: ReturnType<typeof useApp>["state"], month: string) {
  const { ref, range } = monthRange(month);
  return expensesComingBreakdown(state, ref, "custom", range)
    .flatMap((section) => section.items)
    .filter((item) => item.sourceType === "recurring_bill" || item.sourceType === "one_time");
}

function categoryIcon(category: string): BudgetIcon {
  const value = category.toLowerCase();
  if (value.includes("grocer")) return ShoppingCart;
  if (value.includes("fast food") || value.includes("dining")) return UtensilsCrossed;
  if (value.includes("cab")) return Car;
  if (value.includes("gas")) return Fuel;
  if (value.includes("health")) return HeartPulse;
  if (value.includes("travel")) return Plane;
  if (value.includes("shopping")) return ShoppingBag;
  if (value.includes("bill") || value.includes("subscription")) return ReceiptText;
  if (value.includes("other")) return Tags;
  return CircleDollarSign;
}

function BudgetBar({
  spent,
  committed,
  limit,
  overBy,
  label,
}: {
  spent: number;
  committed: number;
  limit: number;
  overBy: number;
  label: string;
}) {
  const spentWidth = limit > 0 ? Math.min(100, (spent / limit) * 100) : spent > 0 ? 100 : 0;
  const committedWidth =
    limit > 0
      ? Math.min(100 - spentWidth, (committed / limit) * 100)
      : committed > 0
        ? 100 - spentWidth
        : 0;
  return (
    <div
      className="h-3 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(1, limit)}
      aria-valuenow={Math.min(limit, spent + committed)}
    >
      <div className="flex h-full w-full">
        <div
          className={`h-full transition-[width] ${overBy > 0 ? "bg-[color:var(--bad)]" : "bg-[color:var(--good)]"}`}
          style={{ width: `${spentWidth}%` }}
        />
        <div
          className={`h-full transition-[width] ${overBy > 0 ? "bg-[color:var(--bad)]/70" : "bg-[color:var(--warn)]"}`}
          style={{ width: `${committedWidth}%` }}
        />
      </div>
    </div>
  );
}

export function MonthlyBudgetCard({ className = "" }: { className?: string }) {
  const { state } = useApp();
  const [open, setOpen] = useState(false);
  const currentMonth = monthKey(new Date());
  const committed = useMemo(
    () => committedItemsForMonth(state, currentMonth),
    [currentMonth, state],
  );
  const summary = useMemo(
    () => monthlyBudgetSummary(state, currentMonth, committed),
    [committed, currentMonth, state],
  );
  const money = (amount: number) => formatMoney(amount, state.profile.currency);

  return (
    <>
      <Card className={`!p-0 overflow-hidden ${className}`}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarRange size={18} className="shrink-0 text-[color:var(--primary)]" />
              <h2 className="truncate text-lg font-black">{monthLabel(currentMonth)} budget</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Category limits update automatically from your expenses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-[color:var(--card-solid)] text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
            aria-label="Manage monthly budgets"
            title="Manage monthly budgets"
          >
            {summary.categories.length > 0 ? <Pencil size={17} /> : <Plus size={18} />}
          </button>
        </div>

        {summary.categories.length === 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-28 w-full items-center gap-4 px-4 py-5 text-left transition hover:bg-muted/40 sm:px-5"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-[color:var(--primary)]">
              <CircleDollarSign size={21} />
            </span>
            <span className="min-w-0">
              <span className="block font-black">Create your first category budget</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Set a monthly limit for groceries, dining, cab, or any category.
              </span>
            </span>
            <ChevronRight size={18} className="ml-auto shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="block w-full px-4 py-5 text-left transition hover:bg-muted/30 sm:px-5"
          >
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-2xl font-black">
                  {money(summary.totalSpent)}{" "}
                  <span className="text-sm font-semibold text-muted-foreground">
                    of {money(summary.totalLimit)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {money(summary.totalCommitted)} upcoming
                  <span aria-hidden="true"> · </span>
                  {summary.totalOverBy > 0
                    ? `${money(summary.totalOverBy)} over`
                    : `${money(summary.totalRemaining)} remaining`}
                </div>
              </div>
              <div
                className={`shrink-0 text-sm font-black ${
                  summary.totalOverBy > 0 ? "text-[color:var(--bad)]" : "text-[color:var(--good)]"
                }`}
              >
                {Math.round(summary.spentPercent)}%
              </div>
            </div>
            <div className="mt-4">
              <BudgetBar
                spent={summary.totalSpent}
                committed={summary.totalCommitted}
                limit={summary.totalLimit}
                overBy={summary.totalOverBy}
                label={`${monthLabel(currentMonth)} budget progress`}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[color:var(--good)]" />
                Spent
              </span>
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[color:var(--warn)]" />
                Upcoming
              </span>
              {summary.protectedRemaining > 0 && (
                <span className="inline-flex items-center gap-1 text-[color:var(--good)]">
                  <ShieldCheck size={13} />
                  {money(summary.protectedRemaining)} protected
                </span>
              )}
            </div>
          </button>
        )}
      </Card>
      <MonthlyBudgetSheet open={open} onClose={() => setOpen(false)} initialMonth={currentMonth} />
    </>
  );
}

export function CategoryBudgetsProfileCard() {
  const { state, dispatch } = useApp();
  const currentMonth = monthKey(new Date());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CategoryBudget | null>(null);
  const committed = useMemo(
    () => committedItemsForMonth(state, currentMonth),
    [currentMonth, state],
  );
  const summary = useMemo(
    () => monthlyBudgetSummary(state, currentMonth, committed),
    [committed, currentMonth, state],
  );
  const money = (amount: number) => formatMoney(amount, state.profile.currency);
  const budgets = state.categoryBudgets ?? [];

  return (
    <>
      <Card>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarRange size={18} className="shrink-0 text-[color:var(--primary)]" />
              <h3 className="text-lg font-extrabold">Category budgets</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Set once and use every month until you change or remove it.
            </p>
          </div>
          <Button variant="ghost" onClick={() => setAdding(true)} className="shrink-0">
            <Plus size={14} />
            Add
          </Button>
        </div>

        {budgets.length === 0 ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-24 w-full items-center gap-3 rounded-lg px-1 py-4 text-left transition hover:bg-foreground/5"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-[color:var(--primary)]">
              <CircleDollarSign size={20} />
            </span>
            <span>
              <span className="block font-bold">No category budgets</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Add an ongoing monthly limit for groceries, dining, cab, or any category.
              </span>
            </span>
          </button>
        ) : (
          <>
            <div className="my-4 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-muted-foreground">
                    {monthLabel(currentMonth)} progress
                  </div>
                  <div className="mt-1 text-xl font-black">
                    {money(summary.totalSpent)}{" "}
                    <span className="text-sm font-semibold text-muted-foreground">
                      of {money(summary.totalLimit)}
                    </span>
                  </div>
                </div>
                <div
                  className={`text-sm font-black ${
                    summary.totalOverBy > 0 ? "text-[color:var(--bad)]" : "text-[color:var(--good)]"
                  }`}
                >
                  {Math.round(summary.spentPercent)}%
                </div>
              </div>
              <div className="mt-3">
                <BudgetBar
                  spent={summary.totalSpent}
                  committed={summary.totalCommitted}
                  limit={summary.totalLimit}
                  overBy={summary.totalOverBy}
                  label={`${monthLabel(currentMonth)} budget progress`}
                />
              </div>
            </div>

            <div className="divide-y divide-border">
              {budgets.map((budget) => {
                const progress = summary.categories.find(
                  (category) => category.budget.id === budget.id,
                );
                const config = resolveBudgetConfig(state, budget, currentMonth);
                const monthlyLimit = config?.amount ?? budget.amount;
                const Icon = categoryIcon(budget.category);
                return (
                  <div key={budget.id} className="flex items-center gap-3 py-3">
                    <button
                      type="button"
                      onClick={() => setEditing(budget)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-foreground/5"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-[color:var(--primary)]">
                        <Icon size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{budget.category}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {progress
                            ? `${money(progress.spent)} spent · ${money(progress.committed)} upcoming`
                            : `Starts ${monthLabel(budget.startMonth)}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-black">{money(monthlyLimit)}</span>
                        <span className="block text-xs text-muted-foreground">per month</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(budget)}
                      className="p-1.5 text-muted-foreground hover:text-foreground"
                      aria-label={`Edit ${budget.category} budget`}
                      title={`Edit ${budget.category} budget`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove the ${budget.category} budget from future planning?`)) {
                          dispatch({ type: "DELETE_CATEGORY_BUDGET", id: budget.id });
                          toast(`${budget.category} budget removed`);
                        }
                      }}
                      className="p-1.5 text-[color:var(--bad)]"
                      aria-label={`Delete ${budget.category} budget`}
                      title={`Delete ${budget.category} budget`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {(adding || editing) && (
        <OngoingBudgetSheet
          initial={editing ?? undefined}
          currentMonth={currentMonth}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function OngoingBudgetSheet({
  initial,
  currentMonth,
  onClose,
}: {
  initial?: CategoryBudget;
  currentMonth: string;
  onClose: () => void;
}) {
  const { state, dispatch } = useApp();
  const currentConfig = initial ? resolveBudgetConfig(state, initial, currentMonth) : null;
  const usedCategories = new Set(
    (state.categoryBudgets ?? []).map((budget) => budget.category.toLowerCase()),
  );
  const availableCategories = state.categories.filter(
    (category) => !usedCategories.has(category.toLowerCase()),
  );
  const [category, setCategory] = useState(initial?.category ?? availableCategories[0] ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [amount, setAmount] = useState(
    initial ? String(currentConfig?.amount ?? initial.amount) : "",
  );
  const [protect, setProtect] = useState(
    currentConfig?.protectInSpendableToday ?? initial?.protectInSpendableToday ?? true,
  );
  const [rollover, setRollover] = useState<BudgetRolloverPolicy>(
    currentConfig?.rolloverPolicy ?? initial?.rolloverPolicy ?? "reset",
  );

  function save() {
    const selectedCategory = category === "__new" ? newCategory.trim() : category;
    const parsedAmount = toNumber(amount);
    if (!selectedCategory) return toast("Choose a category");
    if (parsedAmount <= 0) return toast("Enter a monthly limit above zero");

    if (initial) {
      dispatch({
        type: "SET_CATEGORY_BUDGET_OVERRIDE",
        payload: {
          budgetId: initial.id,
          month: currentMonth,
          scope: "from_month",
          amount: parsedAmount,
          protectInSpendableToday: protect,
          rolloverPolicy: rollover,
        },
      });
      toast(`${initial.category} budget updated for this and future months`);
    } else {
      if (category === "__new") {
        dispatch({ type: "ADD_CATEGORY", category: selectedCategory });
      }
      dispatch({
        type: "ADD_CATEGORY_BUDGET",
        payload: {
          category: selectedCategory,
          amount: parsedAmount,
          startMonth: currentMonth,
          protectInSpendableToday: protect,
          rolloverPolicy: rollover,
          active: true,
        },
      });
      toast(`${selectedCategory} monthly budget created`);
    }
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? "Edit category budget" : "Add category budget"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          {initial ? (
            <div className="flex min-h-12 items-center rounded-2xl border border-border bg-muted/40 px-4 font-bold">
              {initial.category}
            </div>
          ) : (
            <Select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Choose category</option>
              {availableCategories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
              <option value="__new">Add new category</option>
            </Select>
          )}
        </Field>
        {!initial && category === "__new" && (
          <Field label="New category">
            <Input
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              placeholder="Category name"
            />
          </Field>
        )}
        <Field label="Monthly limit">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Unused money">
          <Select
            value={rollover}
            onChange={(event) => setRollover(event.target.value as BudgetRolloverPolicy)}
          >
            <option value="reset">Reset every month</option>
            <option value="carry_remaining">Carry remaining forward</option>
          </Select>
        </Field>
        <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:col-span-2">
          <input
            type="checkbox"
            checked={protect}
            onChange={(event) => setProtect(event.target.checked)}
            className="mt-0.5 h-5 w-5 accent-[color:var(--primary)]"
          />
          <span>
            <span className="flex items-center gap-2 font-black">
              <ShieldCheck size={17} className="text-[color:var(--good)]" />
              Protect in Spendable Today
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              Reserves the unused monthly allowance so it is not shown as safe surplus.
            </span>
          </span>
        </label>
        <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground sm:col-span-2">
          This is an ongoing monthly rule. Changes made here apply from {monthLabel(currentMonth)}{" "}
          forward.
        </div>
      </div>
    </Sheet>
  );
}

function MonthlyBudgetSheet({
  open,
  onClose,
  initialMonth,
}: {
  open: boolean;
  onClose: () => void;
  initialMonth: string;
}) {
  const { state, dispatch } = useApp();
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [protect, setProtect] = useState(true);
  const [rollover, setRollover] = useState<BudgetRolloverPolicy>("reset");
  const [scope, setScope] = useState<"month" | "from_month">("from_month");
  const committed = useMemo(
    () => committedItemsForMonth(state, selectedMonth),
    [selectedMonth, state],
  );
  const summary = useMemo(
    () => monthlyBudgetSummary(state, selectedMonth, committed),
    [committed, selectedMonth, state],
  );
  const money = (value: number) => formatMoney(value, state.profile.currency);
  const usedCategories = new Set(
    (state.categoryBudgets ?? []).map((budget) => budget.category.toLowerCase()),
  );
  const availableCategories = state.categories.filter(
    (item) => !usedCategories.has(item.toLowerCase()),
  );

  function moveMonth(offset: number) {
    setSelectedMonth(monthKey(addMonths(fromISODate(`${selectedMonth}-01`), offset)));
    setEditor(null);
  }

  function openAdd() {
    setCategory(availableCategories[0] ?? "");
    setNewCategory("");
    setAmount("");
    setProtect(true);
    setRollover("reset");
    setScope("from_month");
    setEditor({ mode: "add" });
  }

  function openEdit(progress: CategoryBudgetProgress) {
    setCategory(progress.budget.category);
    setAmount(String(progress.baseLimit));
    setProtect(progress.protectInSpendableToday);
    setRollover(progress.rolloverPolicy);
    setScope("month");
    setEditor({ mode: "edit", budget: progress.budget });
  }

  function save() {
    const parsedAmount = toNumber(amount);
    const selectedCategory = category === "__new" ? newCategory.trim() : category;
    if (!selectedCategory) return toast("Choose a category");
    if (parsedAmount <= 0) return toast("Enter a budget above zero");
    if (editor?.mode === "add") {
      if (category === "__new") {
        dispatch({ type: "ADD_CATEGORY", category: selectedCategory });
      }
      dispatch({
        type: "ADD_CATEGORY_BUDGET",
        payload: {
          category: selectedCategory,
          amount: parsedAmount,
          startMonth: selectedMonth,
          protectInSpendableToday: protect,
          rolloverPolicy: rollover,
          active: true,
        },
      });
      toast(`${selectedCategory} budget created`);
    } else if (editor?.mode === "edit") {
      dispatch({
        type: "SET_CATEGORY_BUDGET_OVERRIDE",
        payload: {
          budgetId: editor.budget.id,
          month: selectedMonth,
          scope,
          amount: parsedAmount,
          protectInSpendableToday: protect,
          rolloverPolicy: rollover,
        },
      });
      toast(scope === "month" ? "Budget updated for this month" : "Budget updated from this month");
    }
    setEditor(null);
  }

  function removeBudget(budget: CategoryBudget) {
    dispatch({ type: "DELETE_CATEGORY_BUDGET", id: budget.id });
    toast(`${budget.category} budget removed`);
    setEditor(null);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        editor
          ? editor.mode === "add"
            ? "Add category budget"
            : "Edit category budget"
          : "Monthly budget"
      }
      size="wide"
      footer={
        editor ? (
          <>
            {editor.mode === "edit" && (
              <Button
                variant="danger"
                onClick={() => removeBudget(editor.budget)}
                className="mr-auto"
              >
                <Trash2 size={16} />
                Remove
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </>
        ) : undefined
      }
    >
      {editor ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            {editor.mode === "add" ? (
              <Select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Choose category</option>
                {availableCategories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
                <option value="__new">Add new category</option>
              </Select>
            ) : (
              <div className="flex min-h-12 items-center rounded-2xl border border-border bg-muted/40 px-4 font-bold">
                {category}
              </div>
            )}
          </Field>
          {editor.mode === "add" && category === "__new" && (
            <Field label="New category">
              <Input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="Category name"
              />
            </Field>
          )}
          <Field label="Monthly limit">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </Field>
          {editor.mode === "edit" && (
            <Field label="Apply change">
              <Select
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
              >
                <option value="month">This month only</option>
                <option value="from_month">This and future months</option>
              </Select>
            </Field>
          )}
          <Field label="Unused money">
            <Select
              value={rollover}
              onChange={(event) => setRollover(event.target.value as BudgetRolloverPolicy)}
            >
              <option value="reset">Reset every month</option>
              <option value="carry_remaining">Carry remaining forward</option>
            </Select>
          </Field>
          <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:col-span-2">
            <input
              type="checkbox"
              checked={protect}
              onChange={(event) => setProtect(event.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[color:var(--primary)]"
            />
            <span>
              <span className="flex items-center gap-2 font-black">
                <ShieldCheck size={17} className="text-[color:var(--good)]" />
                Protect in Spendable Today
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Keeps the unused allowance outside your safe surplus. Turn this off to track only.
              </span>
            </span>
          </label>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="grid h-11 w-11 place-items-center rounded-xl border border-border hover:bg-muted"
              aria-label="Previous month"
              title="Previous month"
            >
              <ChevronLeft size={19} />
            </button>
            <div className="min-w-0 text-center">
              <div className="font-black">{monthLabel(selectedMonth)}</div>
              {selectedMonth !== initialMonth && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMonth(initialMonth);
                    setEditor(null);
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[color:var(--primary)] hover:underline"
                >
                  <RotateCcw size={12} />
                  Current month
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="grid h-11 w-11 place-items-center rounded-xl border border-border hover:bg-muted"
              aria-label="Next month"
              title="Next month"
            >
              <ChevronRight size={19} />
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-muted/25 p-4 sm:p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase text-muted-foreground">
                  Overall category budget
                </div>
                <div className="mt-1 text-2xl font-black">
                  {money(summary.totalSpent)}{" "}
                  <span className="text-sm font-semibold text-muted-foreground">
                    of {money(summary.totalLimit)}
                  </span>
                </div>
              </div>
              <div
                className={`text-sm font-black ${
                  summary.totalOverBy > 0 ? "text-[color:var(--bad)]" : "text-[color:var(--good)]"
                }`}
              >
                {Math.round(summary.spentPercent)}%
              </div>
            </div>
            <div className="mt-4">
              <BudgetBar
                spent={summary.totalSpent}
                committed={summary.totalCommitted}
                limit={summary.totalLimit}
                overBy={summary.totalOverBy}
                label={`${monthLabel(selectedMonth)} overall budget progress`}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <BudgetMetric label="Spent" value={money(summary.totalSpent)} />
              <BudgetMetric label="Upcoming" value={money(summary.totalCommitted)} />
              <BudgetMetric
                label={summary.totalOverBy > 0 ? "Over" : "Remaining"}
                value={money(summary.totalOverBy || summary.totalRemaining)}
                bad={summary.totalOverBy > 0}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-black">Category limits</h3>
              <p className="text-xs text-muted-foreground">
                Dark is spent, amber is upcoming, and light is available.
              </p>
            </div>
            <Button variant="ghost" onClick={openAdd} className="shrink-0">
              <Plus size={16} />
              Add
            </Button>
          </div>

          {summary.categories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center">
              <CircleDollarSign size={28} className="mx-auto text-[color:var(--primary)]" />
              <div className="mt-3 font-black">No category budgets yet</div>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Add a limit to compare this month&apos;s real and planned spending.
              </p>
              <Button variant="primary" onClick={openAdd} className="mt-4">
                <Plus size={16} />
                Add budget
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {summary.categories.map((progress) => (
                <CategoryBudgetRow
                  key={progress.budget.id}
                  progress={progress}
                  currency={state.profile.currency}
                  onEdit={() => openEdit(progress)}
                />
              ))}
            </div>
          )}

          {(summary.unbudgetedSpent > 0 || summary.unbudgetedCommitted > 0) && (
            <div className="flex items-start gap-3 rounded-2xl border border-[color:var(--warn)]/35 bg-[color:var(--warn)]/8 p-4">
              <Tags size={18} className="mt-0.5 shrink-0 text-[color:var(--warn)]" />
              <div>
                <div className="font-black">Unbudgeted spending</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {money(summary.unbudgetedSpent)} spent and {money(summary.unbudgetedCommitted)}{" "}
                  upcoming in categories without a limit.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function CategoryBudgetRow({
  progress,
  currency,
  onEdit,
}: {
  progress: CategoryBudgetProgress;
  currency: string;
  onEdit: () => void;
}) {
  const Icon = categoryIcon(progress.budget.category);
  const money = (amount: number) => formatMoney(amount, currency);
  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-[color:var(--primary)]">
          <Icon size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-black">{progress.budget.category}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {money(progress.spent)} spent
                <span aria-hidden="true"> · </span>
                {money(progress.committed)} upcoming
              </div>
            </div>
            <button
              type="button"
              onClick={onEdit}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border hover:bg-muted"
              aria-label={`Edit ${progress.budget.category} budget`}
              title={`Edit ${progress.budget.category} budget`}
            >
              <Pencil size={15} />
            </button>
          </div>
          <div className="mt-3">
            <BudgetBar
              spent={progress.spent}
              committed={progress.committed}
              limit={progress.limit}
              overBy={progress.overBy}
              label={`${progress.budget.category} budget progress`}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span
              className={
                progress.overBy > 0 ? "font-black text-[color:var(--bad)]" : "text-muted-foreground"
              }
            >
              {progress.overBy > 0
                ? `${money(progress.overBy)} over`
                : `${money(progress.remaining)} remaining`}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              {progress.protectInSpendableToday ? (
                <>
                  <ShieldCheck size={13} className="text-[color:var(--good)]" />
                  Protected
                </>
              ) : (
                "Track only"
              )}
              {progress.rolloverAmount > 0 && (
                <>
                  <span aria-hidden="true"> · </span>
                  {money(progress.rolloverAmount)} carried
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BudgetMetric({
  label,
  value,
  bad = false,
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-[color:var(--card-solid)] px-2 py-3">
      <div className="truncate text-[10px] font-bold uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-sm font-black ${bad ? "text-[color:var(--bad)]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
