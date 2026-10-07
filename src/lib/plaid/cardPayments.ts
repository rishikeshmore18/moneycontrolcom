import type { AppState, Transaction } from "@/lib/cashflow/types";
import type { Connection, ConnectionAccount, InboxItem } from "./plaid.functions";

/** Wording banks use for a credit-card bill payment. */
const PAYMENT_RE =
  /payment|autopay|auto[- ]?pay|\bpmt\b|thank you|bill ?pay|epay|card payment|online transfer/i;

const AMOUNT_TOLERANCE = 0.02;
const DAY_TOLERANCE = 14;

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
    return !item.pending && map?.linkedLocalKind === "account" && !!map.linkedLocalId && item.amount > 0 &&
      PAYMENT_RE.test(`${item.name} ${item.merchantName ?? ""}`);
  });

  const cardCredits = items
    .filter((item) => {
      const map = mapOf(item.plaidAccountId);
      return !item.pending && map?.linkedLocalKind === "card" && !!map.linkedLocalId && item.amount < 0;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const cardItem of cardCredits) {
    const map = mapOf(cardItem.plaidAccountId);
    const cardId = map?.linkedLocalId;
    if (!cardId) continue;
    const amount = Math.abs(cardItem.amount);

    const possibleBanks =
      bankCandidates.filter(
        (b) =>
          !used.has(b.id) &&
          Math.round(b.amount * 100) === Math.round(amount * 100) &&
          daysApart(b.date, cardItem.date) <= DAY_TOLERANCE,
      );
    const possibleBank = possibleBanks.length === 1 ? possibleBanks[0] : null;
    // Both directions must be unique. Two same-amount card credits cannot claim one debit.
    const bankItem = possibleBank && cardCredits.filter((credit) =>
      PAYMENT_RE.test(`${credit.name} ${credit.merchantName ?? ""}`) &&
      Math.round(Math.abs(credit.amount) * 100) === Math.round(possibleBank.amount * 100) &&
      daysApart(credit.date, possibleBank.date) <= DAY_TOLERANCE).length === 1 ? possibleBank : null;

    const looksLikePayment = PAYMENT_RE.test(`${cardItem.name} ${cardItem.merchantName ?? ""}`);
    if (!looksLikePayment) continue; // a credit may be a refund, even if an unrelated debit matches

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

/** A unique posted bank leg can confirm an existing transfer, even when the other leg arrives days later. */
export function paymentForBankItem(
  state: AppState, item: InboxItem, connections: Connection[],
): { transaction: Transaction; leg: "cash" | "card" } | null {
  if (item.pending || !PAYMENT_RE.test(`${item.name} ${item.merchantName ?? ""}`)) return null;
  const map = accountMapFor(connections, item.plaidAccountId);
  const leg = map?.linkedLocalKind === "card" && item.amount < 0 ? "card"
    : map?.linkedLocalKind === "account" && item.amount > 0 ? "cash" : null;
  if (!leg || !map?.linkedLocalId) return null;
  const matches = state.transactions.filter((tx) => tx.type === "card_payment" &&
    (leg === "card" ? tx.cardId : tx.sourceAccountId) === map.linkedLocalId &&
    Math.round(tx.amount * 100) === Math.round(Math.abs(item.amount) * 100) &&
    daysApart(tx.date, item.date) <= DAY_TOLERANCE &&
    !(leg === "card" ? tx.cardPayment?.bankCreditId : tx.cardPayment?.bankDebitId));
  return matches.length === 1 ? { transaction: matches[0], leg } : null;
}

export function existingCardPayment(state: AppState, cardId: string, amount: number, date: string): Transaction | null {
  const matches = state.transactions.filter((tx) => tx.type === "card_payment" && tx.cardId === cardId &&
    Math.round(tx.amount * 100) === Math.round(amount * 100) && daysApart(tx.date, date) <= DAY_TOLERANCE);
  return matches.length === 1 ? matches[0] : null;
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
