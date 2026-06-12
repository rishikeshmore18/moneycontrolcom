import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
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
  hoursBetween,
  monthDays,
  newId,
  todayISO,
} from "@/lib/cashflow/dates";
import { entriesForMonth, makeShiftEntry, makeTimeOffEntry } from "@/lib/cashflow/timesheetLogic";
import type { TimesheetEntry } from "@/lib/cashflow/types";
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

  const entries = useMemo(
    () => entriesForMonth(state.timesheet, state.jobs, monthDate),
    [state.timesheet, state.jobs, monthDate],
  );

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
    let hours = 0,
      paid = 0,
      pending = 0;
    entries.forEach((e) => {
      if (e.entryType !== "time_off") hours += e.hours;
      const amt = e.actualAmount ?? e.expectedAmount;
      if (e.entryType === "time_off") return;
      if (e.paid) paid += amt;
      else pending += amt;
    });
    return { hours, paid, pending };
  }, [entries]);

  const days = useMemo(() => monthDays(monthDate), [monthDate]);
  const dayEntries = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  function persistAndSave(entry: TimesheetEntry) {
    dispatch({ type: "UPSERT_TIMESHEET", payload: entry });
  }

  return (
    <div className="grid gap-5 max-w-[1000px] mx-auto w-full">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Timesheet</h1>
          <p className="text-sm text-muted-foreground">
            Tap a day to add a shift, time off, or mark paid.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setAddDate(todayISO());
            setAddOpen(true);
          }}
        >
          <Plus size={16} /> Add entry
        </Button>
      </header>

      <div className="grid gap-3 grid-cols-3">
        <Stat label="This month hours" value={`${totals.hours.toFixed(1)}h`} />
        <Stat label="Earnings paid" value={formatMoney(totals.paid, cur)} tone="good" />
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

        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {WEEKDAY_SHORT.map((w) => (
            <div key={w} className="text-center text-xs font-extrabold text-muted-foreground py-1">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d) => {
            const list = byDate.get(d.iso) ?? [];
            const hasPaid = list.some((e) => e.paid);
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
                onClick={() => {
                  if (list.length === 0) {
                    setAddDate(d.iso);
                    setAddOpen(true);
                  } else {
                    setSelectedDate(d.iso);
                  }
                }}
                className={`min-h-[78px] rounded-2xl border p-2 text-left transition hover:-translate-y-0.5 ${cls}`}
              >
                <div className="font-extrabold text-sm">{d.date.getDate()}</div>
                {list.slice(0, 2).map((e) => (
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
                {list.length > 2 && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    +{list.length - 2} more
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
        onClose={() => setSelectedDate(null)}
        onAdd={(date) => {
          setSelectedDate(null);
          setAddDate(date);
          setAddOpen(true);
        }}
      />

      <AddEntrySheet
        open={addOpen}
        date={addDate}
        onClose={() => setAddOpen(false)}
        onSave={(entry) => {
          persistAndSave(entry);
          toast("Entry saved");
          setAddOpen(false);
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
      <div className="mt-1.5 text-2xl font-black">{value}</div>
    </Card>
  );
}

/* ----- Day Detail ----- */
function DayDetailSheet({
  open,
  date,
  entries,
  onClose,
  onAdd,
}: {
  open: boolean;
  date: string | null;
  entries: TimesheetEntry[];
  onClose: () => void;
  onAdd: (d: string) => void;
}) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [payOpen, setPayOpen] = useState<TimesheetEntry | null>(null);

  if (!date) return null;
  const total = entries.reduce((s, e) => s + (e.actualAmount ?? e.expectedAmount), 0);
  const hours = entries.filter((e) => e.entryType !== "time_off").reduce((s, e) => s + e.hours, 0);

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={new Date(date).toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      >
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-muted/50 p-3.5">
              <div className="text-xs text-muted-foreground font-bold uppercase">Hours</div>
              <div className="text-2xl font-black mt-1">{hours.toFixed(1)}h</div>
            </div>
            <div className="rounded-2xl border border-border bg-muted/50 p-3.5">
              <div className="text-xs text-muted-foreground font-bold uppercase">Total</div>
              <div className="text-2xl font-black mt-1">{formatMoney(total, cur)}</div>
            </div>
          </div>

          <Button variant="primary" full onClick={() => onAdd(date)}>
            <Plus size={16} /> Add another entry on this day
          </Button>

          <div className="grid gap-2.5">
            {entries.map((e) => {
              const amt = e.actualAmount ?? e.expectedAmount;
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
                  </div>
                  <div className="text-right">
                    <div className="font-black">{formatMoney(amt, cur)}</div>
                    {e.entryType !== "time_off" && (
                      <button
                        onClick={() => {
                          if (e.paid) {
                            if (e.auto) return;
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
              );
            })}
          </div>
        </div>
      </Sheet>

      <MarkPaidSheet entry={payOpen} onClose={() => setPayOpen(null)} />
    </>
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

  // sync when entry changes
  const expected = entry?.expectedAmount ?? 0;

  if (!entry) return null;
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
              // upgrade synthetic auto entry to real one first
              let id = entry.id;
              if (entry.auto) {
                const real: TimesheetEntry = {
                  ...entry,
                  id: newId(),
                  auto: false,
                  userEdited: true,
                };
                dispatch({ type: "UPSERT_TIMESHEET", payload: real });
                id = real.id;
              }
              dispatch({
                type: "MARK_TIMESHEET_PAID",
                payload: { id, paidAccountId: accId, actualAmount: amt },
              });
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
            {entry.entryType === "salary_paycheck" ? "Scheduled paycheck" : "Shift"} · expected{" "}
            {formatMoney(expected, cur)}
          </div>
        </div>
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

/* ----- Add Entry sheet ----- */
function AddEntrySheet({
  open,
  date,
  onClose,
  onSave,
}: {
  open: boolean;
  date: string;
  onClose: () => void;
  onSave: (e: TimesheetEntry) => void;
}) {
  const { state } = useApp();
  const [kind, setKind] = useState<"shift" | "time_off">("shift");
  const partAndCustom = state.jobs.filter((j) => j.type !== "full_time");
  const fullTime = state.jobs.find((j) => j.type === "full_time");
  const jobOptions = kind === "time_off" ? state.jobs : partAndCustom;

  const [jobId, setJobId] = useState(jobOptions[0]?.id ?? "");
  const job = state.jobs.find((j) => j.id === jobId);

  const [useTimeRange, setUseTimeRange] = useState(true);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [hoursManual, setHoursManual] = useState("4");
  const [rate, setRate] = useState("");

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
    if (kind === "shift") {
      onSave(
        makeShiftEntry({
          jobId: j.id,
          jobName: j.name,
          date,
          hours: computedHours,
          rate: rateNum,
          startTime: useTimeRange ? start : undefined,
          endTime: useTimeRange ? end : undefined,
        }),
      );
    } else {
      onSave(
        makeTimeOffEntry({
          jobId: j.id,
          jobName: j.name,
          date,
          hours: computedHours,
          rate: rateNum,
        }),
      );
    }
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
            Estimated: <b>{formatMoney(computedHours * rateNum, state.profile.currency)}</b>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
