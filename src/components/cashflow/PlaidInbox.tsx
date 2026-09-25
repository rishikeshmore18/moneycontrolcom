import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { Field, Input, Select } from "./Field";
import { toast } from "./Toast";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney } from "@/lib/cashflow/money";
import { todayISO } from "@/lib/cashflow/dates";
import { matchingPlannedExpenses, type ReviewExpense } from "@/lib/cashflow/plannedReview";
import type { CashFlowBreakdownItem } from "@/lib/cashflow/forecast";
import {
  plaidListConnections,
  plaidListInbox,
  plaidPreviewClearInbox,
  plaidClearInbox,
  plaidResolveInbox,
  type ClearInboxRange,
  type Connection,
  type InboxItem,
} from "@/lib/plaid/plaid.functions";
import { guessCategory } from "@/lib/plaid/categoryGuess";
import {
  cardPaymentAlreadyRecorded,
  scanCardPayments,
  type CardPaymentMatch,
} from "@/lib/plaid/cardPayments";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function PlaidReviewButton({ variant = "soft" }: { variant?: "soft" | "primary" | "ghost" }) {
  const { state, dispatch } = useApp();
  const listConnections = useServerFn(plaidListConnections);
  const listInbox = useServerFn(plaidListInbox);

  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([listConnections(), listInbox()]);
      setConnections(c);
      setInbox(
        [...i].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
      );
      setCount(i.length);
    } catch (err) {
      console.error("[plaid] inbox load failed", err);
    } finally {
      setLoading(false);
    }
  }, [listConnections, listInbox]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    let cancelled = false;
    listInbox()
      .then((i) => {
        if (cancelled) return;
        setCount(i.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [listInbox]);

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} className="min-w-0 shrink-0 whitespace-nowrap !px-3 sm:!px-4">
        <Inbox size={16} />
        <span>Review</span>
        {count > 0 && (
          <span className="ml-1 inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--primary)] px-1.5 text-[10px] font-black text-[color:var(--primary-foreground)] tabular-nums">
            {count}
          </span>
        )}
      </Button>
      {open && (
        <InboxSheet
          open={open}
          onClose={() => setOpen(false)}
          items={inbox}
          connections={connections}

          onResolved={refresh}
          dispatch={dispatch}
          state={state}
          loading={loading}
        />
      )}
    </>
  );
}

type AppCtx = ReturnType<typeof useApp>;

