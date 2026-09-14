import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, RefreshCw, Inbox, Unlink, AlertTriangle } from "lucide-react";
import { Card } from "./Card";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { Select } from "./Field";
import { toast } from "./Toast";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney } from "@/lib/cashflow/money";
import { todayISO } from "@/lib/cashflow/dates";
import {
  plaidCreateLinkToken,
  plaidExchangeToken,
  plaidLinkAccount,
  plaidListConnections,
  plaidListInbox,
  plaidResolveInbox,
  plaidSyncAll,
  plaidUnlinkItem,
  type Connection,
  type InboxItem,
} from "@/lib/plaid/plaid.functions";
import { applyBankBalances } from "@/lib/plaid/bankBalances";
import { guessCategory } from "@/lib/plaid/categoryGuess";

const PlaidLinkButton = lazy(() => import("./PlaidLinkButton"));

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function PlaidConnectionsCard() {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;

  const listConnections = useServerFn(plaidListConnections);
  const createLinkToken = useServerFn(plaidCreateLinkToken);
  const exchangeToken = useServerFn(plaidExchangeToken);
  const syncAll = useServerFn(plaidSyncAll);
  const linkAccount = useServerFn(plaidLinkAccount);
  const unlinkItem = useServerFn(plaidUnlinkItem);
  const listInbox = useServerFn(plaidListInbox);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);

  const stateRef = useRef({ accounts: state.accounts, cards: state.cards, dispatch });
  stateRef.current = { accounts: state.accounts, cards: state.cards, dispatch };

  const refresh = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([listConnections(), listInbox()]);
      setConnections(c);
      setInbox(
        [...i].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
      );
      applyBankBalances(c, stateRef.current.accounts, stateRef.current.cards, stateRef.current.dispatch);
    } catch (err) {
      console.error("[plaid] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [listConnections, listInbox]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startLink = async (itemRowId?: string) => {
    setBusy("link");
    try {
      const res = await createLinkToken({ data: itemRowId ? { itemRowId } : {} });
      setLinkToken(res.linkToken);
    } catch (err) {
      toast(`Couldn't start the bank connection: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const finishLink = async (publicToken: string, institutionId?: string, institutionName?: string) => {
    setLinkToken(null);
    setBusy("exchange");
    try {
      await exchangeToken({ data: { publicToken, institutionId, institutionName } });
      toast("Bank connected. Pulling your accounts...");
      await refresh();
    } catch (err) {
      toast(`Connection failed: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const doSync = async () => {
    setBusy("sync");
    try {
      const res = await syncAll();
      toast(
        res.failed.length
          ? `Synced with ${res.failed.length} problem(s).`
          : `Synced. ${res.added} new transaction(s) to review.`,
      );
      await refresh();
    } catch (err) {
      toast(`Sync failed: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const doUnlink = async (itemRowId: string) => {
    if (!confirm("Disconnect this bank? Your history stays, it just stops syncing.")) return;
    setBusy(itemRowId);
    try {
      await unlinkItem({ data: { itemRowId } });
      await refresh();
      toast("Bank disconnected.");
    } catch (err) {
      toast(`Couldn't disconnect: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const setMapping = async (plaidRowId: string, value: string) => {
    const [kind, id] = value ? value.split(":") : ["", ""];
    setBusy(plaidRowId);
    try {
      await linkAccount({
        data: {
          plaidRowId,
          localId: id || null,
          localKind: (kind === "account" || kind === "card" ? kind : null) as
            | "account"
            | "card"
            | null,
        },
      });
      await refresh();
    } catch (err) {
      toast(`Couldn't save that: ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const allAccounts = useMemo(
    () => connections.flatMap((c) => c.accounts),
    [connections],
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-extrabold flex items-center gap-2">
          <Building2 size={18} /> Bank connections
        </h3>
        <div className="flex flex-wrap gap-2">
          {inbox.length > 0 && (
            <Button variant="soft" onClick={() => setInboxOpen(true)}>
              <Inbox size={16} /> Review {inbox.length}
            </Button>
          )}
          <Button variant="ghost" onClick={doSync} disabled={busy === "sync" || !connections.length}>
            <RefreshCw size={16} /> {busy === "sync" ? "Syncing..." : "Sync"}
          </Button>
          <Button variant="primary" onClick={() => startLink()} disabled={busy === "link"}>
            Connect bank
          </Button>
        </div>
      </div>

      {linkToken && (
        <Suspense fallback={null}>
          <div className="mb-3">
            <PlaidLinkButton
              linkToken={linkToken}
              label="Open secure bank login"
              onExchange={finishLink}
              onExit={() => setLinkToken(null)}
            />
          </div>
        </Suspense>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading connections...</div>
      ) : connections.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No banks connected yet. Manual and cash entries keep working exactly as they do now.
        </div>
      ) : (
        <div className="grid gap-3">
          {connections.map((c) => (
            <div key={c.id} className="rounded-2xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-bold">{c.institutionName ?? "Bank"}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.lastSyncedAt
                      ? `Last synced ${new Date(c.lastSyncedAt).toLocaleString()}`
                      : "Not synced yet"}
                  </div>
                </div>
                <div className="flex gap-2">
                  {c.status !== "good" && (
                    <Button variant="primary" onClick={() => startLink(c.id)}>
                      Reconnect
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => doUnlink(c.id)} disabled={busy === c.id}>
                    <Unlink size={16} /> Disconnect
                  </Button>
                </div>
              </div>

              {c.status !== "good" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-[color:var(--warn)]">
                  <AlertTriangle size={14} />
                  {c.errorMessage ?? "This bank needs attention."}
                </div>
              )}

              <div className="mt-3 grid gap-2">
                {c.accounts.map((a) => (
                  <div
                    key={a.id}
                    className="grid gap-2 sm:grid-cols-[1fr_auto_200px] sm:items-center"
                  >
                    <div>
                      <div className="font-semibold text-sm">
                        {a.name}
                        {a.mask ? ` ••${a.mask}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.subtype ?? a.type ?? "account"}
                      </div>
                    </div>
                    <div className="font-black text-sm">
                      {a.currentBalance == null ? "—" : formatMoney(a.currentBalance, cur)}
                    </div>
                    <Select
                      value={a.linkedLocalId ? `${a.linkedLocalKind}:${a.linkedLocalId}` : ""}
                      onChange={(e) => setMapping(a.id, e.target.value)}
                    >
                      <option value="">Not linked in app</option>
                      {state.accounts.map((acc) => (
                        <option key={acc.id} value={`account:${acc.id}`}>
                          Account · {acc.name}
                        </option>
                      ))}
                      {state.cards.map((card) => (
                        <option key={card.id} value={`card:${card.id}`}>
                          Card · {card.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Bank balances are read-only. Nothing from your bank changes your numbers until you accept it
        in the review list.
      </p>

      <InboxSheet
        open={inboxOpen}
        onClose={() => {
          setInboxOpen(false);
          void refresh();
        }}
        items={inbox}
        accounts={allAccounts}
        onResolved={refresh}
        dispatch={dispatch}
        state={state}
      />
    </Card>
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
}: {
  open: boolean;
  onClose: () => void;
  items: InboxItem[];
  accounts: Connection["accounts"];
  onResolved: () => Promise<void> | void;
  dispatch: AppCtx["dispatch"];
  state: AppCtx["state"];
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
      {items.length === 0 ? (
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
