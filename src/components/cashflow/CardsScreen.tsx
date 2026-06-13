import { useState } from "react";
import { Pencil } from "lucide-react";
import { Card } from "./Card";
import { CardSheet } from "./Profile";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney } from "@/lib/cashflow/money";
import {
  availableCredit,
  currentOpenCycle,
  paydownToTarget,
  utilization,
} from "@/lib/cashflow/cardLogic";
import type { Card as CardT } from "@/lib/cashflow/types";

export function CardsScreen({ onPay }: { onPay: (cardId: string) => void }) {
  const { state } = useApp();
  const cur = state.profile.currency;
  const [editing, setEditing] = useState<CardT | null>(null);

  if (state.cards.length === 0) {
    return (
      <Card>
        <h2 className="text-xl font-extrabold mb-2">No cards yet</h2>
        <p className="text-sm text-muted-foreground">
          Add credit cards from your Profile to track utilization, due dates, and pay bills.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Credit cards</h1>
        <p className="text-sm text-muted-foreground">Utilization, balances, and upcoming bills.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {state.cards.map((c) => {
          const u = utilization(c) * 100;
          const over = u > c.targetUtilizationPercent;
          return (
            <Card key={c.id} className="relative">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="text-xs uppercase font-bold tracking-wide text-muted-foreground">
                    {c.type.replace("_", " ")}
                  </div>
                  <div className="text-xl font-black">{c.name}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditing(c)}
                    className="p-2 rounded-xl bg-muted text-foreground hover:bg-border"
                    aria-label="Edit card"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => onPay(c.id)}
                    className="px-3 py-2 rounded-xl brand-gradient text-primary-foreground text-xs font-extrabold shadow-soft"
                  >
                    Pay bill
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <Stat label="Current" value={formatMoney(c.currentBalance, cur)} />
                <Stat label="Available" value={formatMoney(availableCredit(c), cur)} />
                <Stat label="Statement" value={formatMoney(c.statementBalance, cur)} />
                <Stat label="Minimum" value={formatMoney(c.minimumDue, cur)} />
              </div>

              <div className="mb-1.5 flex justify-between text-xs font-bold">
                <span className="text-muted-foreground">Utilization</span>
                <span className={over ? "text-[color:var(--warn)]" : ""}>
                  {u.toFixed(0)}% / {c.targetUtilizationPercent}% target
                </span>
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
              <div className="mt-3 text-xs text-muted-foreground">
                Bills on day {c.billingDate} · Due day {c.dueDate} · {c.apr}% APR
              </div>
              {(c.type === "zero_apr" || c.type === "zero_apr_car") && (
                <ZeroAprBanner card={c} currency={cur} />
              )}
            </Card>
          );
        })}
      </div>
      {editing && <CardSheet key={editing.id} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ZeroAprBanner({ card, currency }: { card: CardT; currency: string }) {
  if (!card.zeroAprEndDate) {
    return (
      <div className="mt-3 rounded-xl border border-[color:var(--warn)]/40 bg-[color:var(--warn)]/10 px-3 py-2 text-xs">
        <span className="font-extrabold text-[color:var(--warn)]">Set 0% APR end date</span>
        <span className="text-muted-foreground">
          {" "}
          — edit this card so we can warn you before interest kicks in.
        </span>
      </div>
    );
  }
  const end = new Date(card.zeroAprEndDate + "T00:00:00");
  const today = new Date();
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  const cycle = currentOpenCycle(card, today);
  const promoEndsThisCycle = cycle.cycleEnd >= card.zeroAprEndDate;
  const targetPaydown = paydownToTarget(card);
  const remainingAfterPaydown = Math.max(0, card.currentBalance - targetPaydown);
  const estimatedMinimum = Math.min(card.minimumDue, remainingAfterPaydown);
  const tone = days < 0 ? "bad" : days <= 60 ? "warn" : "good";
  const color = `var(--${tone})`;
  const label =
    days < 0
      ? `0% APR expired ${-days}d ago`
      : days === 0
        ? "0% APR ends today"
        : `${days} days of 0% APR left`;
  return (
    <div
      className="mt-3 rounded-xl px-3 py-2 text-xs"
      style={{ border: `1px solid ${color}40`, background: `${color}1a` }}
    >
      <div className="flex justify-between gap-2">
        <span className="font-extrabold" style={{ color }}>
          {label}
        </span>
        <span className="text-muted-foreground">ends {card.zeroAprEndDate}</span>
      </div>
      {card.currentBalance > 0 && promoEndsThisCycle && (
        <div className="mt-1 text-muted-foreground">
          Pay{" "}
          <span className="font-extrabold text-foreground">
            {formatMoney(card.currentBalance, currency)}
          </span>{" "}
          by then to avoid interest charges.
        </div>
      )}
      {card.currentBalance > 0 && !promoEndsThisCycle && (
        <div className="mt-1 text-muted-foreground">
          {targetPaydown > 0 ? (
            <>
              Pay{" "}
              <span className="font-extrabold text-foreground">
                {formatMoney(targetPaydown, currency)}
              </span>{" "}
              before statement close to stay near your utilization target.
            </>
          ) : (
            <>You are already within your utilization target for this cycle.</>
          )}{" "}
          {estimatedMinimum > 0 && (
            <>
              Then expect about{" "}
              <span className="font-extrabold text-foreground">
                {formatMoney(estimatedMinimum, currency)}
              </span>{" "}
              due on the next bill.
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/50 p-2.5">
      <div className="text-[10px] uppercase font-bold tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-black mt-0.5">{value}</div>
    </div>
  );
}
