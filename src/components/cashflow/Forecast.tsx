import { useMemo, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Filter,
  Home,
  Hourglass,
  Info,
  Landmark,
  Leaf,
  LockKeyhole,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  TrendingUp,
  WalletCards,
  Wifi,
  Zap,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApp } from "@/lib/cashflow/AppContext";
import {
  SPENDABLE_TODAY_HORIZON_DAYS,
  cashFlowPeriodLabels,
  cashFlowPeriodRange,
  expensesComingBreakdown,
  forecastCashProjection,
  spendableCash,
  type CashFlowBreakdownItem,
  type CashFlowPeriod,
  type ForecastCashProjection,
  type ForecastDateRange,
} from "@/lib/cashflow/forecast";
import {
  forecastScenarioOptions,
  reservedCashTotal,
  zeroAprPayoffPlan,
  type CustomForecastScenario,
  type ForecastScenario,
} from "@/lib/cashflow/forecastView";
import { addDays, formatDisplayDate, fromISODate } from "@/lib/cashflow/dates";
import { formatMoney } from "@/lib/cashflow/money";
import type { AppState, Card as CardType, Transaction } from "@/lib/cashflow/types";
import type { Tab } from "./AppLayout";
import { Button } from "./Button";
import { Card } from "./Card";
import { Field, Input, Select } from "./Field";
import { CardSheet, DebtSheet, RecurringSheet } from "./Profile";
import { Sheet } from "./Sheet";
import { toast } from "./Toast";

type Panel =
  | { type: "summary"; metric: SummaryMetric }
  | { type: "filters" }
  | { type: "forecast-details" }
  | { type: "bill"; item: CashFlowBreakdownItem }
  | { type: "all-bills" }
  | { type: "card"; card: CardType }
  | { type: "select-extra-payment" }
  | { type: "extra-payment"; card: CardType }
  | { type: "alert"; alert: ForecastAlert }
  | { type: "all-alerts" }
  | { type: "custom-scenario" }
  | { type: "edit-bill"; item: CashFlowBreakdownItem }
  | { type: "edit-card"; card: CardType };

type SummaryMetric = "safe" | "projected" | "runway" | "reserved";
type AlertSeverity = "success" | "information" | "warning" | "critical";

interface ForecastAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  target?: Tab | SummaryMetric;
}

type ForecastIcon = ComponentType<{ size?: number; className?: string }>;

interface ChartPoint {
  date: string;
  label: string;
  actual?: number;
  projected?: number;
  lower?: number;
  upper?: number;
  incomeMarker?: number;
  expenseMarker?: number;
  events?: string[];
}

const SCENARIO_LABELS: Record<ForecastScenario, string> = {
  best: "Best case",
  expected: "Expected",
  worst: "Worst case",
  custom: "Custom",
};

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultCustomRange(ref: Date): ForecastDateRange {
  return { start: isoDate(ref), end: isoDate(addDays(ref, 30)) };
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    fromISODate(value),
  );
}

function transactionCashImpact(transaction: Transaction, state: AppState): number {
  const spendableIds = new Set(
    state.accounts
      .filter((account) => account.availableForSpending !== false)
      .map((account) => account.id),
  );
  const sourceIsSpendable =
    !!transaction.sourceAccountId && spendableIds.has(transaction.sourceAccountId);
  const targetIsSpendable =
    !!transaction.targetAccountId && spendableIds.has(transaction.targetAccountId);

  if (transaction.type === "income") return targetIsSpendable ? transaction.amount : 0;
  if (
    transaction.type === "expense" ||
    transaction.type === "card_payment" ||
    transaction.type === "debt_payment"
  ) {
    return sourceIsSpendable ? -transaction.amount : 0;
  }
  if (transaction.type === "transfer") {
    return (
      (targetIsSpendable ? transaction.amount : 0) - (sourceIsSpendable ? transaction.amount : 0)
    );
  }
  return 0;
}

function projectionBalanceByDate(projection: ForecastCashProjection): Map<string, number> {
  const eventsByDate = new Map<string, number>();
  projection.events.forEach((event) => {
    eventsByDate.set(event.date, (eventsByDate.get(event.date) ?? 0) + event.amount);
  });
  const balances = new Map<string, number>();
  let balance = projection.startingCash;
  let cursor = fromISODate(projection.range.start);
  const end = fromISODate(projection.range.end);
  while (cursor <= end) {
    const date = isoDate(cursor);
    balance += eventsByDate.get(date) ?? 0;
    balances.set(date, balance);
    cursor = addDays(cursor, 1);
  }
  return balances;
}

function buildChartData(
  state: AppState,
  displayRange: ForecastDateRange,
  selected: ForecastCashProjection,
  best: ForecastCashProjection,
  worst: ForecastCashProjection,
  ref: Date,
): ChartPoint[] {
  const today = isoDate(ref);
  const currentCash = spendableCash(state);
  const actualEnd = displayRange.end < today ? displayRange.end : today;
  const actualImpacts = new Map<string, number>();

  state.transactions.forEach((transaction) => {
    if (transaction.date < displayRange.start || transaction.date > actualEnd) return;
    const impact = transactionCashImpact(transaction, state);
    actualImpacts.set(transaction.date, (actualImpacts.get(transaction.date) ?? 0) + impact);
  });

  const actualImpactTotal = Array.from(actualImpacts.values()).reduce(
    (sum, amount) => sum + amount,
    0,
  );
  let actualBalance = currentCash - actualImpactTotal;
  const selectedBalances = projectionBalanceByDate(selected);
  const bestBalances = projectionBalanceByDate(best);
  const worstBalances = projectionBalanceByDate(worst);
  const eventsByDate = new Map<string, ForecastCashProjection["events"]>();
  selected.events.forEach((event) => {
    eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);
  });

  const points: ChartPoint[] = [];
  let cursor = fromISODate(displayRange.start);
  const end = fromISODate(displayRange.end);
  while (cursor <= end) {
    const date = isoDate(cursor);
    if (date <= actualEnd) actualBalance += actualImpacts.get(date) ?? 0;
    const events = eventsByDate.get(date) ?? [];
    const projected = selectedBalances.get(date);
    points.push({
      date,
      label: formatShortDate(date),
      actual: date <= actualEnd ? actualBalance : undefined,
      projected: date >= selected.range.start ? projected : undefined,
      lower: date >= selected.range.start ? worstBalances.get(date) : undefined,
      upper: date >= selected.range.start ? bestBalances.get(date) : undefined,
      incomeMarker: events.some((event) => event.amount > 0) ? projected : undefined,
      expenseMarker: events.some((event) => event.amount < 0) ? projected : undefined,
      events: events.map(
        (event) => `${event.label}: ${formatMoney(Math.abs(event.amount), state.profile.currency)}`,
      ),
    });
    cursor = addDays(cursor, 1);
  }
  return points;
}

