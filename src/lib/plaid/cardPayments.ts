import type { AppState } from "@/lib/cashflow/types";
import type { Connection, ConnectionAccount, InboxItem } from "./plaid.functions";

/** Wording banks use for a credit-card bill payment. */
const PAYMENT_RE =
  /payment|autopay|auto[- ]?pay|\bpmt\b|thank you|bill ?pay|epay|card payment|online transfer/i;

const AMOUNT_TOLERANCE = 0.02;
const DAY_TOLERANCE = 5;

export function accountMapFor(
  connections: Connection[],
  plaidAccountId: string,
): ConnectionAccount | null {
  for (const conn of connections) {
    const hit = conn.accounts.find((a) => a.accountId === plaidAccountId);
    if (hit) return hit;
  }
  return null;
}

function daysApart(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`).getTime();
  const db = new Date(`${b}T00:00:00`).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db) / 86_400_000;
}

export interface CardPaymentMatch {
  /** The credit-card side of the payment (money credited to the card). */
  cardItem: InboxItem;
  /** The bank-account side (money leaving the account), when we found it. */
  bankItem: InboxItem | null;
  cardId: string;
  /** Local account the money came from, when known. */
  sourceAccountId: string | null;
  amount: number;
  date: string;
}

export interface CardPaymentScan {
  /** Card payments seen on both the card and the bank account — safe to post automatically. */
  matched: CardPaymentMatch[];
  /** Card payments with no bank withdrawal behind them — the user picks how it was paid. */
  unmatched: CardPaymentMatch[];
  /** Everything else, to review as usual. */
  rest: InboxItem[];
}

/**
 * Pairs a credit-card bill payment with the matching withdrawal from the bank
 * account, so a single payment is never posted twice (once as card credit and
 * once as a bank expense).
 */
export function scanCardPayments(items: InboxItem[], connections: Connection[]): CardPaymentScan {
  const mapOf = (id: string) => accountMapFor(connections, id);
  const used = new Set<string>();
  const matched: CardPaymentMatch[] = [];
  const unmatched: CardPaymentMatch[] = [];

  const bankCandidates = items.filter((item) => {
    const map = mapOf(item.plaidAccountId);
    return map?.linkedLocalKind === "account" && !!map.linkedLocalId && item.amount > 0;
  });

  const cardCredits = items
    .filter((item) => {
      const map = mapOf(item.plaidAccountId);
      return map?.linkedLocalKind === "card" && !!map.linkedLocalId && item.amount < 0;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const cardItem of cardCredits) {
    const map = mapOf(cardItem.plaidAccountId);
    const cardId = map?.linkedLocalId;
    if (!cardId) continue;
    const amount = Math.abs(cardItem.amount);

    const bankItem =
      bankCandidates.find(
        (b) =>
          !used.has(b.id) &&
          Math.abs(b.amount - amount) <= AMOUNT_TOLERANCE &&
          daysApart(b.date, cardItem.date) <= DAY_TOLERANCE,
      ) ?? null;

    const looksLikePayment = PAYMENT_RE.test(`${cardItem.name} ${cardItem.merchantName ?? ""}`);
    if (!bankItem && !looksLikePayment) continue; // probably a refund — review normally

    used.add(cardItem.id);
    const match: CardPaymentMatch = {
      cardItem,
      bankItem,
      cardId,
      sourceAccountId: bankItem ? (mapOf(bankItem.plaidAccountId)?.linkedLocalId ?? null) : null,
      amount,
      date: cardItem.date,
    };
    if (bankItem) {
      used.add(bankItem.id);
      matched.push(match);
    } else {
      unmatched.push(match);
    }
  }

  return { matched, unmatched, rest: items.filter((item) => !used.has(item.id)) };
}

/** True when this card payment is already recorded in the app. */
export function cardPaymentAlreadyRecorded(
  state: AppState,
  cardId: string,
  amount: number,
  date: string,
): boolean {
  return state.transactions.some(
    (t) =>
      t.type === "card_payment" &&
      t.cardId === cardId &&
      Math.abs(Math.abs(t.amount) - amount) <= AMOUNT_TOLERANCE &&
      daysApart(t.date, date) <= DAY_TOLERANCE,
  );
}
