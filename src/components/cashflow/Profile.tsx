import { useState } from "react";
import { Trash2, Plus, Pencil } from "lucide-react";
import { Card } from "./Card";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { Field, Input, Select } from "./Field";
import { useApp } from "@/lib/cashflow/AppContext";
import { WEEKDAY_SHORT } from "@/lib/cashflow/dates";
import {
  isSpendableAccount,
  plannedDebtPayment,
  recurringBillScheduleLabel,
} from "@/lib/cashflow/forecast";
import { formatMoney, toNumber } from "@/lib/cashflow/money";
import type {
  Account,
  AccountType,
  Card as CardT,
  CardType,
  Debt,
  DebtPayoffMode,
  Job,
  PayFrequency,
  RecurringBill,
} from "@/lib/cashflow/types";

import { toast } from "./Toast";

export function Profile() {
  const { state, dispatch, userEmail, signOut } = useApp();
  const cur = state.profile.currency;

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage your accounts, cards, jobs, debts and bills.
        </p>
      </div>

      <Card>
        <h3 className="text-lg font-extrabold mb-3">You</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <Input
              value={state.profile.name}
              onChange={(e) =>
                dispatch({ type: "UPDATE_PROFILE", payload: { name: e.target.value } })
              }
            />
          </Field>
          <Field label="Currency">
            <Input
              value={state.profile.currency}
              onChange={(e) =>
                dispatch({
                  type: "UPDATE_PROFILE",
                  payload: { currency: e.target.value.toUpperCase() },
                })
              }
            />
          </Field>
          <Field label="Safe-to-spend floor">
            <Input
              type="number"
              value={state.profile.safeToSpendFloor}
              onChange={(e) =>
                dispatch({
                  type: "UPDATE_PROFILE",
                  payload: { safeToSpendFloor: toNumber(e.target.value) },
                })
              }
            />
          </Field>
        </div>
      </Card>

      <ListCard
        title="Accounts"
        emptyLabel="No accounts"
        items={state.accounts}
        render={(a) => (
          <>
            <div>
              <div className="font-bold">{a.name}</div>
              {!isSpendableAccount(a) && (
                <div className="text-xs text-[color:var(--warn)]">
                  Reserved{a.savingsPurpose ? ` for ${a.savingsPurpose}` : ""}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {a.bankName} · {a.type}
              </div>
            </div>
            <div className="font-black">{formatMoney(a.balance, cur)}</div>
          </>
        )}
        Form={AccountSheet}
        onDelete={(id) => dispatch({ type: "DELETE_ACCOUNT", id })}
      />

      <ListCard
        title="Credit cards"
        emptyLabel="No cards"
        items={state.cards}
        render={(c) => (
          <>
            <div>
              <div className="font-bold">{c.name}</div>
              <div className="text-xs text-muted-foreground">
                limit {formatMoney(c.limit, cur)} · {c.apr}% APR
              </div>
            </div>
            <div className="font-black">{formatMoney(c.currentBalance, cur)}</div>
          </>
        )}
        Form={CardSheet}
        onDelete={(id) => dispatch({ type: "DELETE_CARD", id })}
      />

      <ListCard
        title="Jobs"
        emptyLabel="No jobs"
        items={state.jobs}
        render={(j) => (
          <>
            <div>
              <div className="font-bold">{j.name}</div>
              <div className="text-xs text-muted-foreground">
                {j.type.replace("_", " ")} · {formatMoney(j.netHourlyRate, cur)}/h
              </div>
              {j.type === "part_time" && jobScheduleSummary(j) && (
                <div className="text-xs text-muted-foreground">{jobScheduleSummary(j)}</div>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{j.payFrequency}</div>
          </>
        )}
        Form={JobSheet}
        onDelete={(id) => dispatch({ type: "DELETE_JOB", id })}
      />

      <ListCard
        title="Debts"
        emptyLabel="No debts"
        items={state.debts}
        render={(d) => (
          <>
            <div>
              <div className="font-bold">{d.name}</div>
              <div className="text-xs text-muted-foreground">
                Plan {formatMoney(plannedDebtPayment(d), cur)}
              </div>
              <div className="text-xs text-muted-foreground">
                {d.status} · min {formatMoney(d.minimumPayment, cur)}
              </div>
            </div>
            <div className="font-black">{formatMoney(d.balance, cur)}</div>
          </>
        )}
        Form={DebtSheet}
        onDelete={(id) => dispatch({ type: "DELETE_DEBT", id })}
      />

      <ListCard
        title="Recurring bills"
        emptyLabel="No bills"
        items={state.recurringBills}
        render={(b) => (
          <>
            <div>
              <div className="font-bold">{b.name}</div>
              <div className="text-xs text-muted-foreground">{recurringBillScheduleLabel(b)}</div>
              {b.cardId && (
                <div className="text-xs text-[color:var(--warn)]">
                  Charges to {state.cards.find((card) => card.id === b.cardId)?.name ?? "card"}
                </div>
              )}
            </div>
            <div className="font-black">{formatMoney(b.amount, cur)}</div>
          </>
        )}
        Form={RecurringSheet}
        onDelete={(id) => dispatch({ type: "DELETE_RECURRING", id })}
      />

      <Card>
        <h3 className="text-lg font-extrabold mb-3">Account</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Signed in as <span className="font-bold text-foreground">{userEmail ?? "—"}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => signOut()}>
            Sign out
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Erase all CashFlow Control data?")) {
                dispatch({ type: "RESET" });
                toast("App reset");
              }
            }}
          >
            Reset everything
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ListCard<T extends { id: string }>({
  title,
  items,
  render,
  emptyLabel,
  Form,
  onDelete,
}: {
  title: string;
  items: T[];
  render: (t: T) => React.ReactNode;
  emptyLabel: string;
  Form: (p: { onClose: () => void; initial?: T }) => React.ReactElement;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-extrabold">{title}</h3>
        <Button variant="ghost" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground py-3">{emptyLabel}</div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between py-2.5 gap-3">
              <button
                type="button"
                onClick={() => setEditing(it)}
                className="flex-1 flex justify-between gap-3 text-left rounded-lg hover:bg-foreground/5 px-1 py-1 -mx-1 transition"
              >
                {render(it)}
              </button>
              <button
                onClick={() => setEditing(it)}
                className="text-muted-foreground p-1.5 rounded-lg hover:bg-foreground/10"
                aria-label="Edit"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => {
                  if (confirm("Delete?")) onDelete(it.id);
                }}
                className="text-[color:var(--bad)] p-1.5 rounded-lg hover:bg-[color:var(--bad)]/10"
                aria-label="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {adding && <Form onClose={() => setAdding(false)} />}
      {editing && <Form key={editing.id} onClose={() => setEditing(null)} initial={editing} />}
    </Card>
  );
}

