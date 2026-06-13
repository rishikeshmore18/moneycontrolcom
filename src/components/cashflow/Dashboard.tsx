import { useMemo, useState } from "react";
import {
  CalendarClock,
  Eye,
  Info,
  Pencil,
  Plus,
  ReceiptText,
  Target,
  Trash2,
  Wallet,
} from "lucide-react";
import { Card, KPI } from "./Card";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { Field, Input, Select } from "./Field";
import { useApp } from "@/lib/cashflow/AppContext";
import {
  type CashFlowBreakdownItem,
  type CashFlowBreakdownSection,
  type CashFlowPeriod,
  cashFlowPeriodLabels,
  expensesComingBreakdown,
  expensesComingTotal,
  leftToSpendBreakdown,
  netWorth,
  pendingIncome,
  pendingIncomeBreakdown,
  safeToSpend,
  isSpendableAccount,
  spendableToday,
  spendableTodayBreakdown,
  spendableCash,
  spendableCashBreakdown,
  totalCardDebt,
  totalCash,
} from "@/lib/cashflow/forecast";
import { formatMoney, toNumber } from "@/lib/cashflow/money";
import {
  currentOpenCycle,
  expensesInCycle,
  isLikelyPendingNearStatement,
  utilization,
} from "@/lib/cashflow/cardLogic";
import { formatDisplayDate, todayISO } from "@/lib/cashflow/dates";
import { CardSheet, DebtSheet, RecurringSheet } from "./Profile";
import { toast } from "./Toast";

type BreakdownKey =
  | "have_now"
  | "income_coming"
  | "expenses_coming"
  | "left_to_spend"
  | "spendable_today";

