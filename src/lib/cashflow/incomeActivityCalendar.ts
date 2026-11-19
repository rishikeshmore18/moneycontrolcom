import type { AppState, TimesheetEntry, Transaction } from "./types";
import { timesheetEntryAmount } from "./timesheetLogic";

/** The salary calendar is job-specific, not a list of all money received.
 * Bank receipts enter it only after explicit job matching or a linked paycheck.
 * An Activity assignment changes the label, never the posted amount or date. */
export function receivedIncomeForMonth(
  state: Pick<AppState, "transactions" | "jobs" | "timesheet">,
  monthDate: Date,
): Transaction[] {
  const month = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
  const jobIds = new Set(state.jobs.map((job) => job.id));
  const paidByTransaction = new Set(
    state.timesheet.filter((entry) => entry.paid && entry.linkedTransactionId &&
      jobIds.has(entry.jobId)).map((entry) => entry.linkedTransactionId!),
  );
  return state.transactions.filter((tx) =>
    tx.type === "income" && Number.isFinite(tx.amount) && tx.amount > 0 &&
    !tx.salaryCalendarExcluded &&
    tx.date.slice(0, 7) === month &&
    ((!!tx.incomeJobId && jobIds.has(tx.incomeJobId)) ||
      paidByTransaction.has(tx.id) ||
      [tx.linkedPlannedIncome, ...(tx.linkedPlannedIncomes ?? [])].some((link) =>
        link?.originalEntries?.some((entry) => jobIds.has(entry.jobId)))
    )
  );
}

/** Count a bank receipt once, even when an already-paid timesheet entry links to it. */
export function incomeCalendarPaidTotal(
  state: Pick<AppState, "transactions" | "jobs" | "timesheet">,
  monthDate: Date,
  entries: TimesheetEntry[],
): number {
  const received = receivedIncomeForMonth(state, monthDate);
  // Also exclude paid entries whose linked deposit is dated in a different month.
  const ids = new Set(state.transactions.filter((tx) => tx.type === "income").map((tx) => tx.id));
  const cents = received.reduce((sum, tx) => sum + Math.round(tx.amount * 100), 0);
  const knownJobs = new Set(state.jobs.map((job) => job.id));
  const additional = entries
    .filter((entry) => entry.paid && knownJobs.has(entry.jobId) &&
      entry.entryType !== "time_off" &&
      (!entry.linkedTransactionId || !ids.has(entry.linkedTransactionId)))
    .reduce((sum, entry) => sum + Math.round(timesheetEntryAmount(entry) * 100), 0);
  return (cents + additional) / 100;
}
