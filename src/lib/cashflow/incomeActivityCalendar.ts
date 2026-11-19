import type { AppState, TimesheetEntry, Transaction } from "./types";
import { timesheetEntryAmount } from "./timesheetLogic";

/** Bank and manually recorded receipts are actual income, not payday predictions.
 * Read them from Activity, never create a second transaction for the calendar. */
export function receivedIncomeForMonth(
  state: Pick<AppState, "transactions">,
  monthDate: Date,
): Transaction[] {
  const month = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
  return state.transactions.filter((tx) =>
    tx.type === "income" && Number.isFinite(tx.amount) && tx.amount > 0 &&
    tx.date.slice(0, 7) === month,
  );
}

/** Count a bank receipt once, even when an already-paid timesheet entry links to it. */
export function incomeCalendarPaidTotal(
  state: Pick<AppState, "transactions">,
  monthDate: Date,
  entries: TimesheetEntry[],
): number {
  const received = receivedIncomeForMonth(state, monthDate);
  const ids = new Set(received.map((tx) => tx.id));
  const cents = received.reduce((sum, tx) => sum + Math.round(tx.amount * 100), 0);
  const additional = entries
    .filter((entry) => entry.paid && entry.entryType !== "time_off" &&
      (!entry.linkedTransactionId || !ids.has(entry.linkedTransactionId)))
    .reduce((sum, entry) => sum + Math.round(timesheetEntryAmount(entry) * 100), 0);
  return (cents + additional) / 100;
}