type ExpenseAction =
  | { type: "add_one_time" }
  | { type: "edit_recurring_month"; item: CashFlowBreakdownItem }
  | { type: "edit_recurring_permanent"; item: CashFlowBreakdownItem }
  | { type: "delete_recurring"; item: CashFlowBreakdownItem }
  | { type: "pay_bill"; item: CashFlowBreakdownItem }
  | { type: "pay_card"; item: CashFlowBreakdownItem }
  | { type: "view_card"; item: CashFlowBreakdownItem }
  | { type: "skip_debt"; item: CashFlowBreakdownItem }
  | { type: "pay_debt"; item: CashFlowBreakdownItem }
  | { type: "edit_card"; item: CashFlowBreakdownItem }
  | { type: "edit_debt"; item: CashFlowBreakdownItem };

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function Dashboard() {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const m = (n: number) => formatMoney(n, cur);
  const [activeBreakdown, setActiveBreakdown] = useState<BreakdownKey | null>(null);
  const [expenseAction, setExpenseAction] = useState<ExpenseAction | null>(null);
  const [cashFlowPeriod, setCashFlowPeriod] = useState<CashFlowPeriod>("this_month");

  const haveNow = spendableCash(state);
  const incomeComing = pendingIncome(state, new Date(), cashFlowPeriod);
  const expensesComing = expensesComingTotal(state, new Date(), cashFlowPeriod);
  const leftToSpend = haveNow + incomeComing - expensesComing;
  const spendableNow = spendableToday(state);
  const sts = safeToSpend(state);
  const recent = useMemo(() => state.transactions.slice(0, 8), [state.transactions]);
  const breakdowns = useMemo(
    () => ({
      have_now: {
        title: "Have now",
        helper: "Current spendable cash across accounts",
        total: haveNow,
        tone: "green" as const,
        sections: spendableCashBreakdown(state),
      },
      income_coming: {
        title: "Income coming",
        helper: "Expected this month and not received yet",
        total: incomeComing,
        tone: "blue" as const,
        sections: pendingIncomeBreakdown(state, new Date(), cashFlowPeriod),
      },
      expenses_coming: {
        title: "Expenses coming",
        helper: "Bills, upcoming card bills, and debt plan",
        total: expensesComing,
        tone: "orange" as const,
        sections: expensesComingBreakdown(state, new Date(), cashFlowPeriod),
      },
      left_to_spend: {
        title: leftToSpend < 0 ? "Shortfall" : "Left to spend",
        helper:
          leftToSpend < 0
            ? "Have now + income coming - expenses coming"
            : "Available after planned expenses",
        total: leftToSpend,
        tone: leftToSpend < 0 ? ("red" as const) : ("teal" as const),
        sections: leftToSpendBreakdown(state, new Date(), cashFlowPeriod),
      },
      spendable_today: {
        title: "Spendable today",
        helper: "Cash you can use before the next unpaid income arrives",
        total: spendableNow,
        tone: spendableNow < 0 ? ("red" as const) : ("green" as const),
        sections: spendableTodayBreakdown(state),
      },
    }),
    [cashFlowPeriod, expensesComing, haveNow, incomeComing, leftToSpend, spendableNow, state],
  );
  const activeBreakdownData = activeBreakdown ? breakdowns[activeBreakdown] : null;
  const currentMonth = monthKey(new Date());
  const selectedExpenseSections = breakdowns.expenses_coming.sections;
  const totalForSections = (titles: string[]) =>
    selectedExpenseSections
      .filter((section) => titles.includes(section.title))
      .reduce(
        (sum, section) => sum + section.items.reduce((itemSum, item) => itemSum + item.amount, 0),
        0,
      );

  function skipItemForMonth(item: CashFlowBreakdownItem) {
    if (!item.sourceType || (!item.sourceId && item.sourceType !== "one_time")) return;
    const itemMonth = item.periodDate?.slice(0, 7) ?? item.dueDate?.slice(0, 7) ?? currentMonth;
    if (item.overrideId && item.sourceType === "one_time") {
      dispatch({ type: "DELETE_PLANNED_EXPENSE_OVERRIDE", id: item.overrideId });
      toast("Planned expense removed");
      return;
    }
    dispatch({
      type: "ADD_PLANNED_EXPENSE_OVERRIDE",
      payload: {
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        month: itemMonth,
        action: "skip",
      },
    });
    toast("Skipped for this month");
  }

  return (
    <div className="grid gap-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">
            Hi{state.profile.name ? `, ${state.profile.name}` : ""} 👋
          </h1>
          <p className="text-sm text-muted-foreground">Here's where your money stands today.</p>
        </div>
      </header>

      <CashFlowFormulaCard
        haveNow={haveNow}
        incomeComing={incomeComing}
        expensesComing={expensesComing}
        leftToSpend={leftToSpend}
        spendableToday={spendableNow}
        period={cashFlowPeriod}
        onPeriodChange={setCashFlowPeriod}
        formatMoney={m}
        onOpenBreakdown={setActiveBreakdown}
      />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <KPI
          label="Safe to spend"
          value={m(sts)}
          tone={sts <= 0 ? "bad" : sts < 100 ? "warn" : "good"}
          hint={`Floor ${m(state.profile.safeToSpendFloor)}`}
        />
        <KPI
          label="Total cash"
          value={m(totalCash(state))}
          hint={`${state.accounts.filter((a) => a.availableForSpending !== false).length} accounts`}
        />
        <KPI
          label="Card debt"
          value={m(totalCardDebt(state))}
          tone={totalCardDebt(state) > 0 ? "warn" : "default"}
          hint={`${state.cards.length} cards`}
        />
        <KPI label="Net worth" value={m(netWorth(state))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionTitle title="Accounts" hint={`${state.accounts.length} total`} />
          <div className="divide-y divide-border">
            {state.accounts.length === 0 && <Empty label="No accounts yet" />}
            {state.accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-bold">{a.name}</div>
                  {a.availableForSpending === false && (
                    <div className="text-xs text-[color:var(--warn)]">
                      Reserved{a.savingsPurpose ? ` for ${a.savingsPurpose}` : ""}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground capitalize">
                    {a.bankName ? `${a.bankName} · ` : ""}
                    {a.type}
                  </div>
                </div>
                <div className={`font-black ${a.balance < 0 ? "text-[color:var(--bad)]" : ""}`}>
                  {m(a.balance)}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title={cashFlowPeriodLabels[cashFlowPeriod]} />
          <Row
            label="Upcoming bills"
            value={m(totalForSections(["Bills", "One-time planned expenses"]))}
          />
          <Row label="Upcoming card bills" value={m(totalForSections(["Upcoming card bills"]))} />
          <Row label="Debt plan" value={m(totalForSections(["Debt plan"]))} />
          <Row label="Pending income" value={m(incomeComing)} tone="good" />
          <div className="mt-3 pt-3 border-t border-border">
            <Row
              label={
                cashFlowPeriod === "this_month" ? "Projected month-end" : "Projected after period"
              }
              value={m(leftToSpend)}
              bold
            />
          </div>
        </Card>
      </div>

      {state.cards.length > 0 && (
        <Card>
          <SectionTitle title="Card utilization" />
          <div className="grid gap-3">
            {state.cards.map((c) => {
              const u = utilization(c) * 100;
              const over = u > c.targetUtilizationPercent;
              return (
                <div key={c.id}>
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="font-bold">{c.name}</div>
                    <div
                      className={`text-sm font-bold ${over ? "text-[color:var(--warn)]" : "text-muted-foreground"}`}
                    >
                      {u.toFixed(0)}% of {m(c.limit)}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, u)}%`,
                        background: over ? "var(--warn)" : "var(--gradient-brand)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle title="Recent activity" />
        {recent.length === 0 && <Empty label="No transactions yet" />}
        <div className="divide-y divide-border">
          {recent.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="font-medium truncate">{t.description || t.category}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {t.type.replace("_", " ")} · {formatDisplayDate(t.date)}
                </div>
              </div>
              <div
                className={`font-black ${
                  t.type === "income"
                    ? "text-[color:var(--good)]"
                    : t.type === "expense" || t.type === "card_payment" || t.type === "debt_payment"
                      ? "text-[color:var(--bad)]"
                      : ""
                }`}
              >
                {t.type === "income"
                  ? "+"
                  : t.type === "expense" || t.type === "card_payment" || t.type === "debt_payment"
                    ? "-"
                    : ""}
                {m(Math.abs(t.amount))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <BreakdownSheet
        open={!!activeBreakdownData}
        onClose={() => setActiveBreakdown(null)}
        title={activeBreakdownData?.title ?? ""}
        helper={activeBreakdownData?.helper ?? ""}
        total={activeBreakdownData?.total ?? 0}
        tone={activeBreakdownData?.tone ?? "teal"}
        sections={activeBreakdownData?.sections ?? []}
        formatMoney={m}
        expenseMode={activeBreakdown === "expenses_coming"}
        onAddExpense={() => setExpenseAction({ type: "add_one_time" })}
        onExpenseAction={setExpenseAction}
      />
      <ExpenseActionSheets
        action={expenseAction}
        onClose={() => setExpenseAction(null)}
        currentMonth={currentMonth}
        skipItemForMonth={skipItemForMonth}
      />
    </div>
  );
}

function CashFlowFormulaCard({
  haveNow,
  incomeComing,
  expensesComing,
  leftToSpend,
  spendableToday,
  period,
  onPeriodChange,
  formatMoney,
  onOpenBreakdown,
}: {
  haveNow: number;
  incomeComing: number;
  expensesComing: number;
  leftToSpend: number;
  spendableToday: number;
  period: CashFlowPeriod;
  onPeriodChange: (period: CashFlowPeriod) => void;
  formatMoney: (n: number) => string;
  onOpenBreakdown: (key: BreakdownKey) => void;
}) {
  const shortfall = leftToSpend < 0;
  const periodLabel = cashFlowPeriodLabels[period];
  return (
    <Card className="!p-4 sm:!p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-black tracking-tight">{periodLabel} Cash Flow</h2>
          <Info size={15} className="text-muted-foreground" aria-hidden="true" />
        </div>
        <Select
          aria-label="Cash flow period"
          value={period}
          onChange={(event) => onPeriodChange(event.target.value as CashFlowPeriod)}
          className="w-auto min-w-[150px] px-3 py-2 text-xs font-bold"
        >
          {Object.entries(cashFlowPeriodLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div
        className="mt-4 overflow-x-auto overscroll-x-contain pb-2"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex min-w-max items-center">
          <FlowSegment
            tone="green"
            title="Have now"
            amount={formatMoney(haveNow)}
            helper="In your accounts"
            icon={Wallet}
            onClick={() => onOpenBreakdown("have_now")}
          />
          <Connector symbol="+" />
          <FlowSegment
            tone="blue"
            title="Income coming"
            amount={formatMoney(incomeComing)}
            helper={incomeComing > 0 ? "Not received yet" : "No income pending"}
            icon={CalendarClock}
            future
            onClick={() => onOpenBreakdown("income_coming")}
          />
          <Connector symbol="-" />
          <FlowSegment
            tone="orange"
            title="Expenses coming"
            amount={formatMoney(expensesComing)}
            helper={expensesComing > 0 ? "Not paid yet" : "No upcoming expenses"}
            icon={ReceiptText}
            future
            onClick={() => onOpenBreakdown("expenses_coming")}
          />
          <Connector symbol="=" />
          <FlowSegment
            tone={shortfall ? "red" : "teal"}
            title={shortfall ? "Shortfall" : "Left to spend"}
            amount={formatMoney(leftToSpend)}
            helper={shortfall ? "Needs coverage" : "Ready to use"}
            icon={Target}
            onClick={() => onOpenBreakdown("left_to_spend")}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <FlowDetail
          tone="green"
          label="Have now"
          value={formatMoney(haveNow)}
          helper="Current spendable cash"
          badge="In your accounts"
          onClick={() => onOpenBreakdown("have_now")}
        />
        <FlowDetail
          tone="blue"
          label="Income coming"
          value={formatMoney(incomeComing)}
          helper="Expected this month"
          badge={incomeComing > 0 ? "Not received yet" : "No income pending"}
          onClick={() => onOpenBreakdown("income_coming")}
        />
        <FlowDetail
          tone="orange"
          label="Expenses coming"
          value={formatMoney(expensesComing)}
          helper="Bills and spending due"
          badge={expensesComing > 0 ? "Not paid yet" : "No upcoming expenses"}
          onClick={() => onOpenBreakdown("expenses_coming")}
        />
        <FlowDetail
          tone={shortfall ? "red" : "teal"}
          label={shortfall ? "Shortfall" : "Left to spend"}
          value={formatMoney(leftToSpend)}
          helper="Available after expenses"
          badge={shortfall ? "Needs coverage" : "Ready to use"}
          onClick={() => onOpenBreakdown("left_to_spend")}
        />
        <FlowDetail
          tone={spendableToday < 0 ? "red" : "green"}
          label="Spendable today"
          value={formatMoney(spendableToday)}
          helper="Before next income"
          badge="Today check"
          onClick={() => onOpenBreakdown("spendable_today")}
        />
      </div>

      <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        Formula: <span className="font-extrabold text-[color:var(--good)]">Have now</span>
        <span> + </span>
        <span className="font-extrabold text-[color:var(--primary-glow)]">Income coming</span>
        <span> - </span>
        <span className="font-extrabold text-[color:var(--warn)]">Expenses coming</span>
        <span> = </span>
        <span
          className={`font-extrabold ${shortfall ? "text-[color:var(--bad)]" : "text-[color:var(--primary-glow)]"}`}
        >
          {shortfall ? "Shortfall" : "Left to spend"}
        </span>
      </div>
    </Card>
  );
}

type FlowTone = "green" | "blue" | "orange" | "teal" | "red";

const flowTone: Record<
  FlowTone,
  {
    segment: string;
    detail: string;
    text: string;
    badge: string;
  }
> = {
  green: {
    segment: "border-[color:var(--good)]/50 bg-[color:var(--good)]/18 shadow-soft",
    detail: "border-[color:var(--good)]/20",
    text: "text-[color:var(--good)]",
    badge: "bg-[color:var(--good)]/12 text-[color:var(--good)]",
  },
  blue: {
    segment: "border-[color:var(--primary-glow)]/55 bg-[color:var(--primary-glow)]/14 shadow-soft",
    detail: "border-[color:var(--primary-glow)]/20",
    text: "text-[color:var(--primary-glow)]",
    badge: "bg-[color:var(--primary-glow)]/12 text-[color:var(--primary-glow)]",
  },
  orange: {
    segment: "border-[color:var(--warn)]/55 bg-[color:var(--warn)]/16 shadow-soft",
    detail: "border-[color:var(--warn)]/20",
    text: "text-[color:var(--warn)]",
    badge: "bg-[color:var(--warn)]/12 text-[color:var(--warn)]",
  },
  teal: {
    segment: "border-[color:var(--primary-glow)]/60 bg-[color:var(--primary-glow)]/22 shadow-soft",
    detail: "border-[color:var(--primary-glow)]/20",
    text: "text-[color:var(--primary-glow)]",
    badge: "bg-[color:var(--primary-glow)]/12 text-[color:var(--primary-glow)]",
  },
  red: {
    segment: "border-[color:var(--bad)]/55 bg-[color:var(--bad)]/18 shadow-soft",
    detail: "border-[color:var(--bad)]/20",
    text: "text-[color:var(--bad)]",
    badge: "bg-[color:var(--bad)]/12 text-[color:var(--bad)]",
  },
};

function FlowSegment({
  tone,
  title,
  amount,
  helper,
  icon: Icon,
  future,
  onClick,
}: {
  tone: FlowTone;
  title: string;
  amount: string;
  helper: string;
  icon: typeof Wallet;
  future?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex min-h-[86px] min-w-[170px] items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary-glow)] ${flowTone[tone].segment} ${
        future ? "border-dashed" : ""
      }`}
    >
      {future && (
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,.35) 0, rgba(255,255,255,.35) 6px, transparent 6px, transparent 14px)",
          }}
        />
      )}
      <Icon size={24} className={`relative shrink-0 ${flowTone[tone].text}`} />
      <div className="relative min-w-0">
        <div className={`text-xs font-extrabold ${flowTone[tone].text}`}>{title}</div>
        <div className="mt-1 text-xl font-black tracking-tight text-foreground">{amount}</div>
        <div className="mt-1 text-[11px] font-bold text-muted-foreground">{helper}</div>
      </div>
    </button>
  );
}

function Connector({ symbol }: { symbol: "+" | "-" | "=" }) {
  return (
    <div className="relative z-10 -mx-1 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-[color:var(--card-solid)] text-lg font-black shadow-soft">
      {symbol}
    </div>
  );
}

function FlowDetail({
  tone,
  label,
  value,
  helper,
  badge,
  onClick,
}: {
  tone: FlowTone;
  label: string;
  value: string;
  helper: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border bg-muted/25 p-3 text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary-glow)] ${flowTone[tone].detail}`}
    >
      <div className={`text-xs font-extrabold ${flowTone[tone].text}`}>{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
      <div
        className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold ${flowTone[tone].badge}`}
      >
        {badge}
      </div>
    </button>
  );
}

