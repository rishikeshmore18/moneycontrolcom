import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useApp } from "@/lib/cashflow/AppContext";
import type { Transaction } from "@/lib/cashflow/types";
import { validCardPayment } from "@/lib/cashflow/cardPaymentLedger";
import { formatMoney } from "@/lib/cashflow/money";
import { plaidListConnections, plaidRelinkActivity } from "@/lib/plaid/plaid.functions";
import { applyBankBalances } from "@/lib/plaid/bankBalances";
import { Button } from "./Button";
import { Field, Input, Select, Textarea } from "./Field";
import { Sheet } from "./Sheet";
import { toast } from "./Toast";

/** One transfer, two posting confirmations. Never changes a bank-reported balance. */
export function CardPaymentEditor({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const listConnections = useServerFn(plaidListConnections);
  const relink = useServerFn(plaidRelinkActivity);
  const converting = tx.type === "expense";
  const confirmed = !!(tx.cardPayment?.bankCreditId || tx.cardPayment?.bankDebitId);
  const [cardId, setCardId] = useState(tx.cardId ?? "");
  const [sourceAccountId, setSourceAccountId] = useState(tx.sourceAccountId ?? "");
  const [amount, setAmount] = useState(String(tx.amount));
  const [date, setDate] = useState(tx.date);
  const [notes, setNotes] = useState(tx.notes ?? "");
  const [cashPosted, setCashPosted] = useState(tx.cardPayment?.cashPosted ?? true);
  const [cardPosted, setCardPosted] = useState(tx.cardPayment?.cardPosted ?? false);
  const [mergeId, setMergeId] = useState("");
  const [view, setView] = useState<"edit" | "save" | "delete">("edit");
  const [busy, setBusy] = useState(false);
  const card = state.cards.find((item) => item.id === cardId);
  const account = state.accounts.find((item) => item.id === sourceAccountId);
  const payload = { cardId, sourceAccountId, amount: Number(amount), date, notes, cashPosted, cardPosted };
  const candidates = converting ? state.transactions.filter((item) => item.type === "card_payment" &&
    item.cardId === cardId && item.sourceAccountId === tx.sourceAccountId &&
    Math.round(item.amount * 100) === Math.round(tx.amount * 100)) : [];
  const canSave = validCardPayment(state, payload) && (!mergeId || candidates.some((item) => item.id === mergeId));
  const money = (value: number) => formatMoney(value, state.profile.currency);

  async function confirm() {
    if (busy || (view !== "delete" && !canSave)) return;
    setBusy(true);
    try {
      // Refresh authority before any reversal, especially for records created before posting metadata existed.
      const connections = await listConnections();
      applyBankBalances(connections, state.accounts, state.cards, dispatch);
      if (view === "delete") {
        await relink({ data: { removedId: tx.id } });
        dispatch({ type: "DELETE_TRANSACTION", id: tx.id });
      } else if (converting) {
        if (mergeId) await relink({ data: { removedId: tx.id, keptId: mergeId } });
        dispatch({ type: "CONVERT_CARD_PAYMENT", id: tx.id, payload, mergeIntoId: mergeId || undefined });
      } else {
        dispatch({ type: "UPDATE_CARD_PAYMENT", id: tx.id, payload });
      }
      toast(view === "delete" ? "Payment removed from Activity. This does not cancel a bank payment."
        : mergeId ? "Linked to the existing card payment." : "Card payment updated.");
      onClose();
    } catch (error) {
      toast(`Couldn't update the payment: ${error instanceof Error ? error.message : String(error)}. Nothing was removed.`);
    } finally { setBusy(false); }
  }

  return <Sheet open onClose={() => { if (!busy) onClose(); }}
    title={view === "delete" ? "Delete card payment?" : view === "save" ? "Confirm card payment" : converting ? "Assign to card payment" : "Edit card payment"}
    footer={view === "edit" ? <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      {!converting && <Button variant="danger" onClick={() => setView("delete")}>Delete payment</Button>}
      <Button variant="primary" disabled={!canSave} onClick={() => setView("save")}>Review changes</Button>
    </> : <>
      <Button variant="ghost" disabled={busy} onClick={() => setView("edit")}>Back</Button>
      <Button variant={view === "delete" ? "danger" : "primary"} disabled={busy} onClick={() => void confirm()}>
        {busy ? "Saving..." : view === "delete" ? "Delete payment" : mergeId ? "Merge payment" : "Confirm changes"}
      </Button>
    </>}>
    {view === "delete" ? <p role="alert" className="text-sm leading-relaxed">
      Remove {money(tx.amount)} to {card?.name ?? "this card"} from Activity? Local balance changes will be reversed.
      Synced bank and card balances will not change. This does not cancel the real payment, and cannot be undone.
    </p> : view === "save" ? <div className="space-y-3 text-sm leading-relaxed">
      <p>{money(Number(amount))} from <strong>{account?.name}</strong> to <strong>{card?.name}</strong>.</p>
      <p>{mergeId ? "This expense will become part of the existing payment, not a second payment."
        : "This is a transfer to your card, not a new purchase expense."}</p>
      <p>Bank-reported balances will stay unchanged. While a posting is unconfirmed, Spendable Today keeps a conservative reserve. Confirm posting only when your account or card actually reflects it.</p>
    </div> : <div className="grid min-w-0 gap-4 [&_label]:min-w-0 [&_input]:min-w-0 [&_select]:min-w-0">
      {!tx.cardPayment && !converting && <p className="text-sm text-[color:var(--warn)]">This older payment has no posting confirmations. Check the source and card status below. Its original record may have reduced the balance before the card received it.</p>}
      <Field label="Paid to card"><Select value={cardId} disabled={confirmed} onChange={(event) => { setCardId(event.target.value); setMergeId(""); }}>
        <option value="">Choose card</option>
        {state.cards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select></Field>
      <Field label="Paid from"><Select value={sourceAccountId} disabled={confirmed || converting} onChange={(event) => setSourceAccountId(event.target.value)}>
        <option value="">Choose account or cash wallet</option>
        {state.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select></Field>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Amount"><Input type="number" min="0.01" step="0.01" value={amount} disabled={confirmed || converting} onChange={(event) => setAmount(event.target.value)} /></Field>
        <Field label="Payment date"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      </div>
      {confirmed && <p className="text-sm text-muted-foreground">The amount, source and card are linked to bank evidence and cannot be overwritten here. Deleting removes the app record, not the real bank payment.</p>}
      <Field label="Money leaving the payment account"><Select value={cashPosted ? "posted" : "pending"} disabled={!!tx.cardPayment?.bankDebitId || converting} onChange={(event) => setCashPosted(event.target.value === "posted")}>
        <option value="pending">Not reflected yet: reserve this money</option>
        <option value="posted">Already reflected in the account / cash wallet</option>
      </Select></Field>
      <Field label="Payment reaching the card"><Select value={cardPosted ? "posted" : "pending"} disabled={!!tx.cardPayment?.bankCreditId} onChange={(event) => setCardPosted(event.target.value === "posted")}>
        <option value="pending">Not reflected yet: awaiting card confirmation</option>
        <option value="posted">{card?.bankLinked ? "Already reflected on the synced card" : "Posted: apply payment to the tracked card balance"}</option>
      </Select></Field>
      <p className="text-sm text-muted-foreground">Pending payments do not erase the remaining card debt. The forecast may temporarily reserve extra until both sides are confirmed. A bank sync will match a unique posted payment automatically; uncertain matches stay in Review.</p>
      {converting && <Field label="Existing payment"><Select value={mergeId} onChange={(event) => setMergeId(event.target.value)}>
        <option value="">Reclassify this expense as one payment</option>
        {candidates.map((item) => <option key={item.id} value={item.id}>Merge with {item.date} · {money(item.amount)}</option>)}
      </Select></Field>}
      <Field label="Note"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
    </div>}
  </Sheet>;
}
