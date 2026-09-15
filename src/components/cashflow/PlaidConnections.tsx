import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, RefreshCw, Unlink, AlertTriangle } from "lucide-react";
import { Card } from "./Card";
import { Button } from "./Button";
import { Select } from "./Field";
import { toast } from "./Toast";
import { PlaidReviewButton } from "./PlaidInbox";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney } from "@/lib/cashflow/money";
import {
  plaidCreateLinkToken,
  plaidExchangeToken,
  plaidLinkAccount,
  plaidListConnections,
  plaidSyncAll,
  plaidUnlinkItem,
  type Connection,
} from "@/lib/plaid/plaid.functions";
import { applyBankBalances } from "@/lib/plaid/bankBalances";

const PlaidLinkButton = lazy(() => import("./PlaidLinkButton"));

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

export function PlaidConnectionsCard() {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;

  const listConnections = useServerFn(plaidListConnections);
  const createLinkToken = useServerFn(plaidCreateLinkToken);
  const exchangeToken = useServerFn(plaidExchangeToken);
  const syncAll = useServerFn(plaidSyncAll);
  const linkAccount = useServerFn(plaidLinkAccount);
  const unlinkItem = useServerFn(plaidUnlinkItem);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const stateRef = useRef({ accounts: state.accounts, cards: state.cards, dispatch });
  stateRef.current = { accounts: state.accounts, cards: state.cards, dispatch };

  const refresh = useCallback(async () => {
    try {
      const c = await listConnections();
      setConnections(c);
      applyBankBalances(c, stateRef.current.accounts, stateRef.current.cards, stateRef.current.dispatch);
    } catch (err) {
      console.error("[plaid] load failed", err);
    } finally {
      setLoading(false);
    }
  }, [listConnections]);

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

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-extrabold flex items-center gap-2">
          <Building2 size={18} /> Bank connections
        </h3>
        <div className="flex flex-wrap gap-2">
          <PlaidReviewButton variant="soft" />
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
    </Card>
  );
}