function BreakdownSheet({
  open,
  onClose,
  title,
  helper,
  total,
  tone,
  sections,
  formatMoney,
  expenseMode,
  onAddExpense,
  onExpenseAction,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  helper: string;
  total: number;
  tone: FlowTone;
  sections: CashFlowBreakdownSection[];
  formatMoney: (n: number) => string;
  expenseMode?: boolean;
  onAddExpense?: () => void;
  onExpenseAction?: (action: ExpenseAction) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">{helper}</div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Total
            </div>
            <div className={`text-xl font-black ${flowTone[tone].text}`}>{formatMoney(total)}</div>
          </div>
        </div>
      }
    >
      <div className="grid gap-4">
        {expenseMode && onAddExpense && (
          <Button variant="primary" full onClick={onAddExpense}>
            <Plus size={16} /> Add upcoming expense
          </Button>
        )}
        {sections.length === 0 && (
          <div className="rounded-2xl border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            No items are contributing to this number right now.
          </div>
        )}
        {sections.map((section) => {
          const sectionTotal = section.items.reduce((sum, item) => sum + item.amount, 0);
          return (
            <div key={section.title} className="rounded-2xl border border-border bg-muted/20">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="font-extrabold">{section.title}</div>
                <div className="text-sm font-bold text-muted-foreground">
                  {formatMoney(sectionTotal)}
                </div>
              </div>
              <div className="divide-y divide-border">
                {section.items.map((item) => (
                  <div key={`${section.title}-${item.id}`} className="grid gap-3 px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-bold">{item.label}</div>
                        {item.detail && (
                          <div className="text-xs text-muted-foreground">{item.detail}</div>
                        )}
                      </div>
                      <div
                        className={`shrink-0 text-right font-black ${
                          item.amount < 0 ? "text-[color:var(--bad)]" : ""
                        }`}
                      >
                        {formatMoney(item.amount)}
                      </div>
                    </div>
                    {expenseMode && onExpenseAction && (
                      <ExpenseItemActions item={item} onAction={onExpenseAction} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function ExpenseItemActions({
  item,
  onAction,
}: {
  item: CashFlowBreakdownItem;
  onAction: (action: ExpenseAction) => void;
}) {
  if (item.sourceType === "recurring_bill") {
    return (
      <div className="flex flex-wrap gap-2">
        <MiniAction
          label="Edit month"
          icon={Pencil}
          onClick={() => onAction({ type: "edit_recurring_month", item })}
        />
        <MiniAction
          label="Edit all"
          icon={Pencil}
          onClick={() => onAction({ type: "edit_recurring_permanent", item })}
        />
        <MiniAction label="Mark paid" onClick={() => onAction({ type: "pay_bill", item })} />
        <MiniAction label="Skip" onClick={() => onAction({ type: "delete_recurring", item })} />
      </div>
    );
  }
  if (item.sourceType === "one_time") {
    return (
      <div className="flex flex-wrap gap-2">
        <MiniAction
          label="Edit"
          icon={Pencil}
          onClick={() => onAction({ type: "edit_recurring_month", item })}
        />
        <MiniAction label="Mark paid" onClick={() => onAction({ type: "pay_bill", item })} />
        <MiniAction
          label="Delete"
          icon={Trash2}
          onClick={() => onAction({ type: "delete_recurring", item })}
          danger
        />
      </div>
    );
  }
  if (item.sourceType === "card_due") {
    return (
      <div className="flex flex-wrap gap-2">
        <MiniAction label="Pay" onClick={() => onAction({ type: "pay_card", item })} />
        <MiniAction
          label="View charges"
          icon={Eye}
          onClick={() => onAction({ type: "view_card", item })}
        />
        <MiniAction
          label="Edit card"
          icon={Pencil}
          onClick={() => onAction({ type: "edit_card", item })}
        />
      </div>
    );
  }
  if (item.sourceType === "debt_plan") {
    return (
      <div className="flex flex-wrap gap-2">
        <MiniAction label="Pay" onClick={() => onAction({ type: "pay_debt", item })} />
        <MiniAction
          label="Edit plan"
          icon={Pencil}
          onClick={() => onAction({ type: "edit_debt", item })}
        />
        <MiniAction label="Skip" onClick={() => onAction({ type: "skip_debt", item })} />
      </div>
    );
  }
  return null;
}

function MiniAction({
  label,
  icon: Icon,
  onClick,
  danger,
}: {
  label: string;
  icon?: typeof Pencil;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition hover:bg-muted ${
        danger ? "border-[color:var(--bad)]/40 text-[color:var(--bad)]" : "border-border"
      }`}
    >
      {Icon && <Icon size={13} />}
      {label}
    </button>
  );
}

function ExpenseActionSheets({
  action,
  onClose,
  currentMonth,
  skipItemForMonth,
}: {
  action: ExpenseAction | null;
  onClose: () => void;
  currentMonth: string;
  skipItemForMonth: (item: CashFlowBreakdownItem) => void;
}) {
  const { state, dispatch } = useApp();

  if (!action) return null;
  const actionMonth =
    "item" in action
      ? (action.item.periodDate?.slice(0, 7) ?? action.item.dueDate?.slice(0, 7) ?? currentMonth)
      : currentMonth;

  if (action.type === "add_one_time") {
    return (
      <PlannedExpenseSheet title="Add upcoming expense" month={currentMonth} onClose={onClose} />
    );
  }

  if (action.type === "edit_recurring_month") {
    return (
      <PlannedExpenseSheet
        title={action.item.sourceType === "one_time" ? "Edit planned expense" : "Edit this month"}
        month={actionMonth}
        item={action.item}
        onClose={onClose}
      />
    );
  }

  if (action.type === "edit_recurring_permanent") {
    const bill = state.recurringBills.find((item) => item.id === action.item.sourceId);
    return bill ? <RecurringSheet onClose={onClose} initial={bill} /> : null;
  }

  if (action.type === "delete_recurring") {
    return (
      <Sheet open onClose={onClose} title="Delete or skip">
        <div className="grid gap-3">
          <div className="rounded-2xl border border-border bg-muted/30 p-4">
            <div className="font-extrabold">{action.item.label}</div>
            <div className="text-sm text-muted-foreground">
              Choose whether this affects only {actionMonth} or the original recurring item.
            </div>
          </div>
          <Button
            variant="ghost"
            full
            onClick={() => {
              skipItemForMonth(action.item);
              onClose();
            }}
          >
            {action.item.sourceType === "one_time" ? "Delete planned expense" : "Skip this month"}
          </Button>
          {action.item.sourceType === "recurring_bill" && action.item.sourceId && (
            <Button
              variant="danger"
              full
              onClick={() => {
                if (!confirm("Delete this recurring bill permanently?")) return;
                dispatch({ type: "DELETE_RECURRING", id: action.item.sourceId! });
                toast("Recurring bill deleted");
                onClose();
              }}
            >
              Delete permanently
            </Button>
          )}
        </div>
      </Sheet>
    );
  }

  if (action.type === "pay_bill") {
    return (
      <PayBillSheet
        item={action.item}
        onClose={onClose}
        onPaid={() => {
          skipItemForMonth(action.item);
          onClose();
        }}
      />
    );
  }

  if (action.type === "pay_card") {
    return <PayCardSheet item={action.item} onClose={onClose} />;
  }

  if (action.type === "view_card") {
    return <CardCycleSheet item={action.item} onClose={onClose} />;
  }

  if (action.type === "edit_card") {
    const card = state.cards.find((item) => item.id === action.item.sourceId);
    return card ? <CardSheet onClose={onClose} initial={card} /> : null;
  }

  if (action.type === "pay_debt") {
    return (
      <PayDebtSheet
        item={action.item}
        onClose={onClose}
        onPaid={() => {
          skipItemForMonth(action.item);
          onClose();
        }}
      />
    );
  }

  if (action.type === "skip_debt") {
    return (
      <Sheet open onClose={onClose} title="Skip debt plan">
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            This only removes {action.item.label} from the {actionMonth} forecast. It does not
            change the debt balance.
          </p>
          <Button
            variant="primary"
            onClick={() => {
              skipItemForMonth(action.item);
              onClose();
            }}
          >
            Skip this month
          </Button>
        </div>
      </Sheet>
    );
  }

  if (action.type === "edit_debt") {
    const debt = state.debts.find((item) => item.id === action.item.sourceId);
    return debt ? <DebtSheet onClose={onClose} initial={debt} /> : null;
  }

  return null;
}

function PlannedExpenseSheet({
  title,
  month,
  item,
  onClose,
}: {
  title: string;
  month: string;
  item?: CashFlowBreakdownItem;
  onClose: () => void;
}) {
  const { state, dispatch } = useApp();
  const [name, setName] = useState(item?.label ?? "");
  const [amount, setAmount] = useState(String(item?.amount ?? ""));
  const [dueDate, setDueDate] = useState(item?.dueDate ?? `${month}-01`);
  const [accountId, setAccountId] = useState(item?.accountId ?? state.accounts[0]?.id ?? "");
  const [category, setCategory] = useState(item?.category ?? state.categories?.[0] ?? "Other");
  const [newCategory, setNewCategory] = useState("");
  const categories = state.categories?.length ? state.categories : ["Groceries", "Other"];
  const isExistingOneTime = item?.sourceType === "one_time" && item.overrideId;
  const selectedCategory = category === "__new" ? newCategory.trim() : category;

  function save() {
    const amt = toNumber(amount);
    if (!name.trim()) return toast("Name the expense");
    if (amt <= 0) return toast("Enter an amount");
    if (!selectedCategory) return toast("Choose a category");
    if (category === "__new") dispatch({ type: "ADD_CATEGORY", category: selectedCategory });

    const payload = {
      sourceType:
        item?.sourceType === "recurring_bill" ? ("recurring_bill" as const) : ("one_time" as const),
      sourceId: item?.sourceType === "recurring_bill" ? item.sourceId : undefined,
      month,
      action: item?.sourceType === "recurring_bill" ? ("override" as const) : ("add" as const),
      name: name.trim(),
      amount: amt,
      dueDay: Number(dueDate.slice(8, 10)) || undefined,
      dueDate,
      accountId,
      category: selectedCategory,
    };

    if (isExistingOneTime) {
      dispatch({
        type: "UPDATE_PLANNED_EXPENSE_OVERRIDE",
        payload: { ...payload, id: item.overrideId! },
      });
    } else {
      dispatch({ type: "ADD_PLANNED_EXPENSE_OVERRIDE", payload });
    }
    toast("Upcoming expense saved");
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Paid from">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {state.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            <option value="__new">Add new category</option>
          </Select>
        </Field>
        {category === "__new" && (
          <Field label="New category">
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function PayBillSheet({
  item,
  onClose,
  onPaid,
}: {
  item: CashFlowBreakdownItem;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [amount, setAmount] = useState(String(item.amount));
  const [date, setDate] = useState(item.dueDate ?? todayISO());
  const [accountId, setAccountId] = useState(item.accountId ?? state.accounts[0]?.id ?? "");
  const account = state.accounts.find((candidate) => candidate.id === accountId);

  function pay() {
    const amt = toNumber(amount);
    if (amt <= 0) return toast("Enter an amount");
    if (!accountId) return toast("Choose an account");
    dispatch({
      type: "ADD_EXPENSE",
      payload: {
        amount: amt,
        category: item.category ?? "Bills",
        description: item.label,
        date,
        method: account?.type === "cash" ? "cash" : "debit",
        sourceAccountId: accountId,
      },
    });
    toast(`${item.label} paid - ${formatMoney(amt, cur)}`);
    onPaid();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Mark paid"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={pay}>
            Mark paid
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Amount">
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Payment date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Paid from">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {state.accounts.filter(isSpendableAccount).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} - {formatMoney(account.balance, cur)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

function PayCardSheet({ item, onClose }: { item: CashFlowBreakdownItem; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [amount, setAmount] = useState(String(item.amount));
  const [date, setDate] = useState(todayISO());
  const spendableAccounts = state.accounts.filter(isSpendableAccount);
  const [sourceAccountId, setSourceAccountId] = useState(spendableAccounts[0]?.id ?? "");

  function pay() {
    const amt = toNumber(amount);
    if (!item.sourceId) return;
    if (amt <= 0) return toast("Enter an amount");
    if (!sourceAccountId) return toast("Choose an account");
    dispatch({
      type: "PAY_CREDIT_CARD",
      payload: {
        cardId: item.sourceId,
        amount: amt,
        sourceAccountId,
        date,
        plannedExpenseItemId: item.id,
      },
    });
    toast(`Paid ${formatMoney(amt, cur)} to ${item.label}`);
    onClose();
  }

  return (
    <PayMoneySheet
      title="Pay card"
      amount={amount}
      setAmount={setAmount}
      date={date}
      setDate={setDate}
      sourceAccountId={sourceAccountId}
      setSourceAccountId={setSourceAccountId}
      accounts={spendableAccounts}
      currency={cur}
      onClose={onClose}
      onPay={pay}
    />
  );
}

function PayDebtSheet({
  item,
  onClose,
  onPaid,
}: {
  item: CashFlowBreakdownItem;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [amount, setAmount] = useState(String(item.amount));
  const [date, setDate] = useState(todayISO());
  const spendableAccounts = state.accounts.filter(isSpendableAccount);
  const [sourceAccountId, setSourceAccountId] = useState(spendableAccounts[0]?.id ?? "");

  function pay() {
    const amt = toNumber(amount);
    if (!item.sourceId) return;
    if (amt <= 0) return toast("Enter an amount");
    if (!sourceAccountId) return toast("Choose an account");
    dispatch({
      type: "PAY_DEBT",
      payload: { debtId: item.sourceId, amount: amt, sourceAccountId, date },
    });
    toast(`Paid ${formatMoney(amt, cur)} to ${item.label}`);
    onPaid();
  }

  return (
    <PayMoneySheet
      title="Pay debt"
      amount={amount}
      setAmount={setAmount}
      date={date}
      setDate={setDate}
      sourceAccountId={sourceAccountId}
      setSourceAccountId={setSourceAccountId}
      accounts={spendableAccounts}
      currency={cur}
      onClose={onClose}
      onPay={pay}
    />
  );
}

function PayMoneySheet({
  title,
  amount,
  setAmount,
  date,
  setDate,
  sourceAccountId,
  setSourceAccountId,
  accounts,
  currency,
  onClose,
  onPay,
}: {
  title: string;
  amount: string;
  setAmount: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  sourceAccountId: string;
  setSourceAccountId: (value: string) => void;
  accounts: { id: string; name: string; balance: number }[];
  currency: string;
  onClose: () => void;
  onPay: () => void;
}) {
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onPay}>
            Pay
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Amount">
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Payment date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Pay from">
          <Select value={sourceAccountId} onChange={(e) => setSourceAccountId(e.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} - {formatMoney(account.balance, currency)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

function CardCycleSheet({ item, onClose }: { item: CashFlowBreakdownItem; onClose: () => void }) {
  const { state } = useApp();
  const cur = state.profile.currency;
  const card = state.cards.find((candidate) => candidate.id === item.sourceId);
  if (!card) return null;
  const cycle =
    item.cycleStart && item.cycleEnd && item.dueDate
      ? { cycleStart: item.cycleStart, cycleEnd: item.cycleEnd, dueDate: item.dueDate }
      : currentOpenCycle(card, new Date());
  const charges = expensesInCycle(state.transactions, card.id, cycle);
  const postedCharges = charges.filter(
    (charge) => !isLikelyPendingNearStatement(charge.date, cycle),
  );
  const pendingCharges = charges.filter((charge) =>
    isLikelyPendingNearStatement(charge.date, cycle),
  );
  return (
    <Sheet open onClose={onClose} title="Upcoming card bill">
      <div className="grid gap-3">
        <div className="rounded-2xl border border-border bg-muted/30 p-3 text-sm">
          Statement closes {formatDisplayDate(cycle.cycleEnd)} - due{" "}
          {formatDisplayDate(cycle.dueDate)}
          <div className="mt-1 text-xs text-muted-foreground">
            Cycle {formatDisplayDate(cycle.cycleStart)} to {formatDisplayDate(cycle.cycleEnd)}
          </div>
        </div>
        {charges.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No individual charges are tracked for this cycle. The card current balance is treated as
            posted.
          </div>
        )}
        {postedCharges.length > 0 ? (
          <div className="divide-y divide-border rounded-2xl border border-border">
            {postedCharges.map((charge) => (
              <div key={charge.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-bold">{charge.description || charge.category}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDisplayDate(charge.date)}
                  </div>
                </div>
                <div className="font-black">{formatMoney(charge.amount, cur)}</div>
              </div>
            ))}
          </div>
        ) : (
          charges.length > 0 && (
            <div className="rounded-2xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              No tracked charges are counted in this statement because the tracked charges are in
              the likely pending window.
            </div>
          )
        )}
        {pendingCharges.length > 0 && (
          <div className="rounded-2xl border border-border bg-muted/20 p-3">
            <div className="text-sm font-extrabold">Held for next statement</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Expenses within 2 days of statement close are treated as likely pending.
            </div>
            <div className="mt-2 divide-y divide-border">
              {pendingCharges.map((charge) => (
                <div key={charge.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="text-sm font-bold">{charge.description || charge.category}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDisplayDate(charge.date)}
                    </div>
                  </div>
                  <div className="font-black text-muted-foreground">
                    {formatMoney(charge.amount, cur)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-lg font-extrabold tracking-tight">{title}</h3>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
function Row({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: string;
  tone?: "good";
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`${bold ? "text-lg font-black" : "font-bold"} ${
          tone === "good" ? "text-[color:var(--good)]" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return <div className="py-6 text-center text-sm text-muted-foreground">{label}</div>;
}
