import { useMemo } from "react";
import { Card, KPI } from "./Card";
import { useApp } from "@/lib/cashflow/AppContext";
import {
  cardDueThisMonth,
  debtMinimums,
  netWorth,
  pendingIncome,
  projectedMonthEnd,
  safeToSpend,
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

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <KPI
          label="Safe to spend"
          value={m(sts)}
          tone={sts <= 0 ? "bad" : sts < 100 ? "warn" : "good"}
          hint={`Floor ${m(state.profile.safeToSpendFloor)}`}
        />
        <KPI label="Total cash" value={m(totalCash(state))} hint={`${state.accounts.length} accounts`} />
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
                  <div className="text-xs text-muted-foreground capitalize">
                    {a.bankName ? `${a.bankName} · ` : ""}{a.type}
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
          <Row label="Debt minimums" value={m(debtMinimums(state))} />
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
                    <div className={`text-sm font-bold ${over ? "text-[color:var(--warn)]" : "text-muted-foreground"}`}>
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
                    : t.type === "expense" || t.type === "card_payment"
                      ? "text-[color:var(--bad)]"
                      : ""
                }`}
              >
                {t.type === "income" ? "+" : t.type === "expense" || t.type === "card_payment" ? "-" : ""}
                {m(Math.abs(t.amount))}
              </div>
            </div>
          ))}
        </div>
      </Card>
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
function Row({ label, value, tone, bold }: { label: string; value: string; tone?: "good"; bold?: boolean }) {
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
