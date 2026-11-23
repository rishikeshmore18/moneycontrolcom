import type { Card, CardLiability } from "./types";

/** Plaid Liabilities refresh is approximately daily. Never turn missing data into a zero bill. */
export const LIABILITY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export function usableLiability(card: Card, now: Date = new Date()): CardLiability | null {
  const data = card.plaidLiability;
  if (!data) return null;
  const age = now.getTime() - new Date(data.syncedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= LIABILITY_MAX_AGE_MS ? data : null;
}

export function effectiveCardBilling(card: Card, now: Date = new Date()) {
  const plaid = usableLiability(card, now);
  return {
    statementBalance: plaid?.statementBalance ?? card.statementBalance,
    minimumDue: plaid?.minimumDue ?? card.minimumDue,
    issuerDueDate: plaid?.issuerDueDate ?? null,
    statementIssueDate: plaid?.statementIssueDate ?? null,
    lastPaymentAmount: plaid?.lastPaymentAmount ?? null,
    lastPaymentDate: plaid?.lastPaymentDate ?? null,
    issuerOverdue: plaid?.issuerOverdue ?? null,
    statementSource: plaid?.statementBalance != null ? "plaid" as const : "manual" as const,
    minimumSource: plaid?.minimumDue != null ? "plaid" as const : "manual" as const,
    fresh: !!plaid,
    lastSyncedAt: card.plaidLiability?.syncedAt ?? null,
  };
}

export type CardPaymentStatus = "issuer_overdue" | "planned_missed" | "upcoming" | "due_soon" | "paid" | "unknown";
export function issuerPaymentStatus(card: Card, today: string): CardPaymentStatus {
  const billing = effectiveCardBilling(card, new Date(today + "T12:00:00Z"));
  if (billing.issuerOverdue === true) return "issuer_overdue";
  if (card.currentBalance <= 0) return "paid";
  if (billing.issuerDueDate) {
    if (billing.minimumDue === 0 && billing.statementBalance === 0) return "paid";
    if (billing.issuerDueDate < today) return "unknown"; // No proof of a missed payment
    const days = Math.round((Date.parse(billing.issuerDueDate + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 86400000);
    return days <= 5 ? "due_soon" : "upcoming";
  }
  return "unknown";
}
