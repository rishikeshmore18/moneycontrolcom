/**
 * Server/API boundary for the subset of Plaid Liabilities credit-card values
 * that Cashflow Control uses. Missing values remain unknown, never zero.
 */
export interface PlaidCreditLiability {
  account_id: string | null;
  last_statement_balance?: number | null;
  last_statement_issue_date?: string | null;
  minimum_payment_amount?: number | null;
  next_payment_due_date?: string | null;
  last_payment_amount?: number | null;
  last_payment_date?: string | null;
  is_overdue?: boolean | null;
}
function amount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function isoDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + "T12:00:00Z");
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}
export function normalizeCreditLiability(card: PlaidCreditLiability, syncedAt: string) {
  return {
    statement_balance: amount(card.last_statement_balance),
    statement_issue_date: isoDay(card.last_statement_issue_date),
    minimum_due: amount(card.minimum_payment_amount),
    issuer_due_date: isoDay(card.next_payment_due_date),
    last_payment_amount: amount(card.last_payment_amount),
    last_payment_date: isoDay(card.last_payment_date),
    issuer_overdue: typeof card.is_overdue === "boolean" ? card.is_overdue : null,
    synced_at: syncedAt,
  };
}
