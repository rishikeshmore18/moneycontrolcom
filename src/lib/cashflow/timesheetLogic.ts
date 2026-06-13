import { Job, TimesheetEntry } from "./types";
import { addDays, endOfMonth, startOfMonth, toISODate } from "./dates";
import { newId } from "./dates";

export function timesheetEntryAmount(entry: TimesheetEntry): number {
  const amount = entry.actualAmount ?? entry.expectedAmount;
  return entry.entryType === "time_off" ? -amount : amount;
}

// Synthesizes scheduled full-time salary paychecks for a given month
// based on the user's full-time Job. They are NOT persisted unless
// the user edits/marks them paid (then they become real entries).
export function syntheticSalaryEntries(
  job: Job | undefined,
  monthDate: Date,
  realEntries: TimesheetEntry[],
): TimesheetEntry[] {
  if (!job || job.type !== "full_time") return [];
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const dates: string[] = [];
  if (job.payFrequency === "weekly") {
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      if (d.getDay() === job.paydayWeekday) dates.push(toISODate(d));
    }
  } else if (job.payFrequency === "biweekly") {
    const anchor = job.biweeklyAnchorDate ? new Date(job.biweeklyAnchorDate) : null;
    if (!anchor) return [];
    // walk anchor forward/back in 14-day strides until in window
    let cur = new Date(anchor);
    while (cur > end) cur = addDays(cur, -14);
    while (cur < start) cur = addDays(cur, 14);
    while (cur <= end) {
      dates.push(toISODate(cur));
      cur = addDays(cur, 14);
    }
  } else if (job.payFrequency === "semimonthly") {
    const [d1, d2] = job.semimonthlyDays ?? [1, 15];
    const last = end.getDate();
    [d1, d2].forEach((n) => {
      const day = Math.min(n, last);
      const dd = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
      dates.push(toISODate(dd));
    });
  } else if (job.payFrequency === "monthly") {
    const last = end.getDate();
    const day = Math.min(job.paydayWeekday || 1, last); // reuse field as day-of-month
    const dd = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    dates.push(toISODate(dd));
  }

  return dates
    .filter(
      (date) =>
        !realEntries.some(
          (e) => e.date === date && e.jobId === job.id && e.entryType === "salary_paycheck",
        ),
    )
    .map((date) => ({
      id: `auto-${job.id}-${date}`,
      jobId: job.id,
      jobName: job.name,
      entryType: "salary_paycheck",
      date,
      hours: 0,
      rate: 0,
      expectedAmount: job.netPaycheckAmount,
      actualAmount: undefined,
      paid: false,
      payStatus: "unpaid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userEdited: false,
      auto: true,
    }));
}

function entriesInMonth(all: TimesheetEntry[], monthDate: Date): TimesheetEntry[] {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  return all.filter((e) => {
    const d = new Date(e.date);
    return d >= start && d <= end;
  });
}

function roundedHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

function roundedAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function syntheticPartTimeForecastEntries(
  jobs: Job[],
  monthDate: Date,
  realEntries: TimesheetEntry[],
): TimesheetEntry[] {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const inMonth = entriesInMonth(realEntries, monthDate);
  const realShiftKeys = new Set(
    inMonth
      .filter((entry) => entry.entryType === "work_shift")
      .map((entry) => `${entry.jobId}:${entry.date}`),
  );
  const timeOffHours = new Map<string, number>();

  inMonth
    .filter((entry) => entry.entryType === "time_off")
    .forEach((entry) => {
      const key = `${entry.jobId}:${entry.date}`;
      timeOffHours.set(key, (timeOffHours.get(key) ?? 0) + entry.hours);
    });

  return jobs.flatMap((job) => {
    if (job.type !== "part_time") return [];

    const weekdays = Array.from(
      new Set((job.scheduledWeekdays ?? []).filter((day) => day >= 0 && day <= 6)),
    );
    const scheduledHours = Math.max(0, job.scheduledHoursPerShift ?? 0);
    if (weekdays.length === 0 || scheduledHours <= 0 || job.netHourlyRate <= 0) return [];

    const weekdaySet = new Set(weekdays);
    const entries: TimesheetEntry[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      if (!weekdaySet.has(d.getDay())) continue;
      const date = toISODate(d);
      const key = `${job.id}:${date}`;
      if (realShiftKeys.has(key)) continue;

      const hours = roundedHours(Math.max(0, scheduledHours - (timeOffHours.get(key) ?? 0)));
      if (hours <= 0) continue;

      entries.push({
        id: `auto-part-${job.id}-${date}`,
        jobId: job.id,
        jobName: job.name,
        entryType: "work_shift",
        date,
        hours,
        rate: job.netHourlyRate,
        expectedAmount: roundedAmount(hours * job.netHourlyRate),
        paid: false,
        payStatus: "unpaid",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userEdited: false,
        auto: true,
      });
    }

    return entries;
  });
}

export function entriesForMonth(
  all: TimesheetEntry[],
  jobs: Job[],
  monthDate: Date,
): TimesheetEntry[] {
  const inMonth = entriesInMonth(all, monthDate);
  const fullTime = jobs.find((j) => j.type === "full_time");
  const synth = syntheticSalaryEntries(fullTime, monthDate, all);
  return [...inMonth, ...synth];
}

export function forecastIncomeEntriesForMonth(
  all: TimesheetEntry[],
  jobs: Job[],
  monthDate: Date,
): TimesheetEntry[] {
  return [
    ...entriesForMonth(all, jobs, monthDate),
    ...syntheticPartTimeForecastEntries(jobs, monthDate, all),
  ];
}

export function makeShiftEntry(input: {
  jobId: string;
  jobName: string;
  date: string;
  hours: number;
  rate: number;
  startTime?: string;
  endTime?: string;
}): TimesheetEntry {
  const amount = Math.round(input.hours * input.rate * 100) / 100;
  return {
    id: newId(),
    jobId: input.jobId,
    jobName: input.jobName,
    entryType: "work_shift",
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    hours: input.hours,
    rate: input.rate,
    expectedAmount: amount,
    paid: false,
    payStatus: "unpaid",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userEdited: true,
  };
}

export function makeTimeOffEntry(input: {
  jobId: string;
  jobName: string;
  date: string;
  hours: number;
  rate: number;
}): TimesheetEntry {
  const amount = Math.round(input.hours * input.rate * 100) / 100;
  return {
    id: newId(),
    jobId: input.jobId,
    jobName: input.jobName,
    entryType: "time_off",
    date: input.date,
    hours: input.hours,
    rate: input.rate,
    expectedAmount: amount,
    paid: false,
    payStatus: "unpaid",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userEdited: true,
  };
}
