import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Card } from "./Card";
import { Sheet } from "./Sheet";
import { Field, Input, Select } from "./Field";
import { Button } from "./Button";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney, toNumber } from "@/lib/cashflow/money";
import {
  MONTH_NAMES,
  WEEKDAY_SHORT,
  addMonths,
  formatDisplayDate,
  hoursBetween,
  monthDays,
  newId,
  todayISO,
} from "@/lib/cashflow/dates";
import {
  makeShiftEntry,
  makeTimeOffEntry,
  timesheetEntryAmount,
  visibleIncomeEntriesForMonth,
} from "@/lib/cashflow/timesheetLogic";
import { payDateForTimesheetEntry, paydayItemsOnDate } from "@/lib/cashflow/forecast";
import { receivedIncomeForMonth, incomeCalendarPaidTotal } from "@/lib/cashflow/incomeActivityCalendar";
import type { TimesheetEntry, Transaction } from "@/lib/cashflow/types";
import { toast } from "./Toast";

export function IncomeTimesheet() {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [monthDate, setMonthDate] = useState(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState<string>(todayISO());
  const [editEntry, setEditEntry] = useState<TimesheetEntry | null>(null);
  const [salaryDate, setSalaryDate] = useState<string | null>(null);

  const entries = useMemo(
    () => visibleIncomeEntriesForMonth(state.timesheet, state.jobs, monthDate, todayISO()),
    [state.timesheet, state.jobs, monthDate],
  );

  const deposits = useMemo(
    () => receivedIncomeForMonth(state, monthDate),
    [state.transactions, state.jobs, state.timesheet, monthDate],
  );
  const receivedByDate = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    deposits.forEach((tx) => {
      const existing = map.get(tx.date) ?? [];
      existing.push(tx);
      map.set(tx.date, existing);
    });
    return map;
  }, [deposits]);

  const byDate = useMemo(() => {
    const map = new Map<string, TimesheetEntry[]>();
    entries.forEach((e) => {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    });
    return map;
  }, [entries]);

  const totals = useMemo(() => {
    let hours = 0;
    let pending = 0;
    entries.forEach((entry) => {
      if (entry.entryType !== "time_off") hours += entry.hours;
      if (!entry.paid) pending += timesheetEntryAmount(entry);
    });
    return {
      hours,
      paid: incomeCalendarPaidTotal(state, monthDate, entries),
      pending,
    };
  }, [entries, state.transactions, state.jobs, state.timesheet, monthDate]);

  const days = useMemo(() => monthDays(monthDate), [monthDate]);
  const dayEntries = selectedDate ? (byDate.get(selectedDate) ?? []) : [];
  const dayDeposits = selectedDate ? (receivedByDate.get(selectedDate) ?? []) : [];

  function persistAndSave(entry: TimesheetEntry) {
    dispatch({ type: "UPSERT_TIMESHEET", payload: entry });
  }

  return (
    <div className="grid min-w-0 gap-5 max-w-[1000px] mx-auto w-full">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Timesheet</h1>
          <p className="text-sm text-muted-foreground">
            Only salary from your jobs appears here. Match off-schedule pay without adding money again.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" onClick={() => setSalaryDate(todayISO())}>
            Assign salary
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setAddDate(todayISO());
              setAddOpen(true);
            }}
          >
            <Plus size={16} /> Add entry
          </Button>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3">
        <Stat label="This month hours" value={`${totals.hours.toFixed(1)}h`} />
        <Stat label="Income received" value={formatMoney(totals.paid, cur)} tone="good" />
        <Stat label="Pending income" value={formatMoney(totals.pending, cur)} tone="warn" />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setMonthDate((d) => addMonths(d, -1))}
            className="grid place-items-center h-10 w-10 rounded-xl hover:bg-muted"
            aria-label="Previous month"
          >
            <ChevronLeft />
          </button>
          <h3 className="text-xl font-extrabold tracking-tight">
            {MONTH_NAMES[monthDate.getMonth()]} {monthDate.getFullYear()}
          </h3>
          <button
            onClick={() => setMonthDate((d) => addMonths(d, 1))}
            className="grid place-items-center h-10 w-10 rounded-xl hover:bg-muted"
            aria-label="Next month"
          >
            <ChevronRight />
          </button>
        </div>

        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 mb-1.5 sm:gap-1.5">
          {WEEKDAY_SHORT.map((w) => (
            <div key={w} className="text-center text-xs font-extrabold text-muted-foreground py-1">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5">
          {days.map((d) => {
            const list = byDate.get(d.iso) ?? [];
            const dayReceived = receivedByDate.get(d.iso) ?? [];
            const shownEntries = list.slice(0, dayReceived.length ? 1 : 2);
            const shownDeposits = dayReceived.slice(0, Math.max(0, 2 - shownEntries.length));
            const hasPaid = list.some((e) => e.paid) || dayReceived.length > 0;
            const hasUnpaid = list.some((e) => !e.paid && e.entryType !== "time_off");
            const cls = !d.inMonth
              ? "opacity-30 pointer-events-none"
              : hasUnpaid
                ? "border-[color:var(--warn)]/40 bg-[color:var(--warn)]/10"
                : hasPaid
                  ? "border-[color:var(--good)]/40 bg-[color:var(--good)]/10"
                  : "border-border hover:bg-muted/60";
            return (
              <button
                key={d.iso}
                onClick={() => setSelectedDate(d.iso)}
                className={`min-w-0 min-h-[52px] rounded-xl border p-1 text-left transition hover:-translate-y-0.5 sm:min-h-[78px] sm:rounded-2xl sm:p-2 ${cls}`}
              >
                <div className="font-extrabold text-sm">{d.date.getDate()}</div>
                {shownEntries.map((e) => (
                  <div
                    key={e.id}
                    className={`mt-1 truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      e.entryType === "time_off"
                        ? "bg-[color:var(--bad)]/15 text-[color:var(--bad)]"
                        : e.paid
                          ? "bg-[color:var(--good)]/15 text-[color:var(--good)]"
                          : "bg-primary/15 text-foreground"
                    }`}
                  >
                    {e.entryType === "salary_paycheck"
                      ? "💼 "
                      : e.entryType === "time_off"
                        ? "🌴 "
                        : ""}
                    {e.jobName}
                  </div>
                ))}
                {shownDeposits.map((tx) => (
                  <div
                    key={tx.id}
                    className="mt-1 truncate rounded-md bg-[color:var(--good)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[color:var(--good)]"
                    title={`${tx.description} · ${formatMoney(tx.amount, cur)}`}
                  >
                    Received {formatMoney(tx.amount, cur)}
                  </div>
                ))}
                {list.length + dayReceived.length > shownEntries.length + shownDeposits.length && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    +{list.length + dayReceived.length - shownEntries.length - shownDeposits.length} more
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <DayDetailSheet
        open={!!selectedDate}
        date={selectedDate}
        entries={dayEntries}
        deposits={dayDeposits}
        onClose={() => setSelectedDate(null)}
        onAssignSalary={(date) => {
          setSelectedDate(null);
          setSalaryDate(date);
        }}
        onAdd={(date) => {
          setSelectedDate(null);
          setAddDate(date);
          setEditEntry(null);
          setAddOpen(true);
        }}
        onEdit={(entry) => {
          setSelectedDate(null);
          setAddDate(entry.date);
          setEditEntry(entry);
          setAddOpen(true);
        }}
      />

      <SalaryMatchSheet
        key={salaryDate ?? "closed"}
        initialDate={salaryDate}
        onClose={() => setSalaryDate(null)}
      />

      <AddEntrySheet
        key={editEntry ? `edit-${editEntry.id}` : `add-${addDate}`}
        open={addOpen}
        date={addDate}
        entry={editEntry}
        onClose={() => {
          setAddOpen(false);
          setEditEntry(null);
        }}
        onSave={(entry) => {
          persistAndSave(entry);
          toast(editEntry ? "Entry updated" : "Entry saved");
          setAddOpen(false);
          setEditEntry(null);
        }}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const t =
    tone === "good"
      ? "border-[color:var(--good)]/30 bg-[color:var(--good)]/8"
      : tone === "warn"
        ? "border-[color:var(--warn)]/30 bg-[color:var(--warn)]/8"
        : "";
  return (
    <Card className={`!p-4 ${t}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1.5 break-words text-2xl font-black">{value}</div>
    </Card>
  );
}

/* ----- Day Detail ----- */
function DayDetailSheet({
  open,
  date,
  entries,
  deposits,
  onClose,
  onAdd,
  onEdit,
  onAssignSalary,
}: {
  open: boolean;
  date: string | null;
  entries: TimesheetEntry[];
  deposits: Transaction[];
  onClose: () => void;
  onAdd: (d: string) => void;
  onEdit: (e: TimesheetEntry) => void;
  onAssignSalary: (d: string) => void;
}) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [payOpen, setPayOpen] = useState<TimesheetEntry | null>(null);

  if (!date) return null;
  const plannedTotal = entries.reduce((sum, entry) => sum + timesheetEntryAmount(entry), 0);
  const receivedTotal = deposits.reduce((sum, tx) => sum + Math.round(tx.amount * 100), 0) / 100;
  const hours = entries.filter((entry) => entry.entryType !== "time_off").reduce((sum, entry) => sum + entry.hours, 0);

  return (
    <>
      <Sheet open={open} onClose={onClose} title={formatDisplayDate(date)}>
        <div className="grid gap-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <div className="rounded-2xl border border-border bg-muted/50 p-3.5">
              <div className="text-xs text-muted-foreground font-bold uppercase">Hours</div>
              <div className="text-2xl font-black mt-1">{hours.toFixed(1)}h</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/50 p-3.5">
              <div className="text-xs text-muted-foreground font-bold uppercase">
                {deposits.length ? "Salary received" : "Planned earnings"}
              </div>
              <div className="mt-1 break-words text-2xl font-black">
                {formatMoney(deposits.length ? receivedTotal : plannedTotal, cur)}
              </div>
            </div>
          </div>

          <Button variant="primary" full onClick={() => onAssignSalary(date)}>
            Assign salary received on this date
          </Button>
          <Button variant="soft" full onClick={() => onAdd(date)}>
            <Plus size={16} /> Add shift or time off
          </Button>

          {deposits.length > 0 && (
            <div className="grid gap-2" aria-label="Received income from Activity">
              <div className="text-sm font-extrabold">Salary received · Activity</div>
              {deposits.map((tx) => {
                const jobName = state.jobs.find((job) => job.id === tx.incomeJobId)?.name;
                return (
                  <div key={tx.id} className="flex min-w-0 items-start justify-between gap-3 rounded-xl border border-[color:var(--good)]/30 bg-[color:var(--good)]/8 p-3">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-extrabold">{jobName ?? tx.description}</div>
                      <div className="break-words text-xs text-muted-foreground">
                        {jobName ? `Matched to ${jobName} · ${tx.description}` : "Bank income · Not matched to a job"}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-black text-[color:var(--good)]">
                      +{formatMoney(tx.amount, cur)}
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground">
                You can change its job in Assign salary without editing your bank balance.
              </p>
            </div>
          )}
          <div className="grid gap-2.5">
            {entries.map((e) => {
              const amt = timesheetEntryAmount(e);
              const labelType =
                e.entryType === "salary_paycheck"
                  ? "Salary paycheck"
                  : e.entryType === "time_off"
                    ? "Time off"
                    : "Shift";
              return (
                <div
                  key={e.id}
                  className={`flex items-center gap-3 rounded-2xl border p-3 ${
                    e.paid
                      ? "border-[color:var(--good)]/30 bg-[color:var(--good)]/8"
                      : e.entryType === "time_off"
                        ? "border-[color:var(--bad)]/30 bg-[color:var(--bad)]/8"
                        : "border-border bg-muted/50"
                  }`}
                >
                  <div
                    className={`h-7 w-7 grid place-items-center rounded-full text-xs font-black ${
                      e.paid
                        ? "bg-[color:var(--good)] text-white"
                        : "border-2 border-muted-foreground text-muted-foreground"
                    }`}
                  >
                    {e.paid ? "✓" : ""}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-extrabold truncate">{e.jobName}</div>
                    <div className="text-xs text-muted-foreground">
                      {labelType} ·{" "}
                      {e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : `${e.hours}h`}{" "}
                      {e.rate > 0 && `· ${formatMoney(e.rate, cur)}/h`}
                    </div>
                    {!e.paid &&
                      e.entryType === "work_shift" &&
                      payDateForTimesheetEntry(state, e) !== e.date && (
                        <div className="text-[11px] font-bold text-muted-foreground">
                          Pays out {formatDisplayDate(payDateForTimesheetEntry(state, e))}
                        </div>
                      )}
                  </div>

                  <div className="text-right">
                    <div className="font-black">{formatMoney(amt, cur)}</div>
                    {e.entryType !== "time_off" && (
                      <button
                        onClick={() => {
                          if (e.paid) {
                            if (e.auto) return;
                            if (state.transactions.some((tx) => tx.id === e.linkedTransactionId && tx.balanceAlreadySynced)) {
                              toast("This payday is linked to Activity. Edit or delete that income there to undo the match.");
                              return;
                            }
                            dispatch({ type: "UNMARK_TIMESHEET_PAID", payload: { id: e.id } });
                            toast("Unmarked paid");
                          } else {
                            setPayOpen(e);
                          }
                        }}
                        className="text-xs font-bold text-primary mt-0.5 hover:underline"
                      >
                        {e.paid ? "Unmark" : "Mark paid"}
                      </button>
                    )}
                  </div>
                  <div className="grid gap-1">
                    {e.entryType !== "salary_paycheck" && (
                      <button
                        onClick={() => onEdit(e)}
                        className="text-muted-foreground p-1.5 rounded-lg hover:bg-muted hover:text-foreground"
                        aria-label="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    {!e.auto && (
                      <button
                        onClick={() => {
                          if (confirm("Delete this entry?")) {
                            dispatch({ type: "DELETE_TIMESHEET", id: e.id });
                            toast("Entry deleted");
                          }
                        }}
                        className="text-[color:var(--bad)] p-1.5 rounded-lg hover:bg-[color:var(--bad)]/10"
                        aria-label="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Sheet>

      <MarkPaidSheet entry={payOpen} onClose={() => setPayOpen(null)} />
    </>
  );
}

/* ----- Match an existing receipt to a job on its real deposit date ----- */
function SalaryMatchSheet({
  initialDate,
  onClose,
}: {
  initialDate: string | null;
  onClose: () => void;
}) {
  const { state, dispatch } = useApp();
  const [date, setDate] = useState(initialDate ?? todayISO());
  const [depositId, setDepositId] = useState("");
  const [jobId, setJobId] = useState("");
  if (!initialDate) return null;

  const deposits = state.transactions
    .filter((tx) => tx.type === "income" && Number.isFinite(tx.amount) &&
      tx.amount > 0 && tx.date === date)
    .sort((a, b) => a.description.localeCompare(b.description));
  const chosen = deposits.find((tx) => tx.id === depositId);
  const selectedJob = state.jobs.find((job) => job.id === jobId);
  function save() {
    if (!chosen) return toast("Choose the existing deposit first.");
    if (!selectedJob) return toast("Choose the job that paid you.");
    dispatch({ type: "SET_INCOME_JOB", id: chosen.id, jobId: selectedJob.id });
    toast("Salary linked to this job on its recorded deposit date. Bank balance unchanged.");
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title="Assign salary to a date"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!chosen || !selectedJob} onClick={save}>
            Assign salary
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Choose a received deposit and the full-time or part-time job that paid it.
          Only assigned salary appears on the calendar. Other deposits stay in Activity.
        </p>
        <Field label="Actual deposit date">
          <Input type="date" value={date}
            onChange={(event) => { setDate(event.target.value); setDepositId(""); }} />
        </Field>
        <Field label="Deposit from Activity">
          <Select value={depositId} onChange={(event) => {
            const id = event.target.value;
            setDepositId(id);
            setJobId(deposits.find((tx) => tx.id === id)?.incomeJobId ?? "");
          }}>
            <option value="">Choose deposit</option>
            {deposits.map((tx) => (
              <option key={tx.id} value={tx.id}>
                {tx.description} · {formatMoney(tx.amount, state.profile.currency)}
              </option>
            ))}
          </Select>
        </Field>
        {deposits.length === 0 && (
          <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">
            No recorded income on this date. Choose another deposit date or check Activity.
            Assigning salary does not create a new deposit.
          </p>
        )}
        <Field label="Which job paid you?">
          <Select value={jobId} onChange={(event) => setJobId(event.target.value)}>
            <option value="">Choose a job</option>
            {state.jobs.map((job) => (
              <option key={job.id} value={job.id}>{job.name}</option>
            ))}
          </Select>
        </Field>
        {state.jobs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Add your full-time or part-time job under Profile first.
          </p>
        )}
        {chosen && (
          <p className="text-xs text-muted-foreground">
            Salary will appear on {formatDisplayDate(chosen.date)}.
            The bank transaction date and account balance are not changed.
            To correct a wrong bank date, edit the transaction in Activity.
          </p>
        )}
      </div>
    </Sheet>
  );
}

/* ----- Mark Paid sheet ----- */
function MarkPaidSheet({ entry, onClose }: { entry: TimesheetEntry | null; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const job = state.jobs.find((j) => j.id === entry?.jobId);
  const defaultAcc = job?.defaultDepositAccountId ?? state.accounts[0]?.id ?? "";
  const [accId, setAccId] = useState(defaultAcc);
  const [amount, setAmount] = useState("");
  const [scope, setScope] = useState<"payday" | "single">("payday");

  const payDate = entry ? payDateForTimesheetEntry(state, entry) : "";
  // The paycheck this entry belongs to (same job, same payday) as the dashboard sees it.
  const paydayItem = useMemo(() => {
    if (!entry) return undefined;
    return paydayItemsOnDate(state, payDate).find(
      (item) => item.jobId === entry.jobId && (item.incomeEntryIds ?? []).includes(entry.id),
    );
  }, [entry, payDate, state]);

  const groupEntries = paydayItem?.incomeEntries ?? [];
  const siblings = groupEntries.filter((e) => e.id !== entry?.id);
  const hasGroup = siblings.length > 0;
  const effectiveScope = hasGroup ? scope : "single";

  const expected =
    effectiveScope === "payday" && paydayItem
      ? paydayItem.amount
      : (entry?.actualAmount ?? entry?.expectedAmount ?? 0);

  if (!entry) return null;

  function markEntryPaid(target: TimesheetEntry, allocated: number, accountId: string) {
    let id = target.id;
    if (target.auto) {
      const real: TimesheetEntry = { ...target, id: newId(), auto: false, userEdited: true };
      dispatch({ type: "UPSERT_TIMESHEET", payload: real });
      id = real.id;
    }
    dispatch({
      type: "MARK_TIMESHEET_PAID",
      payload: { id, paidAccountId: accountId, actualAmount: allocated, date: payDate },
    });
  }

  return (
    <Sheet
      open={!!entry}
      onClose={onClose}
      title="Mark pay received"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const amt = toNumber(amount) || expected;
              if (!accId) return toast("Choose an account");
              if (effectiveScope === "payday" && groupEntries.length > 0) {
                const total = groupEntries.reduce(
                  (s, e) => s + (e.actualAmount ?? e.expectedAmount),
                  0,
                );
                let allocatedSoFar = 0;
                groupEntries.forEach((e, index) => {
                  const share =
                    index === groupEntries.length - 1
                      ? Math.round((amt - allocatedSoFar) * 100) / 100
                      : Math.round(
                          amt *
                            (total > 0
                              ? (e.actualAmount ?? e.expectedAmount) / total
                              : 1 / groupEntries.length) *
                            100,
                        ) / 100;
                  allocatedSoFar += share;
                  markEntryPaid(e, share, accId);
                });
              } else {
                markEntryPaid(entry, amt, accId);
              }
              toast(`+${formatMoney(amt, cur)} deposited`);
              onClose();
            }}
          >
            Mark paid
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="rounded-2xl border border-border bg-muted/50 p-3.5">
          <div className="font-extrabold">{entry.jobName}</div>
          <div className="text-xs text-muted-foreground">
            {entry.entryType === "salary_paycheck" ? "Scheduled paycheck" : "Shift"} · paid out on{" "}
            {formatDisplayDate(payDate)} · expected {formatMoney(expected, cur)}
          </div>
        </div>

        {hasGroup && (
          <Field
            label="What are you marking received?"
            hint="Keeps this in sync with “Income coming” on the dashboard."
          >
            <div className="grid gap-2">
              {(
                [
                  [
                    "payday",
                    `Whole payday · ${groupEntries.length} entries · ${formatMoney(paydayItem?.amount ?? 0, cur)}`,
                  ],
                  ["single", "Only this entry"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setScope(id)}
                  className={`px-3 py-2.5 rounded-xl font-bold text-sm border text-left ${
                    effectiveScope === id
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field
          label="Actual amount received"
          hint={`Leave blank to use ${formatMoney(expected, cur)}`}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={amount}
            placeholder={expected.toString()}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Deposit into">
          <Select value={accId} onChange={(e) => setAccId(e.target.value)}>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName} {a.name} · {a.type} · {formatMoney(a.balance, cur)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}


/* ----- Add / Edit Entry sheet ----- */
function AddEntrySheet({
  open,
  date,
  entry,
  onClose,
  onSave,
}: {
  open: boolean;
  date: string;
  entry?: TimesheetEntry | null;
  onClose: () => void;
  onSave: (e: TimesheetEntry) => void;
}) {
  const { state } = useApp();
  const editing = entry ?? null;
  const [kind, setKind] = useState<"shift" | "time_off">(
    editing?.entryType === "time_off" ? "time_off" : "shift",
  );
  const partAndCustom = state.jobs.filter((j) => j.type !== "full_time");
  const fullTime = state.jobs.find((j) => j.type === "full_time");
  const jobOptions = kind === "time_off" ? state.jobs : partAndCustom;

  const [jobId, setJobId] = useState(editing?.jobId ?? jobOptions[0]?.id ?? "");
  const job = state.jobs.find((j) => j.id === jobId);

  const [useTimeRange, setUseTimeRange] = useState(
    editing ? Boolean(editing.startTime && editing.endTime) : true,
  );
  const [start, setStart] = useState(editing?.startTime ?? "09:00");
  const [end, setEnd] = useState(editing?.endTime ?? "17:00");
  const [hoursManual, setHoursManual] = useState(editing ? String(editing.hours) : "4");
  const [rate, setRate] = useState(editing ? String(editing.rate) : "");

  const computedHours =
    kind === "time_off"
      ? toNumber(hoursManual)
      : useTimeRange
        ? hoursBetween(start, end)
        : toNumber(hoursManual);
  const rateNum = toNumber(rate) || job?.netHourlyRate || fullTime?.netHourlyRate || 0;

  function submit() {
    if (!jobId) return toast("Pick a job");
    const j = state.jobs.find((x) => x.id === jobId)!;
    const base =
      kind === "shift"
        ? makeShiftEntry({
            jobId: j.id,
            jobName: j.name,
            date,
            hours: computedHours,
            rate: rateNum,
            startTime: useTimeRange ? start : undefined,
            endTime: useTimeRange ? end : undefined,
          })
        : makeTimeOffEntry({
            jobId: j.id,
            jobName: j.name,
            date,
            hours: computedHours,
            rate: rateNum,
          });

    if (!editing) return onSave(base);

    // Editing: keep identity + paid state. A projected (auto) entry becomes a
    // real one so the schedule stops generating it for this day.
    onSave({
      ...base,
      id: editing.auto ? newId() : editing.id,
      auto: false,
      userEdited: true,
      paid: editing.paid,
      payStatus: editing.payStatus,
      paidAccountId: editing.paidAccountId,
      actualAmount: editing.paid ? base.expectedAmount : undefined,
      createdAt: editing.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }


  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Add entry · ${date}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["shift", "Work shift"],
              ["time_off", "Time off"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setKind(id);
                const opts = id === "time_off" ? state.jobs : partAndCustom;
                setJobId(opts[0]?.id ?? "");
              }}
              className={`px-3 py-3 rounded-2xl font-bold text-sm border transition ${
                kind === id
                  ? "border-primary brand-gradient text-primary-foreground"
                  : "border-border bg-[color:var(--card-solid)] hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {jobOptions.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No jobs configured for this entry type. Add one in Profile.
          </div>
        ) : (
          <Field label="Job">
            <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              {jobOptions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name} ({j.type.replace("_", " ")})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {kind === "shift" && (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setUseTimeRange(true)}
                className={`flex-1 px-3 py-2.5 rounded-xl font-bold text-sm border ${
                  useTimeRange
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                Start–End time
              </button>
              <button
                type="button"
                onClick={() => setUseTimeRange(false)}
                className={`flex-1 px-3 py-2.5 rounded-xl font-bold text-sm border ${
                  !useTimeRange
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                Manual hours
              </button>
            </div>

            {useTimeRange ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start">
                  <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                </Field>
                <Field label="End">
                  <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                </Field>
              </div>
            ) : (
              <Field label="Hours">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={hoursManual}
                  onChange={(e) => setHoursManual(e.target.value)}
                />
              </Field>
            )}
          </>
        )}

        {kind === "time_off" && (
          <Field label="Hours off">
            <Input
              type="number"
              inputMode="decimal"
              step="0.5"
              value={hoursManual}
              onChange={(e) => setHoursManual(e.target.value)}
            />
          </Field>
        )}

        <Field
          label="Hourly rate"
          hint={`Default ${job?.netHourlyRate || fullTime?.netHourlyRate || 0}/h`}
        >
          <Input
            type="number"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={String(job?.netHourlyRate || fullTime?.netHourlyRate || "")}
          />
        </Field>

        <div className="rounded-2xl border border-border bg-muted/50 p-3.5 text-sm">
          <div>
            Hours: <b>{computedHours.toFixed(2)}</b>
          </div>
          <div>
            {kind === "time_off" ? "Income reduction" : "Estimated"}:{" "}
            <b>
              {formatMoney(
                (kind === "time_off" ? -1 : 1) * computedHours * rateNum,
                state.profile.currency,
              )}
            </b>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
