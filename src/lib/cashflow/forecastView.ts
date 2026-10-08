import type { AppState, Card, Transaction } from "./types";
import type { ForecastProjectionOptions } from "./forecast";
import { currentOpenCycle } from "./cardLogic";
import { addDays, fromISODate } from "./dates";
import { projectPromoPayoff, type PlannedCardCharge } from "./promoPayoff";

export type ForecastScenario = "best" | "expected" | "worst" | "custom";

export interface CustomForecastScenario {
  unexpectedExpenseAmount: number;
  unexpectedExpenseDate: string;
  variableExpenseReductionPercent: number;
}

function toISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function forecastScenarioOptions(
  scenario: ForecastScenario,
  ref: Date,
  custom: CustomForecastScenario,
  includeProjectedIncome: boolean,
  forSafety = false,
): ForecastProjectionOptions {
  const mayIncludeProjectedIncome = includeProjectedIncome && !forSafety;

  if (scenario === "best") {
    return {
      includeProjectedIncome: mayIncludeProjectedIncome,
      variableExpenseMultiplier: 0.8,
    };
  }
  if (scenario === "worst") {
    return {
      includeProjectedIncome: false,
      unexpectedExpenseAmount: 500,
      unexpectedExpenseDate: toISO(addDays(ref, 7)),
    };
  }
  if (scenario === "custom") {
    return {
      includeProjectedIncome: mayIncludeProjectedIncome,
      variableExpenseMultiplier: Math.max(0, 1 - custom.variableExpenseReductionPercent / 100),
      unexpectedExpenseAmount: Math.max(0, custom.unexpectedExpenseAmount),
      unexpectedExpenseDate: custom.unexpectedExpenseDate,
    };
  }
  return { includeProjectedIncome: mayIncludeProjectedIncome };
}

export interface ZeroAprPayoffPlan {
  daysRemaining?: number;
  statementCyclesRemaining?: number;
  recommendedMonthlyPayment: number;
  recordedPayments: number;
  progressPercent: number;
  paymentMode?: "fixed" | "utilization";
  plannedMonthlyPayment?: number;
  projectedBalanceAtDeadline?: number;
  additionalMonthlyNeeded?: number;
  lumpSumNeeded?: number;
  requiredMonthlyPayment?: number;
  payoffDate?: string;
}

function paymentsForCard(transactions: Transaction[], cardId: string): number {
  return transactions
    .filter((transaction) => transaction.type === "card_payment" && transaction.cardId === cardId)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function zeroAprPayoffPlan(
  card: Card,
  transactions: Transaction[],
  ref: Date = new Date(),
  charges: PlannedCardCharge[] = [],
  skippedPaymentIds: string[] = [],
): ZeroAprPayoffPlan {
  const recordedPayments = paymentsForCard(transactions, card.id);
  const trackedStartingBalance = card.currentBalance + recordedPayments;
  const progressPercent =
    trackedStartingBalance > 0
      ? Math.min(100, Math.max(0, (recordedPayments / trackedStartingBalance) * 100))
      : 100;

  if (!card.zeroAprEndDate) {
    return {
      recommendedMonthlyPayment: Math.min(card.currentBalance, Math.max(0, card.minimumDue)),
      recordedPayments,
      progressPercent,
    };
  }

  const promoEnd = fromISODate(card.zeroAprEndDate);
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const daysRemaining = Math.ceil((promoEnd.getTime() - today.getTime()) / 86400000);
  if (daysRemaining <= 0) {
    return {
      daysRemaining,
      statementCyclesRemaining: 0,
      recommendedMonthlyPayment: card.currentBalance,
      recordedPayments,
      progressPercent,
    };
  }

  let cycle = currentOpenCycle(card, ref);
  let statementCyclesRemaining = 0;
  for (let guard = 0; guard < 60; guard += 1) {
    statementCyclesRemaining += 1;
    if (cycle.cycleEnd >= card.zeroAprEndDate) break;
    cycle = currentOpenCycle(card, addDays(fromISODate(cycle.cycleEnd), 1));
  }

  const cyclePayment =
    statementCyclesRemaining > 0
      ? Math.ceil((card.currentBalance / statementCyclesRemaining) * 100) / 100
      : card.currentBalance;
  const recommendedMonthlyPayment = Math.min(
    card.currentBalance,
    Math.max(card.minimumDue, cyclePayment),
  );

  const fixed = card.zeroAprPaymentMode === "fixed" && (card.zeroAprMonthlyPayment ?? 0) > 0;
  const targetPayment = Math.max(
    card.minimumDue,
    card.currentBalance - (card.limit * card.targetUtilizationPercent) / 100,
  );
  const projection = projectPromoPayoff(
    card,
    ref,
    card.zeroAprEndDate,
    charges,
    fixed ? card.zeroAprMonthlyPayment : targetPayment,
    fixed
      ? undefined
      : (_index, balance) =>
          Math.max(card.minimumDue, balance - (card.limit * card.targetUtilizationPercent) / 100),
    (date) => skippedPaymentIds.includes(
      `${card.id}:${fixed ? "fixed" : "utilization"}:${date}`,
    ),
  );

  return {
    daysRemaining,
    statementCyclesRemaining: skippedPaymentIds.length
      ? projection.paymentDatesBeforeDeadline : statementCyclesRemaining,
    recommendedMonthlyPayment: skippedPaymentIds.length
      ? Math.min(card.currentBalance, Math.max(recommendedMonthlyPayment,
          projection.requiredMonthlyPayment)) : recommendedMonthlyPayment,
    recordedPayments,
    progressPercent,
    paymentMode: fixed ? "fixed" : "utilization",
    plannedMonthlyPayment: fixed
      ? Math.max(card.minimumDue, card.zeroAprMonthlyPayment!)
      : targetPayment,
    projectedBalanceAtDeadline: projection.projectedBalanceAtDeadline,
    additionalMonthlyNeeded: projection.additionalMonthlyNeeded,
    lumpSumNeeded: projection.lumpSumNeeded,
    requiredMonthlyPayment: projection.requiredMonthlyPayment,
    payoffDate: projection.payoffDate,
  };
}

export function reservedCashTotal(state: AppState): number {
  const reservedAccounts = state.accounts
    .filter((account) => account.availableForSpending === false)
    .reduce((sum, account) => sum + account.balance, 0);
  return reservedAccounts + Math.max(0, state.profile.safeToSpendFloor);
}
