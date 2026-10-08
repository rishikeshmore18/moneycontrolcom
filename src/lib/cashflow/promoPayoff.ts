import type { Card } from "./types";
import { toISODate } from "./dates";

export interface PlannedCardCharge {
  date: string;
  amount: number;
}
export interface PromoPayment {
  date: string;
  amount: number;
  balanceAfter: number;
}
export interface PromoProjection {
  payments: PromoPayment[];
  paymentDatesBeforeDeadline: number;
  projectedBalanceAtDeadline: number;
  additionalMonthlyNeeded: number;
  lumpSumNeeded: number;
  requiredMonthlyPayment: number;
  payoffDate?: string;
}

const cents = (amount: number) => {
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("Card plan amounts must be finite and nonnegative");
  return Math.round(amount * 100);
};
const money = (amount: number) => amount / 100;

function monthlyDates(card: Card, ref: Date, end: string): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset < 120; offset += 1) {
    const month = new Date(ref.getFullYear(), ref.getMonth() + offset, 1);
    const day = Math.min(
      Math.max(1, card.dueDate || 1),
      new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
    );
    const date = toISODate(new Date(month.getFullYear(), month.getMonth(), day));
    if (date >= toISODate(ref) && date <= end) dates.push(date);
    if (date > end) break;
  }
  return dates;
}

/** Payments are a single cash outflow each due day. The starting balance is the
 * latest bank snapshot. Future purchases are estimates, not posted transactions. */
export function projectPromoPayoff(
  card: Card,
  ref: Date,
  through: string,
  charges: PlannedCardCharge[] = [],
  monthlyPayment = card.zeroAprMonthlyPayment ?? 0,
  paymentForCycle?: (index: number, balance: number) => number,
  skipPaymentOnDate?: (date: string) => boolean,
): PromoProjection {
  const today = toISODate(ref);
  const deadline = card.zeroAprEndDate ?? through;
  const dates = monthlyDates(card, ref, through);
  const promoDates = dates.filter((date) => date <= deadline);
  const chargeList = charges
    .filter((charge) => charge.date >= today && charge.date <= through)
    .sort((a, b) => a.date.localeCompare(b.date));
  const monthlySpend = cents(card.zeroAprExpectedMonthlySpend ?? 0);
  const paymentAmount = Math.max(cents(monthlyPayment), cents(card.minimumDue));
  const calculate = (perMonth: number, record: boolean) => {
    let balance = cents(card.currentBalance);
    let index = 0;
    let payoffDate: string | undefined;
    const payments: PromoPayment[] = [];
    let balanceAtDeadline = balance;
    for (const [paymentIndex, date] of dates.entries()) {
      let planned = 0;
      while (index < chargeList.length && chargeList[index].date <= date) {
        planned += cents(chargeList[index].amount);
        index++;
      }
      // The user's monthly estimate includes planned purchases, so count the larger amount.
      balance += Math.max(monthlySpend, planned);
      const scheduled = skipPaymentOnDate?.(date)
        ? 0
        : record && paymentForCycle ? cents(paymentForCycle(paymentIndex, money(balance))) : perMonth;
      const amount = Math.min(balance, scheduled);
      balance -= amount;
      if (record && amount > 0)
        payments.push({ date, amount: money(amount), balanceAfter: money(balance) });
      if (date <= deadline) {
        balanceAtDeadline = balance;
        if (balance === 0) payoffDate = date;
      }
    }
    // A charge after the final due date cannot be paid by a scheduled monthly payment.
    const lastPromoDate = promoDates.at(-1) ?? today;
    for (const charge of chargeList) {
      if (charge.date > lastPromoDate && charge.date <= deadline)
        balanceAtDeadline += cents(charge.amount);
    }
    return { payments, balanceAtDeadline, payoffDate };
  };
  const projection = calculate(paymentAmount, true);
  // Find the smallest payment in cents that reaches the balance at the deadline.
  let low = 0;
  let high =
    cents(card.currentBalance) +
    monthlySpend * promoDates.length +
    chargeList.reduce((sum, c) => sum + cents(c.amount), 0);
  if (promoDates.length === 0 || calculate(high, false).balanceAtDeadline > 0) high = 0;
  while (high && low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calculate(middle, false).balanceAtDeadline === 0) high = middle;
    else low = middle + 1;
  }
  const required = high ? Math.max(cents(card.minimumDue), low) : 0;
  return {
    payments: projection.payments,
    paymentDatesBeforeDeadline: promoDates.filter((date) => !skipPaymentOnDate?.(date)).length,
    projectedBalanceAtDeadline: money(projection.balanceAtDeadline),
    additionalMonthlyNeeded: money(Math.max(0, required - paymentAmount)),
    lumpSumNeeded: money(projection.balanceAtDeadline),
    requiredMonthlyPayment: money(required),
    payoffDate: projection.balanceAtDeadline === 0 ? projection.payoffDate : undefined,
  };
}
