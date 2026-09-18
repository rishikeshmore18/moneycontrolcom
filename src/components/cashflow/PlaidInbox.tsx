import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Inbox } from "lucide-react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { Select } from "./Field";
import { toast } from "./Toast";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney } from "@/lib/cashflow/money";
import { todayISO } from "@/lib/cashflow/dates";
import {
  plaidListConnections,
  plaidListInbox,
  plaidResolveInbox,
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

  const accounts = useMemo(() => connections.flatMap((c) => c.accounts), [connections]);

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Inbox size={16} />
        Review
        {count > 0 && (
          <span className="ml-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[color:var(--primary)] px-1.5 text-[10px] font-black text-[color:var(--primary-foreground)]">
            {count}
          </span>
        )}
      </Button>
      {open && (
        <InboxSheet
          open={open}
          onClose={() => setOpen(false)}
          items={inbox}
          accounts={accounts}
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
  accounts,
  onResolved,
  dispatch,
  state,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  items: InboxItem[];
  accounts: Connection["accounts"];
  onResolved: () => Promise<void> | void;
  dispatch: AppCtx["dispatch"];
  state: AppCtx["state"];
  loading?: boolean;
}) {
  const resolve = useServerFn(plaidResolveInbox);
  const [busy, setBusy] = useState<string | null>(null);
  const [catFor, setCatFor] = useState<Record<string, string>>({});
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

  const finish = async (
    ids: string[],
    status: "accepted" | "dismissed" | "merged",
    localTransactionId?: string,
  ) => {
    await resolve({ data: { ids, status, localTransactionId } });
    await onResolved();
  };

  const accept = async (item: InboxItem, chosenCategory?: string) => {
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
            ...(map.linkedLocalKind === "card"
              ? { cardId: map.linkedLocalId }
              : { sourceAccountId: map.linkedLocalId }),
          },
        });
      } else if (map.linkedLocalKind === "account") {
        dispatch({
          type: "ADD_INCOME",
          payload: {
            accountId: map.linkedLocalId,
            amount: Math.abs(item.amount),
            category: "Income",
            description: label,
            date,
          },
        });
      } else {
        toast("Money coming into a card is a card payment — record it from Quick add, then merge.");
        setBusy(null);
        return;
      }
      await finish([item.id], "accepted");
      toast("Added to your numbers.");
    } catch (err) {
      toast(`Couldn't add that: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const merge = async (item: InboxItem, localId: string) => {
    setBusy(item.id);
    try {
      await finish([item.id], "merged", localId);
      toast("Marked as the same transaction. Nothing double-counted.");
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

  const sorted = [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <Sheet open={open} onClose={onClose} title="Review bank transactions" size="wide">
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading transactions...</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground">Nothing waiting for review.</div>
      ) : (
        <div className="grid gap-3">
          {sorted.map((item) => {
            const map = mappingFor(item.plaidAccountId);
            const dup = duplicateFor(item);
            const chosen =
              catFor[item.id] ?? guessCategory([item.plaidCategory, item.merchantName, item.name], categories);
            return (
              <div key={item.id} className="rounded-2xl border border-border p-3 grid gap-2">
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
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => accept(item, chosen)}
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
