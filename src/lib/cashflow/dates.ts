export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthDays(d: Date): { date: Date; iso: string; inMonth: boolean }[] {
  const start = startOfMonth(d);
  const startDay = start.getDay();
  const end = endOfMonth(d);
  const days: { date: Date; iso: string; inMonth: boolean }[] = [];
  // leading
  for (let i = startDay - 1; i >= 0; i--) {
    const dd = addDays(start, -i - 1);
    days.push({ date: dd, iso: toISODate(dd), inMonth: false });
  }
  for (let i = 1; i <= end.getDate(); i++) {
    const dd = new Date(d.getFullYear(), d.getMonth(), i);
    days.push({ date: dd, iso: toISODate(dd), inMonth: true });
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1].date;
    const dd = addDays(last, 1);
    days.push({ date: dd, iso: toISODate(dd), inMonth: false });
  }
  return days;
}

export function hoursBetween(start: string, end: string): number {
  // HH:MM, handles overnight
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