function billIcon(item: CashFlowBreakdownItem): ForecastIcon {
  const text = `${item.label} ${item.category ?? ""}`.toLowerCase();
  if (text.includes("rent") || text.includes("mortgage")) return Home;
  if (text.includes("wifi") || text.includes("internet")) return Wifi;
  if (text.includes("phone") || text.includes("mobile")) return Phone;
  if (text.includes("car") || text.includes("auto")) return Car;
  if (text.includes("shop")) return ShoppingBag;
  if (item.sourceType === "card_due") return CreditCard;
  if (item.sourceType === "debt_plan") return Landmark;
  return ReceiptText;
}

function rangeTitle(period: CashFlowPeriod): string {
  if (period === "this_month") return "This month";
  if (period === "next_30_days") return "Next 30 days";
  if (period === "next_6_months") return "Next 6 months";
  return "Custom";
}

export function Forecast({ setTab }: { setTab?: (tab: Tab) => void }) {
  const { state } = useApp();
  const now = useMemo(() => new Date(), []);
  const today = isoDate(now);
  const [period, setPeriod] = useState<CashFlowPeriod>("this_month");
  const [customRange, setCustomRange] = useState<ForecastDateRange>(() => defaultCustomRange(now));
  const [includeProjectedIncome, setIncludeProjectedIncome] = useState(true);
  const [scenario, setScenario] = useState<ForecastScenario>("expected");
  const [customScenario, setCustomScenario] = useState<CustomForecastScenario>({
    unexpectedExpenseAmount: 500,
    unexpectedExpenseDate: isoDate(addDays(now, 7)),
    variableExpenseReductionPercent: 0,
  });
  const [panel, setPanel] = useState<Panel | null>(null);
  const currency = state.profile.currency;
  const money = (amount: number) => formatMoney(amount, currency);

  const selectedOptions = useMemo(
    () => forecastScenarioOptions(scenario, now, customScenario, includeProjectedIncome),
    [customScenario, includeProjectedIncome, now, scenario],
  );
  const safetyOptions = useMemo(
    () => forecastScenarioOptions(scenario, now, customScenario, false, true),
    [customScenario, now, scenario],
  );
  const selectedProjection = useMemo(
    () => forecastCashProjection(state, now, period, customRange, selectedOptions),
    [customRange, now, period, selectedOptions, state],
  );
  const safetyProjection = useMemo(
    () => forecastCashProjection(state, now, period, customRange, safetyOptions, true),
    [customRange, now, period, safetyOptions, state],
  );
  const bestProjection = useMemo(
    () =>
      forecastCashProjection(
        state,
        now,
        period,
        customRange,
        forecastScenarioOptions("best", now, customScenario, includeProjectedIncome),
      ),
    [customRange, customScenario, includeProjectedIncome, now, period, state],
  );
  const worstProjection = useMemo(
    () =>
      forecastCashProjection(
        state,
        now,
        period,
        customRange,
        forecastScenarioOptions("worst", now, customScenario, false),
      ),
    [customRange, customScenario, now, period, state],
  );
  const displayRange = useMemo(
    () => cashFlowPeriodRange(period, now, customRange),
    [customRange, now, period],
  );
  const chartData = useMemo(
    () =>
      buildChartData(state, displayRange, selectedProjection, bestProjection, worstProjection, now),
    [bestProjection, displayRange, now, selectedProjection, state, worstProjection],
  );
  const rawUpcomingSections = useMemo(
    () => expensesComingBreakdown(state, now, period, customRange),
    [customRange, now, period, state],
  );
  const upcomingItems = useMemo(() => {
    const multiplier = selectedOptions.variableExpenseMultiplier ?? 1;
    const items = rawUpcomingSections
      .flatMap((section) => section.items)
      .map((item) =>
        item.sourceType === "one_time"
          ? { ...item, amount: Math.round(item.amount * multiplier * 100) / 100 }
          : item,
      );
    const temporaryExpense = selectedProjection.events.find((event) =>
      event.id.startsWith("expense-scenario-unexpected-"),
    );
    if (temporaryExpense) {
      items.push({
        id: "scenario-unexpected",
        label: "Scenario expense",
        detail: "Temporary assumption",
        amount: Math.abs(temporaryExpense.amount),
        sourceType: "one_time",
        dueDate: temporaryExpense.date,
        periodDate: temporaryExpense.date,
        category: "Other",
      });
    }
    return items.sort((a, b) =>
      (a.periodDate ?? a.dueDate ?? "").localeCompare(b.periodDate ?? b.dueDate ?? ""),
    );
  }, [rawUpcomingSections, selectedOptions.variableExpenseMultiplier, selectedProjection.events]);
  const upcomingTotal = upcomingItems.reduce((sum, item) => sum + item.amount, 0);
  const zeroAprCards = state.cards.filter(
    (card) => (card.type === "zero_apr" || card.type === "zero_apr_car") && card.currentBalance > 0,
  );
  const reservedCash = reservedCashTotal(state);
  const runwayLabel =
    safetyProjection.runwayDays == null
      ? `${SPENDABLE_TODAY_HORIZON_DAYS}+ days`
      : `${safetyProjection.runwayDays} days`;
  const alerts = useMemo(
    () => buildAlerts(state, displayRange, selectedProjection, safetyProjection, zeroAprCards),
    [displayRange, safetyProjection, selectedProjection, state, zeroAprCards],
  );

  function openTarget(target?: ForecastAlert["target"]) {
    if (!target) return;
    if (
      target === "safe" ||
      target === "projected" ||
      target === "runway" ||
      target === "reserved"
    ) {
      setPanel({ type: "summary", metric: target });
      return;
    }
    setPanel(null);
    setTab?.(target);
  }

  return (
    <div className="grid gap-4 sm:gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Forecast</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See what is safe now and what your cash must cover next.
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:min-w-[220px]">
            <CalendarDays
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <select
              aria-label="Forecast date range"
              value={period}
              onChange={(event) => setPeriod(event.target.value as CashFlowPeriod)}
              className="h-11 w-full appearance-none rounded-xl border border-border bg-[color:var(--card-solid)] pl-10 pr-8 text-sm font-bold outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
            >
              {Object.entries(cashFlowPeriodLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setPanel({ type: "filters" })}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-[color:var(--card-solid)] transition hover:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 sm:flex sm:w-auto sm:px-4 sm:gap-2"
            aria-label="Forecast filters"
          >
            <Filter size={17} />
            <span className="hidden text-sm font-bold sm:inline">Filters</span>
          </button>
        </div>
      </header>

      {period === "custom" && (
        <div className="grid gap-3 rounded-2xl border border-border bg-[color:var(--card-solid)] p-4 sm:grid-cols-2">
          <Field label="From">
            <Input
              type="date"
              value={customRange.start}
              onChange={(event) =>
                setCustomRange((range) => ({ ...range, start: event.target.value }))
              }
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={customRange.end}
              onChange={(event) =>
                setCustomRange((range) => ({ ...range, end: event.target.value }))
              }
            />
          </Field>
        </div>
      )}

      <section aria-labelledby="forecast-summary-title">
        <h2 id="forecast-summary-title" className="sr-only">
          Forecast summary
        </h2>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4">
          <SummaryCard
            label="Safe to spend"
            value={money(safetyProjection.safeSurplus)}
            support={`Protected ${SPENDABLE_TODAY_HORIZON_DAYS} days`}
            icon={WalletCards}
            tone={safetyProjection.safeSurplus < 0 ? "bad" : "good"}
            onClick={() => setPanel({ type: "summary", metric: "safe" })}
          />
          <SummaryCard
            label="Projected period-end"
            value={money(selectedProjection.endingBalance)}
            support={`Expected on ${formatShortDate(displayRange.end)}`}
            icon={TrendingUp}
            tone={selectedProjection.endingBalance < 0 ? "bad" : "primary"}
            onClick={() => setPanel({ type: "summary", metric: "projected" })}
          />
          <SummaryCard
            label="Cash runway"
            value={runwayLabel}
            support={
              safetyProjection.runwayDate
                ? `Floor reached ${formatShortDate(safetyProjection.runwayDate)}`
                : "No floor breach in safety window"
            }
            icon={Hourglass}
            tone={safetyProjection.runwayDate ? "warn" : "good"}
            onClick={() => setPanel({ type: "summary", metric: "runway" })}
          />
          <SummaryCard
            label="Reserved cash"
            value={money(reservedCash)}
            support="Floor and set-aside accounts"
            icon={LockKeyhole}
            tone="warn"
            onClick={() => setPanel({ type: "summary", metric: "reserved" })}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.7fr)] xl:items-start">
        <ForecastChart
          data={chartData}
          currency={currency}
          scenario={scenario}
          onScenarioChange={setScenario}
          today={today}
          rangeLabel={`${formatDisplayDate(displayRange.start)} to ${formatDisplayDate(displayRange.end)}`}
          onViewDetails={() => setPanel({ type: "forecast-details" })}
        />

        <section className="order-2 xl:col-start-1 xl:row-start-2" aria-labelledby="upcoming-title">
          <Card className="overflow-hidden !p-0">
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
              <div>
                <h2 id="upcoming-title" className="text-lg font-black">
                  Upcoming bills
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {rangeTitle(period)} obligations, in payment order.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPanel({ type: "all-bills" })}
                className="min-h-11 shrink-0 px-2 text-sm font-bold text-primary hover:underline"
              >
                View all
              </button>
            </div>
            {upcomingItems.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title="No upcoming bills"
                detail="No unpaid obligations fall inside this date range."
              />
            ) : (
              <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                {upcomingItems.slice(0, 4).map((item) => (
                  <UpcomingBillButton
                    key={item.id}
                    item={item}
                    currency={currency}
                    onClick={() => setPanel({ type: "bill", item })}
                  />
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm sm:px-5">
              <span className="text-muted-foreground">Total upcoming</span>
              <span className="font-black">{money(upcomingTotal)}</span>
            </div>
          </Card>
        </section>

        <ZeroAprPanel
          cards={zeroAprCards}
          state={state}
          currency={currency}
          onCard={(card) => setPanel({ type: "card", card })}
          onExtraPayment={(card) => setPanel({ type: "extra-payment", card })}
          onChooseExtraPayment={() => setPanel({ type: "select-extra-payment" })}
        />

        <AlertsPanel
          alerts={alerts}
          onAlert={(alert) => setPanel({ type: "alert", alert })}
          onViewAll={() => setPanel({ type: "all-alerts" })}
        />

        <ScenarioPanel
          scenario={scenario}
          customScenario={customScenario}
          currency={currency}
          projectedEnd={selectedProjection.endingBalance}
          safeToSpend={safetyProjection.safeSurplus}
          onChange={setScenario}
          onCustomize={() => setPanel({ type: "custom-scenario" })}
        />
      </div>

      <ForecastPanels
        panel={panel}
        onClose={() => setPanel(null)}
        onPanel={setPanel}
        state={state}
        selectedProjection={selectedProjection}
        safetyProjection={safetyProjection}
        displayRange={displayRange}
        upcomingItems={upcomingItems}
        upcomingTotal={upcomingTotal}
        alerts={alerts}
        period={period}
        customRange={customRange}
        includeProjectedIncome={includeProjectedIncome}
        scenario={scenario}
        customScenario={customScenario}
        onPeriod={setPeriod}
        onCustomRange={setCustomRange}
        onProjectedIncome={setIncludeProjectedIncome}
        onScenario={setScenario}
        onCustomScenario={setCustomScenario}
        onTarget={openTarget}
        setTab={setTab}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  support,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  support: string;
  icon: ForecastIcon;
  tone: "good" | "primary" | "warn" | "bad";
  onClick: () => void;
}) {
  const color =
    tone === "good"
      ? "var(--good)"
      : tone === "primary"
        ? "var(--primary-glow)"
        : tone === "bad"
          ? "var(--bad)"
          : "var(--warn)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-w-0 rounded-2xl border border-border bg-[color:var(--card-solid)] p-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 sm:p-4"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{ color, backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }}
        >
          <Icon size={18} />
        </span>
        <ChevronRight
          size={17}
          className="mt-1 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5"
        />
      </div>
      <div className="mt-3 text-xs font-bold text-muted-foreground sm:text-sm">{label}</div>
      <div
        className="mt-1 break-words text-xl font-black leading-tight sm:text-2xl"
        style={{ color }}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground sm:text-xs">
        {support}
      </div>
    </button>
  );
}

