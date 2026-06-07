import { Card } from "./Card";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney } from "@/lib/cashflow/money";
import {
  cardMinimums,
  debtMinimums,
  pendingIncome,
  projectedMonthEnd,
  safeToSpend,
  totalCash,
  upcomingBillsThisMonth,
} from "@/lib/cashflow/forecast";

export function Forecast() {
  const { state } = useApp();
  const cur = state.profile.currency;
  const m = (n: number) => formatMoney(n, cur);

  const timeOff = state.timesheet
    .filter((e) => e.entryType === "time_off")
    .reduce((s, e) => s + e.expectedAmount, 0);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Forecast</h1>
        <p className="text-sm text-muted-foreground">Where your money is heading this month.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-lg font-extrabold mb-2">Cash flow</h3>
          <Row label="Current cash" value={m(totalCash(state))} />
          <Row label="+ Expected income" value={m(pendingIncome(state))} tone="good" />
          <Row label="− Upcoming bills" value={m(upcomingBillsThisMonth(state))} tone="bad" />
          <Row label="− Card minimums" value={m(cardMinimums(state))} tone="bad" />
          <Row label="− Debt minimums" value={m(debtMinimums(state))} tone="bad" />
          <div className="border-t border-border mt-2 pt-2">
            <Row label="Projected month-end" value={m(projectedMonthEnd(state))} bold />
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-extrabold mb-2">Safety check</h3>
          <Row label="Safe to spend" value={m(safeToSpend(state))} bold />
          <Row label="Floor reserved" value={m(state.profile.safeToSpendFloor)} />
          <Row label="Time-off impact" value={m(timeOff)} tone="warn" />
          <p className="text-xs text-muted-foreground mt-3">
            Safe-to-spend = cash − upcoming bills − card minimums − debt minimums − floor.
          </p>
        </Card>
      </div>

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
                  <div className="text-xs text-muted-foreground">Day {b.dueDay}</div>
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

function Row({
  label, value, tone, bold,
}: {
  label: string; value: string; tone?: "good" | "bad" | "warn"; bold?: boolean;
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
      <span className={`text-sm ${bold ? "font-extrabold text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <span className={`${bold ? "text-xl font-black" : "font-bold"} ${t}`}>{value}</span>
    </div>
  );
}
