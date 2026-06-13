import { Card } from "./Card";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney } from "@/lib/cashflow/money";
import { timesheetEntryAmount } from "@/lib/cashflow/timesheetLogic";
import { formatDisplayDate } from "@/lib/cashflow/dates";
import {
  cardMinimums,
  debtPlannedPayments,
  debtMinimums,
  pendingIncome,
  projectedMonthEnd,
  recurringBillScheduleLabel,
  safeToSpend,
  spendableCash,
  upcomingBillsThisMonth,
} from "@/lib/cashflow/forecast";

export function Forecast() {
  const { state } = useApp();
  const cur = state.profile.currency;
  const m = (n: number) => formatMoney(n, cur);

  const timeOff = state.timesheet
    .filter((e) => e.entryType === "time_off")
    .reduce((s, e) => s + timesheetEntryAmount(e), 0);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Forecast</h1>
        <p className="text-sm text-muted-foreground">Where your money is heading this month.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-lg font-extrabold mb-2">Cash flow</h3>
          <Row label="Debt plan" value={m(debtPlannedPayments(state))} tone="bad" />
          <Row label="Spendable cash" value={m(spendableCash(state))} />
          <Row label="+ Expected income" value={m(pendingIncome(state))} tone="good" />
          <Row label="− Upcoming bills" value={m(upcomingBillsThisMonth(state))} tone="bad" />
          <Row label="− Card minimums" value={m(cardMinimums(state))} tone="bad" />
          <div className="border-t border-border mt-2 pt-2">
            <Row label="Projected month-end" value={m(projectedMonthEnd(state))} bold />
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-extrabold mb-2">Safety check</h3>
          <Row label="Safe to spend" value={m(safeToSpend(state))} bold />
          <Row label="Floor reserved" value={m(state.profile.safeToSpendFloor)} />
          <Row label="Time-off deduction" value={m(timeOff)} tone="warn" />
          <p className="text-xs text-muted-foreground mt-3">
            Safe-to-spend = cash − upcoming bills − card minimums − debt minimums − floor.
          </p>
        </Card>
      </div>

      <DebtPlanCheck />

      <ZeroAprAlerts />

      <Card>
        <h3 className="text-lg font-extrabold mb-3">Upcoming bills</h3>
        {state.recurringBills.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">None configured</div>
        ) : (
          <div className="divide-y divide-border">
            {state.recurringBills.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="font-bold">{b.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {recurringBillScheduleLabel(b)}
                  </div>
                </div>
                <div className="font-black">{m(b.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function DebtPlanCheck() {
  const { state } = useApp();
  const cur = state.profile.currency;
  const plan = debtPlannedPayments(state);
  const minimums = debtMinimums(state);
  if (plan <= 0) return null;

  const availableAfterPlan =
    spendableCash(state) +
    pendingIncome(state) -
    upcomingBillsThisMonth(state) -
    cardMinimums(state) -
    plan;
  const shortBy = Math.max(0, state.profile.safeToSpendFloor - availableAfterPlan);

  return (
    <Card>
      <h3 className="text-lg font-extrabold mb-2">Debt payoff check</h3>
      <Row label="Minimum required" value={formatMoney(minimums, cur)} />
      <Row label="Your planned payments" value={formatMoney(plan, cur)} bold />
      {shortBy > 0 ? (
        <p className="text-sm text-[color:var(--bad)] mt-2 font-bold">
          Short by {formatMoney(shortBy, cur)} for this month after keeping your floor.
        </p>
      ) : (
        <p className="text-sm text-[color:var(--good)] mt-2 font-bold">
          You have enough projected cash for this month's debt plan.
        </p>
      )}
    </Card>
  );
}

function ZeroAprAlerts() {
  const { state } = useApp();
  const cur = state.profile.currency;
  const today = new Date();
  const cards = state.cards
    .filter((c) => (c.type === "zero_apr" || c.type === "zero_apr_car") && c.currentBalance > 0)
    .map((c) => {
      const days = c.zeroAprEndDate
        ? Math.ceil(
            (new Date(c.zeroAprEndDate + "T00:00:00").getTime() - today.getTime()) / 86400000,
          )
        : null;
      return { c, days };
    })
    .sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999));

  if (cards.length === 0) return null;

  return (
    <Card>
      <h3 className="text-lg font-extrabold mb-1">0% APR deadlines</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Pay these off before the promo ends to avoid back-charged interest.
      </p>
      <div className="divide-y divide-border">
        {cards.map(({ c, days }) => {
          const tone = days == null ? "warn" : days < 0 ? "bad" : days <= 60 ? "warn" : "good";
          const color = `var(--${tone})`;
          const status =
            days == null
              ? "No end date set"
              : days < 0
                ? `Expired ${-days}d ago`
                : days === 0
                  ? "Ends today"
                  : `${days} days left`;
          const perMonth =
            days != null && days > 0 ? c.currentBalance / Math.max(1, Math.ceil(days / 30)) : null;
          return (
            <div key={c.id} className="py-3 grid gap-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.zeroAprEndDate
                      ? `Ends ${formatDisplayDate(c.zeroAprEndDate)}`
                      : "Add end date in card settings"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-black">{formatMoney(c.currentBalance, cur)}</div>
                  <div className="text-xs font-extrabold" style={{ color }}>
                    {status}
                  </div>
                </div>
              </div>
              {perMonth != null && (
                <div className="text-xs text-muted-foreground">
                  Pay ≈{" "}
                  <span className="font-extrabold text-foreground">
                    {formatMoney(perMonth, cur)}
                  </span>
                  /month to clear it in time.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
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
  tone?: "good" | "bad" | "warn";
  bold?: boolean;
}) {
  const t =
    tone === "good"
      ? "text-[color:var(--good)]"
      : tone === "bad"
        ? "text-[color:var(--bad)]"
        : tone === "warn"
          ? "text-[color:var(--warn)]"
          : "";
  return (
    <div className="flex items-center justify-between py-1.5">
      <span
        className={`text-sm ${bold ? "font-extrabold text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </span>
      <span className={`${bold ? "text-xl font-black" : "font-bold"} ${t}`}>{value}</span>
    </div>
  );
}
