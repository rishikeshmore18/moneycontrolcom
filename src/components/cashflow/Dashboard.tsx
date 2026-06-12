import { useMemo } from "react";
import { CalendarClock, ChevronDown, Info, ReceiptText, Target, Wallet } from "lucide-react";
import { Card, KPI } from "./Card";
import { useApp } from "@/lib/cashflow/AppContext";
import {
  cardDueThisMonth,
  debtPlannedPayments,
  netWorth,
  pendingIncome,
  projectedMonthEnd,
  safeToSpend,
  spendableCash,
  totalCardDebt,
  totalCash,
  upcomingBillsThisMonth,
} from "@/lib/cashflow/forecast";
import { formatMoney } from "@/lib/cashflow/money";
import { utilization } from "@/lib/cashflow/cardLogic";

export function Dashboard() {
  const { state } = useApp();
  const cur = state.profile.currency;
  const m = (n: number) => formatMoney(n, cur);

  const haveNow = spendableCash(state);
  const incomeComing = pendingIncome(state);
  const expensesComing =
    upcomingBillsThisMonth(state) + cardDueThisMonth(state) + debtPlannedPayments(state);
  const leftToSpend = haveNow + incomeComing - expensesComing;
  const sts = safeToSpend(state);
  const recent = useMemo(() => state.transactions.slice(0, 8), [state.transactions]);

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
        formatMoney={m}
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
          <SectionTitle title="This month" />
          <Row label="Upcoming bills" value={m(upcomingBillsThisMonth(state))} />
          <Row label="Cards due this month" value={m(cardDueThisMonth(state))} />
          <Row label="Debt plan" value={m(debtPlannedPayments(state))} />
          <Row label="Pending income" value={m(pendingIncome(state))} tone="good" />
          <div className="mt-3 pt-3 border-t border-border">
            <Row label="Projected month-end" value={m(projectedMonthEnd(state))} bold />
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
                  {t.type.replace("_", " ")} · {t.date}
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
    </div>
  );
}

function CashFlowFormulaCard({
  haveNow,
  incomeComing,
  expensesComing,
  leftToSpend,
  formatMoney,
}: {
  haveNow: number;
  incomeComing: number;
  expensesComing: number;
  leftToSpend: number;
  formatMoney: (n: number) => string;
}) {
  const shortfall = leftToSpend < 0;
  return (
    <Card className="!p-4 sm:!p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-black tracking-tight">This Month Cash Flow</h2>
          <Info size={15} className="text-muted-foreground" aria-hidden="true" />
        </div>
        <button className="inline-flex items-center gap-2 rounded-2xl border border-border bg-[color:var(--card-solid)] px-3 py-2 text-xs font-bold text-foreground hover:bg-muted">
          This month <ChevronDown size={14} />
        </button>
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
          />
          <Connector symbol="+" />
          <FlowSegment
            tone="blue"
            title="Income coming"
            amount={formatMoney(incomeComing)}
            helper={incomeComing > 0 ? "Not received yet" : "No income pending"}
            icon={CalendarClock}
            future
          />
          <Connector symbol="-" />
          <FlowSegment
            tone="orange"
            title="Expenses coming"
            amount={formatMoney(expensesComing)}
            helper={expensesComing > 0 ? "Not paid yet" : "No upcoming expenses"}
            icon={ReceiptText}
            future
          />
          <Connector symbol="=" />
          <FlowSegment
            tone={shortfall ? "red" : "teal"}
            title={shortfall ? "Shortfall" : "Left to spend"}
            amount={formatMoney(leftToSpend)}
            helper={shortfall ? "Needs coverage" : "Ready to use"}
            icon={Target}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FlowDetail
          tone="green"
          label="Have now"
          value={formatMoney(haveNow)}
          helper="Current spendable cash"
          badge="In your accounts"
        />
        <FlowDetail
          tone="blue"
          label="Income coming"
          value={formatMoney(incomeComing)}
          helper="Expected this month"
          badge={incomeComing > 0 ? "Not received yet" : "No income pending"}
        />
        <FlowDetail
          tone="orange"
          label="Expenses coming"
          value={formatMoney(expensesComing)}
          helper="Bills and spending due"
          badge={expensesComing > 0 ? "Not paid yet" : "No upcoming expenses"}
        />
        <FlowDetail
          tone={shortfall ? "red" : "teal"}
          label={shortfall ? "Shortfall" : "Left to spend"}
          value={formatMoney(leftToSpend)}
          helper="Available after expenses"
          badge={shortfall ? "Needs coverage" : "Ready to use"}
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
}: {
  tone: FlowTone;
  title: string;
  amount: string;
  helper: string;
  icon: typeof Wallet;
  future?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-[86px] min-w-[170px] items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 ${flowTone[tone].segment} ${
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
    </div>
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
}: {
  tone: FlowTone;
  label: string;
  value: string;
  helper: string;
  badge: string;
}) {
  return (
    <div className={`rounded-2xl border bg-muted/25 p-3 ${flowTone[tone].detail}`}>
      <div className={`text-xs font-extrabold ${flowTone[tone].text}`}>{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
      <div
        className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold ${flowTone[tone].badge}`}
      >
        {badge}
      </div>
    </div>
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