/* ----- Sheets ----- */
export function AccountSheet({ onClose, initial }: { onClose: () => void; initial?: Account }) {
  const { state, dispatch } = useApp();
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<AccountType>(initial?.type ?? "checking");
  const [balance, setBalance] = useState(String(initial?.balance ?? ""));
  const [availableForSpending, setAvailableForSpending] = useState(
    initial?.availableForSpending !== false,
  );
  const [savingsPurpose, setSavingsPurpose] = useState(initial?.savingsPurpose ?? "");

  function save() {
    if (!name.trim()) return toast("Give it a name");
    const dup = state.accounts.find(
      (a) => a.id !== initial?.id && a.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (dup) return toast("That account name already exists");
    if (initial) {
      dispatch({
        type: "UPDATE_ACCOUNT",
        payload: {
          ...initial,
          bankName,
          name: name.trim(),
          type,
          balance: toNumber(balance),
          availableForSpending,
          savingsPurpose: availableForSpending ? undefined : savingsPurpose.trim() || undefined,
        },
      });
    } else {
      dispatch({
        type: "ADD_ACCOUNT",
        payload: {
          bankName,
          name: name.trim(),
          type,
          balance: toNumber(balance),
          availableForSpending,
          savingsPurpose: availableForSpending ? undefined : savingsPurpose.trim() || undefined,
        },
      });
    }
    toast("Saved");
    onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? "Edit account" : "Add account"}
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
      <div className="grid gap-3">
        <Field label="Bank / wallet name">
          <Input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Chase, Cash App, etc."
          />
        </Field>
        <Field label="Account nickname">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Primary checking"
          />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Current balance">
          <Input
            type="number"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </Field>
        <div className="rounded-2xl border border-border bg-muted/40 p-3">
          <button
            type="button"
            onClick={() => setAvailableForSpending((v) => !v)}
            className="flex w-full items-start gap-3 text-left"
          >
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs font-black ${
                availableForSpending
                  ? "border-primary brand-gradient text-primary-foreground"
                  : "border-border bg-[color:var(--card-solid)]"
              }`}
            >
              {availableForSpending ? "✓" : ""}
            </span>
            <span>
              <span className="block text-sm font-extrabold">Available for spending</span>
              <span className="block text-xs text-muted-foreground">
                Include this account in safe-to-spend, forecasts, and expense payment options.
              </span>
            </span>
          </button>
        </div>
        {!availableForSpending && (
          <Field label="Reserved purpose">
            <Input
              value={savingsPurpose}
              onChange={(e) => setSavingsPurpose(e.target.value)}
              placeholder="Tax savings, emergency fund, rent reserve"
            />
          </Field>
        )}
      </div>
    </Sheet>
  );
}

export function CardSheet({ onClose, initial }: { onClose: () => void; initial?: CardT }) {
  const { dispatch } = useApp();
  const [c, setC] = useState<Omit<CardT, "id">>(
    initial ?? {
      name: "",
      type: "regular",
      limit: 0,
      currentBalance: 0,
      statementBalance: 0,
      minimumDue: 0,
      billingDate: 1,
      dueDate: 15,
      apr: 22,
      targetUtilizationPercent: 30,
      preferredCategories: [],
    },
  );
  function up<K extends keyof Omit<CardT, "id">>(k: K, v: Omit<CardT, "id">[K]) {
    setC((p) => ({ ...p, [k]: v }));
  }
  function save() {
    if (!c.name.trim()) return toast("Name the card");
    if (initial) dispatch({ type: "UPDATE_CARD", payload: { ...initial, ...c } });
    else dispatch({ type: "ADD_CARD", payload: c });
    toast("Saved");
    onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? "Edit card" : "Add card"}
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
          <Input value={c.name} onChange={(e) => up("name", e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={c.type} onChange={(e) => up("type", e.target.value as CardType)}>
            <option value="regular">Regular</option>
            <option value="zero_apr">0% APR</option>
            <option value="zero_apr_car">0% APR car</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Credit limit">
          <Input
            type="number"
            value={c.limit}
            onChange={(e) => up("limit", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Current balance">
          <Input
            type="number"
            value={c.currentBalance}
            onChange={(e) => up("currentBalance", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Statement balance">
          <Input
            type="number"
            value={c.statementBalance}
            onChange={(e) => up("statementBalance", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Minimum due">
          <Input
            type="number"
            value={c.minimumDue}
            onChange={(e) => up("minimumDue", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Billing day (1–31)">
          <Input
            type="number"
            min={1}
            max={31}
            value={c.billingDate}
            onChange={(e) => up("billingDate", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Due day (1–31)">
          <Input
            type="number"
            min={1}
            max={31}
            value={c.dueDate}
            onChange={(e) => up("dueDate", toNumber(e.target.value))}
          />
        </Field>
        <Field label="APR %">
          <Input
            type="number"
            value={c.apr}
            onChange={(e) => up("apr", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Target utilization %">
          <Input
            type="number"
            value={c.targetUtilizationPercent}
            onChange={(e) => up("targetUtilizationPercent", toNumber(e.target.value))}
          />
        </Field>
        <Field label="0% APR end (optional)">
          <Input
            type="date"
            value={c.zeroAprEndDate ?? ""}
            onChange={(e) => up("zeroAprEndDate", e.target.value || undefined)}
          />
        </Field>
        <Field label="Preferred categories (comma)">
          <Input
            value={c.preferredCategories.join(", ")}
            onChange={(e) =>
              up(
                "preferredCategories",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
      </div>
    </Sheet>
  );
}

function normalizedScheduledWeekdays(days: number[] | undefined): number[] {
  return Array.from(new Set((days ?? []).filter((day) => day >= 0 && day <= 6))).sort(
    (a, b) => a - b,
  );
}

function jobScheduleSummary(
  job: Pick<Job, "scheduledWeekdays" | "scheduledHoursPerShift">,
): string {
  const days = normalizedScheduledWeekdays(job.scheduledWeekdays);
  const hours = job.scheduledHoursPerShift ?? 0;
  if (days.length === 0 || hours <= 0) return "";
  return `${days.map((day) => WEEKDAY_SHORT[day]).join(", ")} - ${hours}h/shift`;
}

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function JobSheet({ onClose, initial }: { onClose: () => void; initial?: Job }) {
  const { state, dispatch } = useApp();
  const [j, setJ] = useState<Omit<Job, "id">>(
    initial ?? {
      name: "",
      type: "part_time",
      netHourlyRate: 0,
      netPaycheckAmount: 0,
      payFrequency: "weekly",
      paydayWeekday: 5,
      scheduledWeekdays: [],
      scheduledHoursPerShift: 0,
      defaultDepositAccountId: state.accounts[0]?.id ?? "",
    },
  );
  function up<K extends keyof Omit<Job, "id">>(k: K, v: Omit<Job, "id">[K]) {
    setJ((p) => ({ ...p, [k]: v }));
  }
  function save() {
    if (!j.name.trim()) return toast("Name the job");
    const payload: Omit<Job, "id"> = {
      ...j,
      scheduledWeekdays:
        j.type === "part_time" ? normalizedScheduledWeekdays(j.scheduledWeekdays) : undefined,
      scheduledHoursPerShift:
        j.type === "part_time" ? Math.max(0, j.scheduledHoursPerShift ?? 0) : undefined,
    };
    if (initial) dispatch({ type: "UPDATE_JOB", payload: { ...initial, ...payload } });
    else dispatch({ type: "ADD_JOB", payload });
    toast("Saved");
    onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? "Edit job" : "Add job"}
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
          <Input value={j.name} onChange={(e) => up("name", e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={j.type} onChange={(e) => up("type", e.target.value as Job["type"])}>
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>
        <Field label="Net hourly rate">
          <Input
            type="number"
            value={j.netHourlyRate}
            onChange={(e) => up("netHourlyRate", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Net paycheck amount">
          <Input
            type="number"
            value={j.netPaycheckAmount}
            onChange={(e) => up("netPaycheckAmount", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Pay frequency">
          <Select
            value={j.payFrequency}
            onChange={(e) => up("payFrequency", e.target.value as PayFrequency)}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="semimonthly">Semimonthly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label="Payday (weekday 0=Sun..6=Sat)">
          <Input
            type="number"
            min={0}
            max={6}
            value={j.paydayWeekday}
            onChange={(e) => up("paydayWeekday", toNumber(e.target.value))}
          />
        </Field>
        {j.payFrequency === "biweekly" && (
          <Field
            label="Known payday (anchor)"
            hint="Use one real payday so biweekly forecasts land on the right weeks."
          >
            <Input
              type="date"
              value={j.biweeklyAnchorDate ?? ""}
              onChange={(e) => up("biweeklyAnchorDate", e.target.value)}
            />
          </Field>
        )}
        {j.type === "part_time" && (
          <>
            <Field label="Work days">
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_SHORT.map((day, index) => {
                  const active = (j.scheduledWeekdays ?? []).includes(index);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        const current = j.scheduledWeekdays ?? [];
                        up(
                          "scheduledWeekdays",
                          active
                            ? current.filter((selected) => selected !== index)
                            : normalizedScheduledWeekdays([...current, index]),
                        );
                      }}
                      className={`h-10 rounded-xl border px-3 text-sm font-extrabold transition ${
                        active
                          ? "border-primary bg-primary/20 text-foreground"
                          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                      }`}
                      aria-pressed={active}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Hours per shift">
              <Input
                type="number"
                min={0}
                step="0.25"
                value={j.scheduledHoursPerShift ?? ""}
                onChange={(e) => up("scheduledHoursPerShift", toNumber(e.target.value))}
              />
            </Field>
          </>
        )}
        <Field label="Default deposit account">
          <Select
            value={j.defaultDepositAccountId}
            onChange={(e) => up("defaultDepositAccountId", e.target.value)}
          >
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

export function DebtSheet({ onClose, initial }: { onClose: () => void; initial?: Debt }) {
  const { state, dispatch } = useApp();
  const [d, setD] = useState<Omit<Debt, "id">>(
    initial ?? {
      name: "",
      balance: 0,
      minimumPayment: 0,
      dueDate: 1,
      status: "active",
      payoffMode: "minimum",
    },
  );
  function up<K extends keyof Omit<Debt, "id">>(k: K, v: Omit<Debt, "id">[K]) {
    setD((p) => ({ ...p, [k]: v }));
  }
  function save() {
    if (!d.name.trim()) return toast("Name it");
    if (initial) dispatch({ type: "UPDATE_DEBT", payload: { ...initial, ...d } });
    else dispatch({ type: "ADD_DEBT", payload: d });
    toast("Saved");
    onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? "Edit debt" : "Add debt"}
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
          <Input value={d.name} onChange={(e) => up("name", e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={(e) => up("status", e.target.value as Debt["status"])}>
            <option value="active">Active</option>
            <option value="not_started">Not started</option>
            <option value="paused">Paused</option>
            <option value="paid_off">Paid off</option>
          </Select>
        </Field>
        <Field label="Balance">
          <Input
            type="number"
            value={d.balance}
            onChange={(e) => up("balance", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Minimum payment">
          <Input
            type="number"
            value={d.minimumPayment}
            onChange={(e) => up("minimumPayment", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Payoff plan">
          <Select
            value={d.payoffMode ?? "minimum"}
            onChange={(e) => up("payoffMode", e.target.value as DebtPayoffMode)}
          >
            <option value="minimum">Minimum only</option>
            <option value="date">Pay off by date</option>
            <option value="payments">Pay off in payments</option>
            <option value="custom">Custom monthly amount</option>
          </Select>
        </Field>
        {d.payoffMode === "date" && (
          <Field label="Target payoff date">
            <Input
              type="date"
              value={d.payoffTargetDate ?? ""}
              onChange={(e) => up("payoffTargetDate", e.target.value || undefined)}
            />
          </Field>
        )}
        {d.payoffMode === "payments" && (
          <Field label="Number of payments">
            <Input
              type="number"
              min={1}
              value={d.payoffPaymentCount ?? ""}
              onChange={(e) => up("payoffPaymentCount", toNumber(e.target.value) || undefined)}
            />
          </Field>
        )}
        {d.payoffMode === "custom" && (
          <Field label="Planned monthly payment">
            <Input
              type="number"
              value={d.plannedMonthlyPayment ?? ""}
              onChange={(e) => up("plannedMonthlyPayment", toNumber(e.target.value) || undefined)}
            />
          </Field>
        )}
        <div className="rounded-2xl border border-border bg-muted/40 p-3 text-sm sm:col-span-2">
          Monthly debt plan:{" "}
          <span className="font-extrabold">
            {formatMoney(plannedDebtPayment(d), state.profile.currency)}
          </span>
          <span className="text-muted-foreground">
            . Forecast uses this amount unless the debt is inactive or paid off.
          </span>
        </div>
        <Field label="Due day (1–31)">
          <Input
            type="number"
            value={d.dueDate}
            onChange={(e) => up("dueDate", toNumber(e.target.value))}
          />
        </Field>
        {(d.status === "not_started" || d.status === "paused") && (
          <Field
            label="Start date"
            hint="When this debt begins. Forecast ignores it until this date."
          >
            <Input
              type="date"
              value={d.startDate ?? ""}
              onChange={(e) => up("startDate", e.target.value || undefined)}
            />
          </Field>
        )}
        <Field label="End date (optional)" hint="After this date the debt drops off the forecast.">
          <Input
            type="date"
            value={d.endDate ?? ""}
            onChange={(e) => up("endDate", e.target.value || undefined)}
          />
        </Field>
      </div>
    </Sheet>
  );
}


export function RecurringSheet({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: RecurringBill;
}) {
  const { state, dispatch } = useApp();
  const [b, setB] = useState<Omit<RecurringBill, "id">>(
    initial ?? {
      name: "",
      amount: 0,
      dueDay: 1,
      dueRule: "day_of_month",
      dueWeek: 1,
      dueWeekday: 4,
      paymentMethod: "account",
      accountId: state.accounts[0]?.id ?? "",
      cardId: state.cards[0]?.id,
      active: true,
    },
  );
  function up<K extends keyof Omit<RecurringBill, "id">>(k: K, v: Omit<RecurringBill, "id">[K]) {
    setB((p) => ({ ...p, [k]: v }));
  }
  function save() {
    if (!b.name.trim()) return toast("Name it");
    const paymentMethod = b.paymentMethod ?? (b.cardId ? "card" : "account");
    if (paymentMethod === "account" && !b.accountId) return toast("Choose an account");
    if (paymentMethod === "card" && !b.cardId) return toast("Choose a card");
    const payload: Omit<RecurringBill, "id"> = {
      ...b,
      paymentMethod,
      accountId: paymentMethod === "account" ? b.accountId : "",
      cardId: paymentMethod === "card" ? b.cardId : undefined,
      dueRule: b.dueRule ?? "day_of_month",
      dueDay: Math.min(Math.max(1, b.dueDay || 1), 31),
      dueWeek:
        (b.dueRule ?? "day_of_month") === "weekday_of_month"
          ? Math.min(Math.max(1, b.dueWeek ?? 1), 5)
          : undefined,
      dueWeekday:
        (b.dueRule ?? "day_of_month") === "weekday_of_month"
          ? Math.min(Math.max(0, b.dueWeekday ?? 0), 6)
          : undefined,
    };
    if (initial) dispatch({ type: "UPDATE_RECURRING", payload: { ...initial, ...payload } });
    else dispatch({ type: "ADD_RECURRING", payload });
    toast("Saved");
    onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? "Edit bill" : "Add recurring bill"}
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
          <Input value={b.name} onChange={(e) => up("name", e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input
            type="number"
            value={b.amount}
            onChange={(e) => up("amount", toNumber(e.target.value))}
          />
        </Field>
        <Field label="Due schedule">
          <Select
            value={b.dueRule ?? "day_of_month"}
            onChange={(e) => up("dueRule", e.target.value as NonNullable<RecurringBill["dueRule"]>)}
          >
            <option value="day_of_month">Date of month</option>
            <option value="weekday_of_month">Weekday of month</option>
          </Select>
        </Field>
        {(b.dueRule ?? "day_of_month") === "day_of_month" ? (
          <Field label="Due day">
            <Input
              type="number"
              min={1}
              max={31}
              value={b.dueDay}
              onChange={(e) => up("dueDay", toNumber(e.target.value))}
            />
          </Field>
        ) : (
          <>
            <Field label="Week of month">
              <Select
                value={b.dueWeek ?? 1}
                onChange={(e) => up("dueWeek", toNumber(e.target.value))}
              >
                <option value={1}>Week 1</option>
                <option value={2}>Week 2</option>
                <option value={3}>Week 3</option>
                <option value={4}>Week 4</option>
                <option value={5}>Last matching week</option>
              </Select>
            </Field>
            <Field label="Day of week">
              <Select
                value={b.dueWeekday ?? 4}
                onChange={(e) => up("dueWeekday", toNumber(e.target.value))}
              >
                {WEEKDAY_LONG.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label="Paid with">
          <Select
            value={b.paymentMethod ?? (b.cardId ? "card" : "account")}
            onChange={(e) => up("paymentMethod", e.target.value as "account" | "card")}
          >
            <option value="account">Account</option>
            <option value="card">Credit card</option>
          </Select>
        </Field>
        {(b.paymentMethod ?? (b.cardId ? "card" : "account")) === "account" ? (
          <Field label="Account">
            <Select value={b.accountId} onChange={(e) => up("accountId", e.target.value)}>
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Credit card">
            <Select value={b.cardId ?? ""} onChange={(e) => up("cardId", e.target.value)}>
              <option value="">Pick a card...</option>
              {state.cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Sheet>
  );
}
