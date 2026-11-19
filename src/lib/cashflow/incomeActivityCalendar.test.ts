import { describe, expect, it } from "vitest";
import { incomeCalendarPaidTotal, receivedIncomeForMonth } from "./incomeActivityCalendar";
import { visibleIncomeEntriesForMonth } from "./timesheetLogic";
import { pendingIncome } from "./forecast";
import { reducer } from "./reducer";
import { emptyState, type AppState, type TimesheetEntry, type Transaction } from "./types";

const NOVEMBER = new Date(2026, 10, 1);
const TODAY = new Date(2026, 10, 19);
const deposit: Transaction = {
  id: "bank-nov-12", type: "income", amount: 1164.74,
  description: "DEPOSIT - DETAIL NOT YET AVAILABLE", category: "Income",
  targetAccountId: "mnt-saving", balanceAlreadySynced: true,
  date: "2026-11-12", createdAt: "2026-11-12", updatedAt: "2026-11-12",
};
function state(): AppState {
  return {
    ...emptyState,
    accounts: [{ id: "mnt-saving", name: "Mnt Saving", bankName: "Mnt",
      type: "savings", balance: 2200, bankLinked: true,
      createdAt: "2026-11-01", updatedAt: "2026-11-01" }],
    jobs: [{ id: "full", name: "Full-time", type: "full_time",
      netHourlyRate: 30.10, netPaycheckAmount: 1164.74,
      payFrequency: "biweekly", paydayWeekday: 4,
      biweeklyAnchorDate: "2026-11-05",
      defaultDepositAccountId: "mnt-saving" }],
    transactions: [deposit],
  };
}

describe("Actual income on the calendar and off-cycle job assignment", () => {
  it("shows a November 12 bank deposit even when scheduled paydays omit November 12", () => {
    const s = state();
    const projected = visibleIncomeEntriesForMonth(s.timesheet, s.jobs, NOVEMBER, "2026-11-19");
    expect(projected.some((entry) => entry.date === "2026-11-12")).toBe(false);
    expect(receivedIncomeForMonth(s, NOVEMBER).map((tx) => tx.date)).toEqual(["2026-11-12"]);
    expect(incomeCalendarPaidTotal(s, NOVEMBER, projected)).toBe(1164.74);
  });

  it("labels the deposit with its job without moving bank cash or creating income", () => {
    const s = state();
    const before = pendingIncome(s, TODAY, "this_month");
    const tagged = reducer(s, { type: "SET_INCOME_JOB", id: deposit.id, jobId: "full" });
    expect(tagged.transactions).toHaveLength(1);
    expect(tagged.transactions[0]).toMatchObject({
      amount: 1164.74, date: "2026-11-12", incomeJobId: "full",
    });
    expect(tagged.accounts).toEqual(s.accounts);
    expect(tagged.timesheet).toEqual(s.timesheet);
    expect(pendingIncome(tagged, TODAY, "this_month")).toBe(before);
    expect(incomeCalendarPaidTotal(tagged, NOVEMBER, [])).toBe(1164.74);
  });

  it("does not double-count a timesheet entry that is already linked to the bank deposit", () => {
    const s = state();
    const paid: TimesheetEntry = {
      id: "pay", jobId: "full", jobName: "Full-time",
      entryType: "salary_paycheck", date: "2026-11-12",
      hours: 0, rate: 0, expectedAmount: 1164.74,
      actualAmount: 1164.74, paid: true, payStatus: "paid",
      paidAccountId: "mnt-saving", linkedTransactionId: deposit.id,
      createdAt: "2026-11-12", updatedAt: "2026-11-12", userEdited: true,
    };
    expect(incomeCalendarPaidTotal(s, NOVEMBER, [paid])).toBe(1164.74);
  });

  it("moves a receipt after an Activity date correction and removes it after deletion", () => {
    const s = state();
    const corrected = reducer(s, {
      type: "UPDATE_INCOME_TRANSACTION", id: deposit.id, date: "2026-11-13",
      description: deposit.description, category: deposit.category,
    });
    expect(receivedIncomeForMonth(corrected, NOVEMBER)[0].date).toBe("2026-11-13");
    const removed = reducer(corrected, {
      type: "DELETE_INCOME_TRANSACTION", id: deposit.id, bankBalanceAuthoritative: true,
    });
    expect(receivedIncomeForMonth(removed, NOVEMBER)).toEqual([]);
    expect(removed.accounts).toEqual(s.accounts);
  });

  it("rejects nonexistent job IDs and allows clearing a job label", () => {
    const s = state();
    expect(reducer(s, { type: "SET_INCOME_JOB", id: deposit.id, jobId: "missing" })).toBe(s);
    const tagged = reducer(s, { type: "SET_INCOME_JOB", id: deposit.id, jobId: "full" });
    const cleared = reducer(tagged, { type: "SET_INCOME_JOB", id: deposit.id });
    expect(cleared.transactions[0].incomeJobId).toBeUndefined();
    expect(cleared.accounts).toEqual(s.accounts);
  });
});