function InboxSheet({
  open,
  onClose,
  items,
  connections,
  onResolved,
  dispatch,
  state,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  items: InboxItem[];
  connections: Connection[];
  onResolved: () => Promise<void> | void;
  dispatch: AppCtx["dispatch"];
  state: AppCtx["state"];
  loading?: boolean;
}) {
  const resolve = useServerFn(plaidResolveInbox);
  const previewClear = useServerFn(plaidPreviewClearInbox);
  const clearInbox = useServerFn(plaidClearInbox);
  const [busy, setBusy] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearMode, setClearMode] = useState<ClearInboxRange["mode"]>("all");
  const [beforeDate, setBeforeDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [confirmation, setConfirmation] = useState<{ range: ClearInboxRange; count: number } | null>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!confirmation) return;
    const frame = window.requestAnimationFrame(() => cancelClearRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [confirmation]);
  const [catFor, setCatFor] = useState<Record<string, string>>({});
  const [otherCategoryFor, setOtherCategoryFor] = useState<Record<string, string>>({});
  const [payFrom, setPayFrom] = useState<Record<string, string>>({});
  const accounts = useMemo(() => connections.flatMap((c) => c.accounts), [connections]);
  const { unmatched, rest } = useMemo(
    () => scanCardPayments(items, connections),
    [items, connections],
  );
  const cur = state.profile.currency;
  const baseCategories = state.categories?.length ? state.categories : ["Groceries", "Other"];
  const categories: string[] = baseCategories.includes("Miscellaneous")
    ? baseCategories
    : [...baseCategories, "Miscellaneous"];

  const mappingFor = (plaidAccountId: string) =>
    accounts.find((a) => a.accountId === plaidAccountId) ?? null;

  const duplicateFor = (item: InboxItem) => {
    const map = mappingFor(item.plaidAccountId);
    if (!map?.linkedLocalId) return null;
    const target = Math.abs(item.amount);
    const itemTime = new Date(item.date).getTime();
    return (
      state.transactions.find((t) => {
        if (Math.abs(Math.abs(t.amount) - target) > 0.02) return false;
        const days = Math.abs(new Date(t.date).getTime() - itemTime) / 86_400_000;
        if (days > 4) return false;
        return map.linkedLocalKind === "card"
          ? t.cardId === map.linkedLocalId
          : t.sourceAccountId === map.linkedLocalId || t.targetAccountId === map.linkedLocalId;
      }) ?? null
    );
  };

  const plannedFor = (item: InboxItem): CashFlowBreakdownItem[] => {
    const map = mappingFor(item.plaidAccountId);
    if (item.amount <= 0 || !map?.linkedLocalId) return [];
    const expense: ReviewExpense = {
      name: item.merchantName || item.name,
      amount: item.amount,
      date: item.date,
      ...(map.linkedLocalKind === "card"
        ? { cardId: map.linkedLocalId }
        : { accountId: map.linkedLocalId }),
    };
    return matchingPlannedExpenses(state, expense);
  };

  const markPlannedPaid = (planned: CashFlowBreakdownItem) => {
    if (planned.sourceType !== "recurring_bill" && planned.sourceType !== "one_time") return;
    dispatch({
      type: "MARK_PLANNED_EXPENSE_PAID",
      payload: {
        sourceType: planned.sourceType,
        sourceId: planned.sourceId,
        overrideId: planned.overrideId,
        month: (planned.dueDate ?? "").slice(0, 7),
      },
    });
  };

  const finish = async (
    ids: string[],
    status: "accepted" | "dismissed" | "merged",
    localTransactionId?: string,
  ) => {
    await resolve({ data: { ids, status, localTransactionId } });
    await onResolved();
  };

  const accept = async (item: InboxItem, chosenCategory?: string, planned?: CashFlowBreakdownItem) => {
    const map = mappingFor(item.plaidAccountId);
    if (!map?.linkedLocalId) {
      toast("Link this bank account to one of your accounts or cards first.");
      return;
    }
    setBusy(item.id);
    try {
      const date = item.date || todayISO();
      const label = item.merchantName || item.name;
      if (item.amount > 0) {
        dispatch({
          type: "ADD_EXPENSE",
          payload: {
            amount: Math.abs(item.amount),
            category: chosenCategory || item.plaidCategory || "Miscellaneous",
            description: label,
            date,
            method: map.linkedLocalKind === "card" ? "credit_card" : "debit",
            balanceAlreadySynced: !item.pending,
            ...(map.linkedLocalKind === "card"
              ? { cardId: map.linkedLocalId }
              : { sourceAccountId: map.linkedLocalId }),
          },
        });
        if (planned) markPlannedPaid(planned);
      } else if (map.linkedLocalKind === "account") {
        dispatch({
          type: "ADD_INCOME",
          payload: {
            accountId: map.linkedLocalId,
            amount: Math.abs(item.amount),
            category: "Income",
            description: label,
            date,
            balanceAlreadySynced: !item.pending,
          },
        });
      } else {
        toast("Money coming into a card is a card payment — record it from Quick add, then merge.");
        setBusy(null);
        return;
      }
      await finish([item.id], "accepted");
      toast(planned ? "Expense recorded and upcoming bill marked paid." : "Added to your numbers.");
    } catch (err) {
      toast(`Couldn't add that: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const merge = async (item: InboxItem, localId: string, planned?: CashFlowBreakdownItem) => {
    setBusy(item.id);
    try {
      await finish([item.id], "merged", localId);
      if (planned) markPlannedPaid(planned);
      toast(planned ? "Existing expense linked; upcoming bill marked paid." : "Marked as the same transaction. Nothing double-counted.");
    } catch (err) {
      toast(`Couldn't merge: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (item: InboxItem) => {
    setBusy(item.id);
    try {
      await finish([item.id], "dismissed");
    } finally {
      setBusy(null);
    }
  };

  const acceptCardPayment = async (match: CardPaymentMatch) => {
    const key = match.cardItem.id;
    const source = payFrom[key] ?? "cash";
    setBusy(key);
    try {
      if (!cardPaymentAlreadyRecorded(state, match.cardId, match.amount, match.date)) {
        dispatch({
          type: "PAY_CREDIT_CARD",
          payload: {
            cardId: match.cardId,
            amount: match.amount,
            sourceAccountId: source === "cash" ? "" : source,
            date: match.date,
            notes: source === "cash" ? "Paid with cash" : "Card bill payment",
          },
        });
      }
      await finish([key], "accepted");
      toast("Card payment recorded.");
    } catch (err) {
      toast(`Couldn't record that: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const sorted = [...rest].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const nothing = unmatched.length === 0 && sorted.length === 0;

  const requestedRange = (): ClearInboxRange => {
    if (clearMode === "before") return { mode: "before", before: beforeDate };
    if (clearMode === "between") return { mode: "between", start: startDate, end: endDate };
    return { mode: "all" };
  };

  const describeRange = (range: ClearInboxRange) => {
    if (range.mode === "before") return `before ${formatDate(range.before)}`;
    if (range.mode === "between") return `from ${formatDate(range.start)} through ${formatDate(range.end)}`;
    return "in the entire review queue";
  };

  const requestClear = async () => {
    setBusy("bulk");
    try {
      const range = requestedRange();
      const { count } = await previewClear({ data: range });
      if (!count) {
        toast("No transactions match those dates.");
        return;
      }
      setConfirmation({ range, count });
    } catch (err) {
      toast(`Couldn't check transactions: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const confirmClear = async () => {
    if (!confirmation) return;
    setBusy("bulk");
    try {
      const { count } = await clearInbox({ data: confirmation.range });
      setConfirmation(null);
      setClearOpen(false);
      await onResolved();
      toast(`${count} bank transaction${count === 1 ? "" : "s"} cleared from Review.`);
    } catch (err) {
      toast(`Couldn't clear transactions: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={confirmation ? () => setConfirmation(null) : onClose} title="Review bank transactions" size="wide">
      {confirmation ? (
        <div role="alertdialog" aria-labelledby="clear-confirm-title" aria-describedby="clear-confirm-description" className="mx-auto my-4 w-full max-w-md rounded-2xl border border-border bg-[color:var(--card-solid)] p-5 shadow-elegant">
          <h3 id="clear-confirm-title" className="text-lg font-black">Clear {confirmation.count} transaction{confirmation.count === 1 ? "" : "s"}?</h3>
          <p id="clear-confirm-description" className="mt-2 text-sm leading-relaxed text-muted-foreground">
            This will remove bank transactions {describeRange(confirmation.range)} from Review. They won't be available to accept or merge later. Your recorded activity and balances won't change.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="danger" onClick={confirmClear} disabled={busy !== null}>
              {busy === "bulk" ? "Clearing..." : `Clear ${confirmation.count}`}
            </Button>
            <Button ref={cancelClearRef} variant="ghost" onClick={() => setConfirmation(null)} disabled={busy !== null}>Keep reviewing</Button>
          </div>
        </div>
      ) : loading ? (
        <div className="text-sm text-muted-foreground">Loading transactions...</div>
      ) : nothing ? (
        <div className="text-sm text-muted-foreground">Nothing waiting for review.</div>
      ) : (
        <div className="grid gap-3">
          <div className="min-w-0 rounded-2xl border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold">Clear past transactions</div>
                <p className="text-xs text-muted-foreground">Remove transactions you don't need to review.</p>
              </div>
              <Button variant="ghost" onClick={() => setClearOpen(!clearOpen)} disabled={busy !== null} aria-expanded={clearOpen}>
                <Trash2 size={16} /> {clearOpen ? "Close" : "Choose dates"}
              </Button>
            </div>
            {clearOpen && (
              <div className="mt-3 grid min-w-0 gap-3 border-t border-border pt-3">
                <Field label="Which transactions?">
                  <Select value={clearMode} onChange={(e) => setClearMode(e.target.value as ClearInboxRange["mode"])}>
                    <option value="all">Clear all</option>
                    <option value="before">Clear before a date</option>
                    <option value="between">Clear between dates</option>
                  </Select>
                </Field>
                {clearMode === "before" && <Field label="Before (date not included)"><Input type="date" value={beforeDate} onChange={(e) => setBeforeDate(e.target.value)} /></Field>}
                {clearMode === "between" && (
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <Field label="Start date (included)"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
                    <Field label="End date (included)"><Input type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
                  </div>
                )}
                <Button variant="danger" className="justify-self-start" onClick={requestClear} disabled={busy !== null || (clearMode === "before" && !beforeDate) || (clearMode === "between" && (!startDate || !endDate || startDate > endDate))}>
                  {busy === "bulk" ? "Checking..." : "Review clear action"}
                </Button>
              </div>
            )}
          </div>
          {unmatched.map((match) => {
            const card = state.cards.find((c) => c.id === match.cardId);
            const key = match.cardItem.id;
            return (
              <div
                key={key}
                className="rounded-2xl border border-[color:var(--warn)] p-3 grid gap-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">
                      Card bill payment · {card?.name ?? "Card"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(match.date)} · we couldn't find this leaving any linked account
                    </div>
                  </div>
                  <div className="font-black">{formatMoney(match.amount, cur)}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-xs text-muted-foreground">How was this paid?</div>
                  <Select
                    value={payFrom[key] ?? "cash"}
                    onChange={(e) => setPayFrom((p) => ({ ...p, [key]: e.target.value }))}
                  >
                    <option value="cash">Cash</option>
                    {state.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => acceptCardPayment(match)}
                    disabled={busy === key}
                  >
                    Record payment
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => dismiss(match.cardItem)}
                    disabled={busy === key}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            );
          })}
          {sorted.map((item) => {
            const map = mappingFor(item.plaidAccountId);
            const dup = duplicateFor(item);
            const plannedMatches = plannedFor(item);
            const chosen =
              catFor[item.id] ?? guessCategory([item.plaidCategory, item.merchantName, item.name], categories);
            const category = chosen === "Other" ? otherCategoryFor[item.id]?.trim() || "Other" : chosen;
            return (
              <div key={item.id} className="grid min-w-0 gap-2 rounded-2xl border border-border p-3 [overflow-wrap:anywhere]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{item.merchantName || item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(item.date)} · {map?.name ?? "Unlinked account"}
                      {item.pending ? " · Pending" : ""}
                      {item.plaidCategory ? ` · ${item.plaidCategory}` : ""}
                    </div>
                  </div>
                  <div
                    className={`font-black ${item.amount > 0 ? "" : "text-[color:var(--good)]"}`}
                  >
                    {item.amount > 0 ? "-" : "+"}
                    {formatMoney(Math.abs(item.amount), cur)}
                  </div>
                </div>

                {!map?.linkedLocalId && (
                  <div className="text-xs text-[color:var(--warn)]">
                    Link this bank account to one of your accounts or cards to accept it.
                  </div>
                )}

                {dup && (
                  <div className="rounded-xl bg-muted p-2 text-xs">
                    Looks like one you already entered:{" "}
                    <strong>
                      {dup.description || dup.category} · {dup.date} ·{" "}
                      {formatMoney(Math.abs(dup.amount), cur)}
                    </strong>
                    <div className="mt-2 flex gap-2">
                      <Button variant="soft" onClick={() => merge(item, dup.id)} disabled={busy === item.id}>
                        Same one — merge
                      </Button>
                    </div>
                  </div>
                )}

                {plannedMatches.length > 0 && (
                  <div className="grid gap-2 rounded-xl bg-muted p-3 text-sm">
                    <p>Also in Expenses coming. If this is the same bill, mark it paid so it no longer appears as upcoming.</p>
                    {plannedMatches.map((planned) => (
                      <Button
                        key={planned.id}
                        variant="soft"
                        className="min-w-0 justify-start whitespace-normal text-left"
                        onClick={() => dup ? merge(item, dup.id, planned) : accept(item, category, planned)}
                        disabled={busy === item.id}
                      >
                        Mark paid &amp; merge: {planned.label} · {formatMoney(planned.amount, cur)}
                      </Button>
                    ))}
                  </div>
                )}

                {item.amount > 0 && map?.linkedLocalId && (
                  <div className="grid gap-1">
                    <div className="text-xs text-muted-foreground">
                      Category (auto-detected — change it if it's wrong)
                    </div>
                    <Select
                      value={chosen}
                      onChange={(e) => setCatFor((p) => ({ ...p, [item.id]: e.target.value }))}
                    >
                      {(categories.includes(chosen) ? categories : [chosen, ...categories]).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                    {chosen === "Other" && (
                      <Field label="Category name" hint="Leave blank to keep Other.">
                        <Input
                          value={otherCategoryFor[item.id] ?? ""}
                          onChange={(event) => setOtherCategoryFor((previous) => ({ ...previous, [item.id]: event.target.value }))}
                          placeholder="e.g. Parking, Laundry"
                        />
                      </Field>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => accept(item, category)}
                    disabled={busy === item.id || !map?.linkedLocalId}
                  >
                    Accept
                  </Button>
                  <Button variant="ghost" onClick={() => dismiss(item)} disabled={busy === item.id}>
                    Dismiss
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