function ForecastChart({
  data,
  currency,
  scenario,
  onScenarioChange,
  today,
  rangeLabel,
  onViewDetails,
}: {
  data: ChartPoint[];
  currency: string;
  scenario: ForecastScenario;
  onScenarioChange: (scenario: ForecastScenario) => void;
  today: string;
  rangeLabel: string;
  onViewDetails: () => void;
}) {
  const hasData = data.some((point) => point.actual != null || point.projected != null);
  return (
    <section
      className="order-1 min-w-0 xl:col-start-1 xl:row-start-1"
      aria-labelledby="chart-title"
    >
      <Card className="overflow-hidden !p-0">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 id="chart-title" className="text-lg font-black">
              Cash balance forecast
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{rangeLabel}</p>
          </div>
          <div
            className="grid grid-cols-3 rounded-xl border border-border bg-muted/35 p-1"
            aria-label="Forecast scenario"
          >
            {(["best", "expected", "worst"] as ForecastScenario[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={scenario === value}
                onClick={() => onScenarioChange(value)}
                className={`min-h-9 rounded-lg px-2 text-xs font-bold transition sm:px-3 ${
                  scenario === value
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {SCENARIO_LABELS[value]}
              </button>
            ))}
          </div>
        </div>
        {!hasData ? (
          <EmptyState
            icon={TrendingUp}
            title="Not enough data yet"
            detail="Add an account, income, or upcoming bill to build the forecast."
          />
        ) : (
          <>
            <div
              className="h-[300px] w-full px-1 pt-4 sm:h-[370px] sm:px-3"
              role="img"
              aria-label="Cash balance chart with actual balance, projected balance, forecast range, income markers, and expense markers."
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 12, left: -14, bottom: 2 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
                  <XAxis
                    dataKey="label"
                    minTickGap={30}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) =>
                      new Intl.NumberFormat("en-US", {
                        notation: "compact",
                        style: "currency",
                        currency,
                        maximumFractionDigits: 0,
                      }).format(Number(value))
                    }
                    tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={64}
                  />
                  <Tooltip content={<ForecastTooltip currency={currency} />} />
                  <ReferenceLine
                    x={formatShortDate(today)}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    label={{
                      value: "Today",
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                      position: "insideTopRight",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="upper"
                    stroke="none"
                    fill="var(--primary)"
                    fillOpacity={0.12}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="lower"
                    stroke="var(--primary)"
                    strokeOpacity={0.35}
                    strokeDasharray="2 4"
                    fill="var(--card-solid)"
                    fillOpacity={0.5}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Actual"
                    stroke="var(--primary)"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="projected"
                    name="Projected"
                    stroke="var(--primary-glow)"
                    strokeWidth={2.5}
                    strokeDasharray="4 5"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="incomeMarker"
                    name="Income"
                    stroke="transparent"
                    dot={{ r: 5, fill: "var(--good)", stroke: "var(--card-solid)", strokeWidth: 2 }}
                    activeDot={{ r: 7 }}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="expenseMarker"
                    name="Expense"
                    stroke="transparent"
                    dot={{ r: 5, fill: "var(--bad)", stroke: "var(--card-solid)", strokeWidth: 2 }}
                    activeDot={{ r: 7 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-[11px] text-muted-foreground sm:px-5">
              <LegendLine color="var(--primary)" label="Actual" />
              <LegendLine color="var(--primary-glow)" label="Projected" dashed />
              <LegendDot color="var(--good)" label="Income" />
              <LegendDot color="var(--bad)" label="Upcoming bill" />
              <button
                type="button"
                onClick={onViewDetails}
                className="ml-auto min-h-9 font-bold text-primary hover:underline"
              >
                View details
              </button>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

function ForecastTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  currency: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="max-w-[230px] rounded-xl border border-border bg-[color:var(--popover)] p-3 text-xs shadow-elegant">
      <div className="font-black">{formatDisplayDate(point.date)}</div>
      {point.actual != null && (
        <div className="mt-2 flex justify-between gap-4 text-muted-foreground">
          <span>Actual</span>
          <strong className="text-foreground">{formatMoney(point.actual, currency)}</strong>
        </div>
      )}
      {point.projected != null && (
        <div className="mt-1 flex justify-between gap-4 text-muted-foreground">
          <span>Projected</span>
          <strong className="text-foreground">{formatMoney(point.projected, currency)}</strong>
        </div>
      )}
      {(point.events ?? []).length > 0 && (
        <div className="mt-2 grid gap-1 border-t border-border pt-2 text-muted-foreground">
          {point.events?.map((event) => (
            <span key={event}>{event}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function LegendLine({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-0.5 w-6 ${dashed ? "border-t-2 border-dotted bg-transparent" : ""}`}
        style={dashed ? { borderColor: color } : { backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function UpcomingBillButton({
  item,
  currency,
  onClick,
}: {
  item: CashFlowBreakdownItem;
  currency: string;
  onClick: () => void;
}) {
  const Icon = billIcon(item);
  const dueDate = item.periodDate ?? item.dueDate;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-w-0 bg-[color:var(--card-solid)] p-3 text-left transition hover:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 sm:p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-warn/10 text-warn">
          <Icon size={18} />
        </span>
        {dueDate && (
          <span className="rounded-lg border border-warn/30 bg-warn/10 px-2 py-1 text-[10px] font-black uppercase text-warn">
            {formatShortDate(dueDate)}
          </span>
        )}
      </div>
      <div className="mt-3 truncate text-sm font-bold group-hover:text-primary">{item.label}</div>
      <div className="mt-1 text-base font-black">{formatMoney(item.amount, currency)}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {dueDate && dueDate < isoDate(new Date()) ? "Past due - still protected" : "Upcoming"}
      </div>
    </button>
  );
}

function ZeroAprPanel({
  cards,
  state,
  currency,
  onCard,
  onExtraPayment,
  onChooseExtraPayment,
}: {
  cards: CardType[];
  state: AppState;
  currency: string;
  onCard: (card: CardType) => void;
  onExtraPayment: (card: CardType) => void;
  onChooseExtraPayment: () => void;
}) {
  return (
    <section className="order-3 xl:col-start-2 xl:row-start-1" aria-labelledby="zero-apr-title">
      <Card className="overflow-hidden !p-0">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h2 id="zero-apr-title" className="text-lg font-black">
            0% APR payoff plan
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pay these balances before promotional interest ends.
          </p>
        </div>
        {cards.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No active 0% APR balances"
            detail="Eligible promotional cards will appear here."
          />
        ) : (
          <div className="divide-y divide-border">
            {cards.map((card) => {
              const plan = zeroAprPayoffPlan(card, state.transactions);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => onCard(card)}
                  className="block w-full px-4 py-4 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 sm:px-5"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-black text-primary">
                      {card.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-black">{card.name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {card.zeroAprEndDate
                              ? `Ends ${formatDisplayDate(card.zeroAprEndDate)}`
                              : "Promo end date not set"}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Recommended {formatMoney(plan.recommendedMonthlyPayment, currency)}
                            /cycle
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-black">
                            {formatMoney(card.currentBalance, currency)}
                          </div>
                          {plan.daysRemaining != null && (
                            <span
                              className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-black ${
                                plan.daysRemaining <= 30
                                  ? "bg-bad/15 text-bad"
                                  : plan.daysRemaining <= 90
                                    ? "bg-warn/15 text-warn"
                                    : "bg-good/15 text-good"
                              }`}
                            >
                              {plan.daysRemaining > 0
                                ? `${plan.daysRemaining} days left`
                                : "Promo ended"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{ width: `${plan.progressPercent}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                        <span>{Math.round(plan.progressPercent)}% paid</span>
                        <span>Remaining {formatMoney(card.currentBalance, currency)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            <div className="p-3 sm:p-4">
              <Button
                type="button"
                variant="ghost"
                full
                onClick={onChooseExtraPayment}
                disabled={cards.length === 0}
              >
                <Plus size={17} />
                Add extra payment
              </Button>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

function AlertsPanel({
  alerts,
  onAlert,
  onViewAll,
}: {
  alerts: ForecastAlert[];
  onAlert: (alert: ForecastAlert) => void;
  onViewAll: () => void;
}) {
  return (
    <section className="order-4 xl:col-start-2 xl:row-start-2" aria-labelledby="alerts-title">
      <Card className="overflow-hidden !p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
          <h2 id="alerts-title" className="text-lg font-black">
            Alerts
          </h2>
          <button
            type="button"
            onClick={onViewAll}
            className="min-h-10 text-sm font-bold text-primary hover:underline"
          >
            View all
          </button>
        </div>
        <div className="divide-y divide-border">
          {alerts.slice(0, 3).map((alert) => (
            <AlertButton key={alert.id} alert={alert} onClick={() => onAlert(alert)} />
          ))}
        </div>
      </Card>
    </section>
  );
}

function AlertButton({ alert, onClick }: { alert: ForecastAlert; onClick: () => void }) {
  const Icon =
    alert.severity === "success"
      ? CheckCircle2
      : alert.severity === "critical"
        ? ShieldAlert
        : alert.severity === "warning"
          ? AlertTriangle
          : Info;
  const tone =
    alert.severity === "success"
      ? "text-good bg-good/10"
      : alert.severity === "critical"
        ? "text-bad bg-bad/10"
        : alert.severity === "warning"
          ? "text-warn bg-warn/10"
          : "text-primary bg-primary/10";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 sm:px-5"
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black">{alert.title}</span>
        <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {alert.detail}
        </span>
      </span>
      <ChevronRight size={17} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function ScenarioPanel({
  scenario,
  customScenario,
  currency,
  projectedEnd,
  safeToSpend,
  onChange,
  onCustomize,
}: {
  scenario: ForecastScenario;
  customScenario: CustomForecastScenario;
  currency: string;
  projectedEnd: number;
  safeToSpend: number;
  onChange: (scenario: ForecastScenario) => void;
  onCustomize: () => void;
}) {
  const presets: Array<{
    id: ForecastScenario;
    label: string;
    detail: string;
    icon: ForecastIcon;
  }> = [
    { id: "expected", label: "Normal spending", detail: "Your current plan", icon: CreditCard },
    { id: "best", label: "Reduce spending", detail: "20% less one-time spending", icon: Leaf },
    { id: "worst", label: "Unexpected expense", detail: "Adds a temporary $500 cost", icon: Zap },
  ];
  return (
    <section className="order-5 xl:col-span-2" aria-labelledby="scenario-title">
      <Card className="!p-0">
        <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[190px_1fr_auto] lg:items-center">
          <div>
            <h2 id="scenario-title" className="text-lg font-black">
              What if?
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Test a change without editing real records.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {presets.map(({ id, label, detail, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={scenario === id}
                onClick={() => onChange(id)}
                className={`flex min-h-[64px] items-center gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 ${
                  scenario === id
                    ? "border-primary bg-primary/10"
                    : "border-border bg-[color:var(--card-solid)] hover:bg-muted"
                }`}
              >
                <Icon
                  size={21}
                  className={
                    id === "best" ? "text-good" : id === "worst" ? "text-bad" : "text-primary"
                  }
                />
                <span className="min-w-0">
                  <span className="block text-sm font-black">{label}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{detail}</span>
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onCustomize}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 ${
              scenario === "custom" ? "border-primary bg-primary/10" : "border-border"
            }`}
          >
            <SlidersHorizontal size={17} />
            Customize
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <span>
            Period-end:{" "}
            <strong className="text-foreground">{formatMoney(projectedEnd, currency)}</strong>
          </span>
          <span>
            Safe now:{" "}
            <strong className={safeToSpend < 0 ? "text-bad" : "text-good"}>
              {formatMoney(safeToSpend, currency)}
            </strong>
          </span>
          {scenario === "custom" && (
            <span>
              Temporary expense: {formatMoney(customScenario.unexpectedExpenseAmount, currency)}
            </span>
          )}
        </div>
      </Card>
    </section>
  );
}

function EmptyState({
  icon: Icon,
  title,
  detail,
}: {
  icon: ForecastIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="grid min-h-[150px] place-items-center px-5 py-8 text-center">
      <div>
        <Icon size={24} className="mx-auto text-muted-foreground" />
        <div className="mt-3 font-black">{title}</div>
        <div className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          {detail}
        </div>
      </div>
    </div>
  );
}

function buildAlerts(
  state: AppState,
  range: ForecastDateRange,
  projection: ForecastCashProjection,
  safety: ForecastCashProjection,
  zeroAprCards: CardType[],
): ForecastAlert[] {
  const alerts: ForecastAlert[] = [];
  if (safety.safeSurplus < 0) {
    alerts.push({
      id: "safe-shortfall",
      severity: "critical",
      title: "Future cash shortfall",
      detail: `Your protected forecast falls ${formatMoney(
        Math.abs(safety.safeSurplus),
        state.profile.currency,
      )} below the safety floor.`,
      target: "safe",
    });
  }
  safety.accountFundingWarnings.slice(0, 2).forEach((warning) => {
    alerts.push({
      id: `account-${warning.accountId}-${warning.date}`,
      severity: "critical",
      title: `${warning.accountName} needs funding`,
      detail: `${warning.eventLabel} on ${formatDisplayDate(
        warning.date,
      )} would leave that payment account short.`,
      target: "profile",
    });
  });
  zeroAprCards.forEach((card) => {
    const plan = zeroAprPayoffPlan(card, state.transactions);
    if (plan.daysRemaining == null || plan.daysRemaining > 90) return;
    alerts.push({
      id: `promo-${card.id}`,
      severity: plan.daysRemaining <= 30 ? "critical" : "warning",
      title: `${card.name} promo deadline`,
      detail:
        plan.daysRemaining > 0
          ? `${plan.daysRemaining} days remain. Recommended ${formatMoney(
              plan.recommendedMonthlyPayment,
              state.profile.currency,
            )} per statement cycle.`
          : "The promotional period has ended. Review the full balance now.",
      target: "cards",
    });
  });
  const timeOff = state.timesheet.filter(
    (entry) =>
      entry.entryType === "time_off" && entry.date >= range.start && entry.date <= range.end,
  );
  const timeOffAmount = timeOff.reduce((sum, entry) => sum + entry.expectedAmount, 0);
  if (timeOffAmount > 0) {
    alerts.push({
      id: "time-off",
      severity: "information",
      title: "Time off affects expected earnings",
      detail: `${formatMoney(
        timeOffAmount,
        state.profile.currency,
      )} of scheduled earnings is unavailable in this range.`,
      target: "income",
    });
  }
  if (projection.projectedPartTimeIncome > 0) {
    alerts.push({
      id: "projected-income",
      severity: "information",
      title: "Part-time income is projected",
      detail: `${formatMoney(
        projection.projectedPartTimeIncome,
        state.profile.currency,
      )} depends on planned shifts. It is shown here but excluded from Safe to spend.`,
      target: "income",
    });
  }
  if (!alerts.some((alert) => alert.severity === "critical" || alert.severity === "warning")) {
    alerts.push({
      id: "on-track",
      severity: "success",
      title: "You are on track",
      detail: "Known obligations remain covered inside the current safety window.",
      target: "safe",
    });
  }
  return alerts;
}

function ForecastPanels({
  panel,
  onClose,
  onPanel,
  state,
  selectedProjection,
  safetyProjection,
  displayRange,
  upcomingItems,
  upcomingTotal,
  alerts,
  period,
  customRange,
  includeProjectedIncome,
  scenario,
  customScenario,
  onPeriod,
  onCustomRange,
  onProjectedIncome,
  onScenario,
  onCustomScenario,
  onTarget,
  setTab,
}: {
  panel: Panel | null;
  onClose: () => void;
  onPanel: (panel: Panel | null) => void;
  state: AppState;
  selectedProjection: ForecastCashProjection;
  safetyProjection: ForecastCashProjection;
  displayRange: ForecastDateRange;
  upcomingItems: CashFlowBreakdownItem[];
  upcomingTotal: number;
  alerts: ForecastAlert[];
  period: CashFlowPeriod;
  customRange: ForecastDateRange;
  includeProjectedIncome: boolean;
  scenario: ForecastScenario;
  customScenario: CustomForecastScenario;
  onPeriod: (period: CashFlowPeriod) => void;
  onCustomRange: (range: ForecastDateRange) => void;
  onProjectedIncome: (include: boolean) => void;
  onScenario: (scenario: ForecastScenario) => void;
  onCustomScenario: (scenario: CustomForecastScenario) => void;
  onTarget: (target?: ForecastAlert["target"]) => void;
  setTab?: (tab: Tab) => void;
}) {
  const currency = state.profile.currency;
  if (!panel) return null;

  if (panel.type === "edit-bill") {
    if (panel.item.sourceType === "recurring_bill") {
      const bill = state.recurringBills.find((candidate) => candidate.id === panel.item.sourceId);
      return bill ? <RecurringSheet onClose={onClose} initial={bill} /> : null;
    }
    if (panel.item.sourceType === "debt_plan") {
      const debt = state.debts.find((candidate) => candidate.id === panel.item.sourceId);
      return debt ? <DebtSheet onClose={onClose} initial={debt} /> : null;
    }
    if (panel.item.sourceType === "card_due") {
      const card = state.cards.find((candidate) => candidate.id === panel.item.sourceId);
      return card ? <CardSheet onClose={onClose} initial={card} /> : null;
    }
  }
  if (panel.type === "edit-card") {
    return <CardSheet onClose={onClose} initial={panel.card} />;
  }
  if (panel.type === "extra-payment") {
    return <ExtraPaymentSheet card={panel.card} onClose={onClose} />;
  }
  if (panel.type === "select-extra-payment") {
    return (
      <Sheet open onClose={onClose} title="Choose a 0% APR card">
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {state.cards
            .filter(
              (card) =>
                (card.type === "zero_apr" || card.type === "zero_apr_car") &&
                card.currentBalance > 0,
            )
            .map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => onPanel({ type: "extra-payment", card })}
                className="flex min-h-[68px] w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-muted"
              >
                <span>
                  <span className="block font-black">{card.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Current balance {formatMoney(card.currentBalance, currency)}
                  </span>
                </span>
                <ChevronRight size={17} className="text-muted-foreground" />
              </button>
            ))}
        </div>
      </Sheet>
    );
  }
  if (panel.type === "filters") {
    return (
      <Sheet open onClose={onClose} title="Forecast filters">
        <div className="grid gap-4">
          <Field label="Date range">
            <Select
              value={period}
              onChange={(event) => onPeriod(event.target.value as CashFlowPeriod)}
            >
              {Object.entries(cashFlowPeriodLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {period === "custom" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From">
                <Input
                  type="date"
                  value={customRange.start}
                  onChange={(event) => onCustomRange({ ...customRange, start: event.target.value })}
                />
              </Field>
              <Field label="To">
                <Input
                  type="date"
                  value={customRange.end}
                  onChange={(event) => onCustomRange({ ...customRange, end: event.target.value })}
                />
              </Field>
            </div>
          )}
          <label className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-border bg-muted/30 p-4">
            <span>
              <span className="block text-sm font-black">Include planned part-time income</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Forecast totals may include future scheduled shifts. Safe to spend never relies on
                them.
              </span>
            </span>
            <input
              type="checkbox"
              checked={includeProjectedIncome}
              onChange={(event) => onProjectedIncome(event.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>
          <div className="rounded-2xl border border-border bg-muted/25 p-4 text-xs leading-relaxed text-muted-foreground">
            Selected view: {formatDisplayDate(displayRange.start)} to{" "}
            {formatDisplayDate(displayRange.end)}. Safe to spend remains protected for{" "}
            {SPENDABLE_TODAY_HORIZON_DAYS} days regardless of this display filter.
          </div>
        </div>
      </Sheet>
    );
  }
  if (panel.type === "summary") {
    return (
      <SummaryDetailsSheet
        metric={panel.metric}
        state={state}
        projection={selectedProjection}
        safety={safetyProjection}
        range={displayRange}
        onClose={onClose}
        onManage={(tab) => {
          onClose();
          setTab?.(tab);
        }}
      />
    );
  }
  if (panel.type === "forecast-details") {
    return (
      <Sheet open onClose={onClose} title="Forecast details" size="wide">
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniMetric
              label="Starting cash"
              value={formatMoney(selectedProjection.startingCash, currency)}
            />
            <MiniMetric
              label="Income"
              value={formatMoney(selectedProjection.projectedIncome, currency)}
            />
            <MiniMetric
              label="Expenses"
              value={formatMoney(selectedProjection.totalExpenses, currency)}
            />
            <MiniMetric
              label="Period-end"
              value={formatMoney(selectedProjection.endingBalance, currency)}
            />
          </div>
          <EventList events={selectedProjection.events} currency={currency} />
        </div>
      </Sheet>
    );
  }
  if (panel.type === "bill") {
    return (
      <BillDetailSheet
        item={panel.item}
        currency={currency}
        onClose={onClose}
        onEdit={() => onPanel({ type: "edit-bill", item: panel.item })}
        onManage={() => {
          onClose();
          if (panel.item.sourceType === "card_due") setTab?.("cards");
          else if (panel.item.sourceType === "one_time") setTab?.("dashboard");
          else setTab?.("profile");
        }}
      />
    );
  }
  if (panel.type === "all-bills") {
    return (
      <Sheet open onClose={onClose} title="All upcoming bills" size="wide">
        <div className="mb-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {formatDisplayDate(displayRange.start)} to {formatDisplayDate(displayRange.end)}
          </span>
          <strong>{formatMoney(upcomingTotal, currency)}</strong>
        </div>
        {upcomingItems.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No upcoming bills"
            detail="Nothing is due in this range."
          />
        ) : (
          <div className="divide-y divide-border rounded-2xl border border-border">
            {upcomingItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPanel({ type: "bill", item })}
                className="flex min-h-[70px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {item.dueDate ? formatDisplayDate(item.dueDate) : item.detail}
                  </span>
                </span>
                <strong>{formatMoney(item.amount, currency)}</strong>
                <ChevronRight size={16} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </Sheet>
    );
  }
  if (panel.type === "card") {
    const plan = zeroAprPayoffPlan(panel.card, state.transactions);
    return (
      <Sheet
        open
        onClose={onClose}
        title={panel.card.name}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => onPanel({ type: "edit-card", card: panel.card })}
            >
              <Pencil size={16} />
              Edit card
            </Button>
            <Button
              variant="primary"
              onClick={() => onPanel({ type: "extra-payment", card: panel.card })}
            >
              <Plus size={16} />
              Extra payment
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniMetric
            label="Current balance"
            value={formatMoney(panel.card.currentBalance, currency)}
          />
          <MiniMetric
            label="Recommended per cycle"
            value={formatMoney(plan.recommendedMonthlyPayment, currency)}
          />
          <MiniMetric
            label="Recorded payments"
            value={formatMoney(plan.recordedPayments, currency)}
          />
          <MiniMetric
            label="Promo deadline"
            value={
              panel.card.zeroAprEndDate ? formatDisplayDate(panel.card.zeroAprEndDate) : "Not set"
            }
          />
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          The recommendation uses the card's remaining statement cycles and minimum payment. It does
          not change the card until you explicitly record a payment.
        </p>
      </Sheet>
    );
  }
  if (panel.type === "alert") {
    return (
      <Sheet
        open
        onClose={onClose}
        title={panel.alert.title}
        footer={
          panel.alert.target ? (
            <Button variant="primary" onClick={() => onTarget(panel.alert.target)}>
              Review related details
            </Button>
          ) : undefined
        }
      >
        <AlertExplanation alert={panel.alert} />
      </Sheet>
    );
  }
  if (panel.type === "all-alerts") {
    return (
      <Sheet open onClose={onClose} title="All forecast alerts">
        <div className="divide-y divide-border rounded-2xl border border-border">
          {alerts.map((alert) => (
            <AlertButton
              key={alert.id}
              alert={alert}
              onClick={() => onPanel({ type: "alert", alert })}
            />
          ))}
        </div>
      </Sheet>
    );
  }
  if (panel.type === "custom-scenario") {
    return (
      <CustomScenarioSheet
        value={customScenario}
        scenario={scenario}
        onChange={onCustomScenario}
        onApply={() => {
          onScenario("custom");
          onClose();
        }}
        onClose={onClose}
      />
    );
  }
  return null;
}

function SummaryDetailsSheet({
  metric,
  state,
  projection,
  safety,
  range,
  onClose,
  onManage,
}: {
  metric: SummaryMetric;
  state: AppState;
  projection: ForecastCashProjection;
  safety: ForecastCashProjection;
  range: ForecastDateRange;
  onClose: () => void;
  onManage: (tab: Tab) => void;
}) {
  const currency = state.profile.currency;
  if (metric === "safe") {
    return (
      <Sheet open onClose={onClose} title="Safe to spend" size="wide">
        <div className="rounded-2xl border border-good/30 bg-good/10 p-4">
          <div className="text-xs font-bold uppercase text-good">Safe now</div>
          <div className="mt-1 text-3xl font-black text-good">
            {formatMoney(safety.safeSurplus, currency)}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Spending this amount now keeps every known obligation in the next{" "}
            {SPENDABLE_TODAY_HORIZON_DAYS} days above your{" "}
            {formatMoney(state.profile.safeToSpendFloor, currency)} cash floor.
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <MiniMetric label="Starting cash" value={formatMoney(safety.startingCash, currency)} />
          <MiniMetric
            label="Lowest projected cash"
            value={formatMoney(safety.lowestBalance, currency)}
          />
          <MiniMetric
            label="Cash floor"
            value={formatMoney(state.profile.safeToSpendFloor, currency)}
          />
        </div>
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-black">Protected timeline</h3>
          <EventList events={safety.events} currency={currency} />
        </div>
      </Sheet>
    );
  }
  if (metric === "projected") {
    return (
      <Sheet open onClose={onClose} title="Projected period-end">
        <div className="grid gap-3">
          <MiniMetric
            label="Starting spendable cash"
            value={formatMoney(projection.startingCash, currency)}
          />
          <FormulaRow
            label="Expected income"
            value={projection.projectedIncome}
            currency={currency}
            tone="good"
          />
          <FormulaRow
            label="Upcoming expenses"
            value={-projection.totalExpenses}
            currency={currency}
            tone="bad"
          />
          <FormulaRow
            label={`Balance on ${formatDisplayDate(range.end)}`}
            value={projection.endingBalance}
            currency={currency}
            strong
          />
        </div>
      </Sheet>
    );
  }
  if (metric === "runway") {
    return (
      <Sheet open onClose={onClose} title="Cash runway">
        <div className="grid gap-3">
          <MiniMetric
            label="Runway"
            value={
              safety.runwayDays == null
                ? `${SPENDABLE_TODAY_HORIZON_DAYS}+ days`
                : `${safety.runwayDays} days`
            }
          />
          <MiniMetric
            label="Safety floor"
            value={formatMoney(state.profile.safeToSpendFloor, currency)}
          />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {safety.runwayDate
              ? `Your projected cash first falls below the floor on ${formatDisplayDate(safety.runwayDate)}.`
              : `Your known cash flow stays above the floor through ${formatDisplayDate(safety.range.end)}.`}
          </p>
        </div>
      </Sheet>
    );
  }
  const reservedAccounts = state.accounts.filter(
    (account) => account.availableForSpending === false,
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title="Reserved cash"
      footer={<Button onClick={() => onManage("profile")}>Manage accounts</Button>}
    >
      <FormulaRow label="Cash floor" value={state.profile.safeToSpendFloor} currency={currency} />
      {reservedAccounts.map((account) => (
        <FormulaRow
          key={account.id}
          label={account.name}
          value={account.balance}
          currency={currency}
        />
      ))}
      <FormulaRow
        label="Total reserved"
        value={reservedCashTotal(state)}
        currency={currency}
        strong
      />
      {reservedAccounts.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          No account is currently excluded from spendable cash. Only your cash floor is reserved.
        </p>
      )}
    </Sheet>
  );
}

function BillDetailSheet({
  item,
  currency,
  onClose,
  onEdit,
  onManage,
}: {
  item: CashFlowBreakdownItem;
  currency: string;
  onClose: () => void;
  onEdit: () => void;
  onManage: () => void;
}) {
  const editable =
    item.id !== "scenario-unexpected" &&
    !!item.sourceId &&
    ["recurring_bill", "card_due", "debt_plan"].includes(item.sourceType ?? "");
  return (
    <Sheet
      open
      onClose={onClose}
      title={item.label}
      footer={
        <>
          <Button variant="ghost" onClick={onManage}>
            Open source
          </Button>
          {editable && (
            <Button variant="primary" onClick={onEdit}>
              <Pencil size={16} />
              Edit
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <MiniMetric label="Amount" value={formatMoney(item.amount, currency)} />
        <MiniMetric
          label="Payment date"
          value={item.dueDate ? formatDisplayDate(item.dueDate) : "Not set"}
        />
        <MiniMetric label="Type" value={(item.sourceType ?? "planned").replaceAll("_", " ")} />
        <MiniMetric label="Category" value={item.category ?? "Not categorized"} />
      </div>
      <div className="mt-4 rounded-2xl border border-border bg-muted/25 p-4 text-sm text-muted-foreground">
        {item.detail || "No additional note."}
      </div>
    </Sheet>
  );
}

function EventList({
  events,
  currency,
}: {
  events: ForecastCashProjection["events"];
  currency: string;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={Clock3}
        title="No forecast events"
        detail="No income or expenses fall in this range."
      />
    );
  }
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
      {events.map((event) => (
        <div key={event.id} className="flex items-start gap-3 px-4 py-3">
          <span
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${event.amount < 0 ? "bg-bad" : "bg-good"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="font-bold">{event.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {formatDisplayDate(event.date)} - {event.detail}
            </div>
          </div>
          <strong className={event.amount < 0 ? "text-bad" : "text-good"}>
            {event.amount < 0 ? "-" : "+"}
            {formatMoney(Math.abs(event.amount), currency)}
          </strong>
        </div>
      ))}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/25 p-4">
      <div className="text-xs font-bold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-black">{value}</div>
    </div>
  );
}

function FormulaRow({
  label,
  value,
  currency,
  tone,
  strong,
}: {
  label: string;
  value: number;
  currency: string;
  tone?: "good" | "bad";
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 border-b border-border py-3 ${strong ? "text-lg" : "text-sm"}`}
    >
      <span className={strong ? "font-black" : "text-muted-foreground"}>{label}</span>
      <strong className={tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}>
        {formatMoney(value, currency)}
      </strong>
    </div>
  );
}

function AlertExplanation({ alert }: { alert: ForecastAlert }) {
  const Icon =
    alert.severity === "success"
      ? CheckCircle2
      : alert.severity === "critical"
        ? ShieldAlert
        : alert.severity === "warning"
          ? AlertTriangle
          : Info;
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-border bg-muted/25 p-4">
      <Icon
        size={24}
        className={
          alert.severity === "success"
            ? "text-good"
            : alert.severity === "critical"
              ? "text-bad"
              : alert.severity === "warning"
                ? "text-warn"
                : "text-primary"
        }
      />
      <div>
        <div className="font-black">{alert.title}</div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{alert.detail}</p>
      </div>
    </div>
  );
}

function ExtraPaymentSheet({ card, onClose }: { card: CardType; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const plan = zeroAprPayoffPlan(card, state.transactions);
  const spendableAccounts = state.accounts.filter(
    (account) => account.availableForSpending !== false,
  );
  const [amount, setAmount] = useState(plan.recommendedMonthlyPayment);
  const [accountId, setAccountId] = useState(
    card.defaultPaymentAccountId ?? spendableAccounts[0]?.id ?? "",
  );
  const [date, setDate] = useState(isoDate(new Date()));

  function save() {
    if (!accountId) return toast("Choose the payment account");
    if (amount <= 0 || amount > card.currentBalance) {
      return toast("Enter a payment up to the current card balance");
    }
    dispatch({
      type: "PAY_CREDIT_CARD",
      payload: {
        cardId: card.id,
        amount,
        sourceAccountId: accountId,
        date,
        notes: "Extra payment from Forecast",
      },
    });
    toast("Card payment recorded");
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Pay ${card.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Amount"
          hint={`Current balance ${formatMoney(card.currentBalance, state.profile.currency)}`}
        >
          <Input
            type="number"
            min={0.01}
            max={card.currentBalance}
            step={0.01}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        </Field>
        <Field label="Payment date">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Paid from">
          <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">Choose an account</option>
            {spendableAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} - {formatMoney(account.balance, state.profile.currency)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

function CustomScenarioSheet({
  value,
  scenario,
  onChange,
  onApply,
  onClose,
}: {
  value: CustomForecastScenario;
  scenario: ForecastScenario;
  onChange: (value: CustomForecastScenario) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Custom scenario"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onChange(draft);
              onApply();
            }}
          >
            Apply scenario
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Unexpected expense amount">
          <Input
            type="number"
            min={0}
            step={0.01}
            value={draft.unexpectedExpenseAmount}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                unexpectedExpenseAmount: Number(event.target.value),
              }))
            }
          />
        </Field>
        <Field label="Expense date">
          <Input
            type="date"
            value={draft.unexpectedExpenseDate}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                unexpectedExpenseDate: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Reduce one-time expenses by %">
          <Input
            type="number"
            min={0}
            max={100}
            value={draft.variableExpenseReductionPercent}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                variableExpenseReductionPercent: Math.min(100, Number(event.target.value)),
              }))
            }
          />
        </Field>
        <div className="rounded-2xl border border-border bg-muted/25 p-4 text-sm leading-relaxed text-muted-foreground">
          This is a temporary forecast only. Applying it will not create a transaction or change any
          account, card, bill, debt, or saved plan. Current mode: {SCENARIO_LABELS[scenario]}.
        </div>
      </div>
    </Sheet>
  );
}
