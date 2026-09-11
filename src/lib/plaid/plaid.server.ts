// Thin fetch wrapper around the Plaid API (production). Server-only.
export const PLAID_BASE = "https://production.plaid.com";

export class PlaidError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function plaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const clientId = process.env["PLAID_CLIENT_ID"];
  const secret = process.env["PLAID_SECRET"];
  if (!clientId || !secret) {
    throw new PlaidError(500, "CONFIG", "Plaid credentials are not configured.");
  }
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, client_id: clientId, secret }),
  });
  const text = await res.text();
  if (!res.ok) {
    let code = "PLAID_ERROR";
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error_code?: string; error_message?: string };
      code = parsed.error_code ?? code;
      message = parsed.error_message ?? message;
    } catch {
      /* keep raw text */
    }
    console.error(`[plaid] ${path} failed [${res.status}] ${code}: ${message}`);
    throw new PlaidError(res.status, code, message);
  }
  return JSON.parse(text) as T;
}

export interface PlaidApiAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  balances: {
    current?: number | null;
    available?: number | null;
    limit?: number | null;
    iso_currency_code?: string | null;
  };
}

export interface PlaidApiTransaction {
  transaction_id: string;
  account_id: string;
  pending: boolean;
  pending_transaction_id?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  payment_channel?: string | null;
  personal_finance_category?: { primary?: string; detailed?: string } | null;
  category?: string[] | null;
}
