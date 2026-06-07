import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { Field, Input, Select } from "./Field";
import { Button } from "./Button";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney, toNumber } from "@/lib/cashflow/money";
import { todayISO } from "@/lib/cashflow/dates";
import { recommendCardForCategory, availableCredit } from "@/lib/cashflow/cardLogic";
import { toast } from "./Toast";

const CATEGORIES = [
  "Groceries",
  "Gas",
  "Dining",
  "Entertainment",
  "Bills",
  "Shopping",
  "Travel",
  "Health",
  "Subscriptions",
  "Other",
];

export function ExpenseForm({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useApp();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Groceries");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<"credit_card" | "debit" | "cash" | "other">("debit");
  const [cardId, setCardId] = useState<string>("");
  const [sourceAccountId, setSourceAccountId] = useState<string>("");

  const amt = toNumber(amount);
  const cur = state.profile.currency;

  const cashAccount = state.accounts.find((a) => a.type === "cash");
  const nonCashAccounts = state.accounts.filter((a) => a.type !== "cash");

  const recommendation = useMemo(
    () => (method === "credit_card" && amt > 0 ? recommendCardForCategory(state, category, amt) : null),
    [state, category, method, amt],
  );

  const chosenAccount = state.accounts.find(
    (a) => a.id === (method === "cash" ? cashAccount?.id : sourceAccountId),
  );
  const overdraft = chosenAccount && amt > chosenAccount.balance;
  const chosenCard = state.cards.find((c) => c.id === cardId);
  const overLimit = chosenCard && amt > availableCredit(chosenCard);

  function submit() {
    if (amt <= 0) return toast("Enter an amount");
    if (method === "credit_card" && !cardId) return toast("Select a card");
    if (method === "debit" && !sourceAccountId) return toast("Select an account");
    if (method === "cash" && !cashAccount) return toast("Add a cash account first");

    dispatch({
      type: "ADD_EXPENSE",
      payload: {
        amount: amt,
        category,
        description,
        date,
        method,
        cardId: method === "credit_card" ? cardId : undefined,
        sourceAccountId:
          method === "debit" ? sourceAccountId : method === "cash" ? cashAccount?.id : undefined,
      },
    });
    toast(`Expense logged · ${formatMoney(amt, cur)}`);
    onDone();
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Category">
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Description (optional)">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it?" />
      </Field>
      <Field label="Payment method">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(
            [
              ["credit_card", "Credit card"],
              ["debit", "Debit / bank"],
              ["cash", "Cash"],
              ["other", "Other"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMethod(id)}
              className={`px-3 py-2.5 rounded-2xl text-sm font-bold border transition ${
                method === id
                  ? "border-primary brand-gradient text-primary-foreground"
                  : "border-border bg-[color:var(--card-solid)] text-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      {method === "credit_card" && (
        <>
          {state.cards.length === 0 ? (
            <Notice tone="warn">No cards yet. Add one in your profile first.</Notice>
          ) : (
            <Field label="Card">
              <Select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                <option value="">Pick a card…</option>
                {state.cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · avail {formatMoney(availableCredit(c), cur)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {recommendation && (
            <Notice tone="info">
              💡 Suggested: <b>{recommendation.card.name}</b> — {recommendation.reason}.{" "}
              <button
                className="underline font-bold"
                onClick={() => setCardId(recommendation.card.id)}
              >
                Use this card
              </button>
            </Notice>
          )}
          {overLimit && <Notice tone="bad">Over available credit on this card.</Notice>}
        </>
      )}

      {method === "debit" && (
        <Field label="Source account">
          <Select value={sourceAccountId} onChange={(e) => setSourceAccountId(e.target.value)}>
            <option value="">Pick an account…</option>
            {nonCashAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName} {a.name} · {a.type} · {formatMoney(a.balance, cur)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {method === "cash" && !cashAccount && (
        <Notice tone="warn">No cash account exists. Add one in profile.</Notice>
      )}

      {overdraft && <Notice tone="warn">This will overdraw the selected account.</Notice>}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save expense</Button>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn" | "bad"; children: React.ReactNode }) {
  const map = {
    info: "bg-primary/10 border-primary/25 text-foreground",
    warn: "bg-[color:var(--warn)]/10 border-[color:var(--warn)]/30 text-foreground",
    bad: "bg-[color:var(--bad)]/10 border-[color:var(--bad)]/30 text-foreground",
  } as const;
  return <div className={`rounded-2xl border p-3 text-sm ${map[tone]}`}>{children}</div>;
}

/* ----- Wrapper modal that switches sub-flows ----- */
type Flow = "menu" | "expense" | "card_payment" | "transfer" | "adjustment" | "shift" | "mark_paid";

export function QuickAddModal({
  open,
  onClose,
  initialFlow,
  setTab,
}: {
  open: boolean;
  onClose: () => void;
  initialFlow?: Flow;
  setTab: (t: "income") => void;
}) {
  const [flow, setFlow] = useState<Flow>(initialFlow ?? "menu");
  function close() {
    setFlow("menu");
    onClose();
  }
  const titles: Record<Flow, string> = {
    menu: "Quick add",
    expense: "Add expense",
    card_payment: "Pay credit card",
    transfer: "Transfer money",
    adjustment: "Manual adjustment",
    shift: "Add shift / time off",
    mark_paid: "Mark pay received",
  };
  return (
    <Sheet open={open} onClose={close} title={titles[flow]}>
      {flow === "menu" && (
        <div className="grid gap-2.5">
          <MenuBtn label="Add expense" onClick={() => setFlow("expense")} />
          <MenuBtn label="Pay credit card bill" onClick={() => setFlow("card_payment")} />
          <MenuBtn
            label="Add work shift / time off"
            onClick={() => {
              setTab("income");
              close();
            }}
          />
          <MenuBtn
            label="Mark pay received"
            onClick={() => {
              setTab("income");
              close();
            }}
          />
          <MenuBtn label="Transfer money" onClick={() => setFlow("transfer")} />
          <MenuBtn label="Manual adjustment" onClick={() => setFlow("adjustment")} />
        </div>
      )}
      {flow === "expense" && <ExpenseForm onDone={close} />}
      {flow === "card_payment" && <CardPaymentForm onDone={close} />}
      {flow === "transfer" && <TransferForm onDone={close} />}
      {flow === "adjustment" && <AdjustmentForm onDone={close} />}
    </Sheet>
  );
}

function MenuBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-4 rounded-2xl border border-border bg-[color:var(--card-solid)] font-bold hover:bg-muted hover:-translate-y-0.5 transition"
    >
      {label}
    </button>
  );
}

/* ----- Card payment ----- */
function CardPaymentForm({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [cardId, setCardId] = useState(state.cards[0]?.id ?? "");
  const card = state.cards.find((c) => c.id === cardId);
  const [mode, setMode] = useState<"minimum" | "statement" | "current" | "target" | "custom">("minimum");
  const [custom, setCustom] = useState("");
  const [sourceAccountId, setSourceAccountId] = useState(state.accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());

  if (state.cards.length === 0) return <div className="text-sm text-muted-foreground">No cards configured.</div>;
  if (state.accounts.length === 0) return <div className="text-sm text-muted-foreground">No accounts to pay from.</div>;

  const target = card ? (card.targetUtilizationPercent / 100) * card.limit : 0;
  const toTarget = card ? Math.max(0, card.currentBalance - target) : 0;

  const amounts = card
    ? {
        minimum: Math.min(card.minimumDue, card.currentBalance),
        statement: Math.min(card.statementBalance, card.currentBalance),
        current: card.currentBalance,
        target: toTarget,
        custom: toNumber(custom),
      }
    : { minimum: 0, statement: 0, current: 0, target: 0, custom: toNumber(custom) };

  const payAmount = amounts[mode];

  function submit() {
    if (!card) return;
    if (payAmount <= 0) return toast("Enter a positive amount");
    dispatch({
      type: "PAY_CREDIT_CARD",
      payload: { cardId: card.id, amount: payAmount, sourceAccountId, date },
    });
    toast(`Paid ${formatMoney(payAmount, cur)} to ${card.name}`);
    onDone();
  }

  return (
    <div className="grid gap-4">
      <Field label="Card">
        <Select value={cardId} onChange={(e) => setCardId(e.target.value)}>
          {state.cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · bal {formatMoney(c.currentBalance, cur)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["minimum", "Minimum"],
            ["statement", "Statement"],
            ["current", "Pay in full"],
            ["target", "To target"],
            ["custom", "Custom"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`px-3 py-3 rounded-2xl text-sm font-bold border transition ${
              mode === id
                ? "border-primary brand-gradient text-primary-foreground"
                : "border-border bg-[color:var(--card-solid)] hover:bg-muted"
            }`}
          >
            <div>{label}</div>
            <div className="text-xs opacity-80 font-medium">
              {formatMoney(amounts[id as keyof typeof amounts], cur)}
            </div>
          </button>
        ))}
      </div>

      {mode === "custom" && (
        <Field label="Custom amount">
          <Input
            type="number"
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </Field>
      )}

      <Field label="Pay from">
        <Select value={sourceAccountId} onChange={(e) => setSourceAccountId(e.target.value)}>
          {state.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.bankName} {a.name} · {a.type} · {formatMoney(a.balance, cur)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Date">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={submit}>
          Pay {formatMoney(payAmount, cur)}
        </Button>
      </div>
    </div>
  );
}

/* ----- Transfer ----- */
function TransferForm({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [fromId, setFromId] = useState(state.accounts[0]?.id ?? "");
  const [toId, setToId] = useState(state.accounts[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  function submit() {
    const amt = toNumber(amount);
    if (amt <= 0) return toast("Enter an amount");
    if (!fromId || !toId || fromId === toId) return toast("Pick two different accounts");
    dispatch({
      type: "ADD_TRANSFER",
      payload: { fromAccountId: fromId, toAccountId: toId, amount: amt, date, notes },
    });
    toast(`Transferred ${formatMoney(amt, cur)}`);
    onDone();
  }

  if (state.accounts.length < 2) return <div className="text-sm text-muted-foreground">Need at least 2 accounts.</div>;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {formatMoney(a.balance, cur)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="To">
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {formatMoney(a.balance, cur)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount">
          <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Transfer</Button>
      </div>
    </div>
  );
}

/* ----- Adjustment ----- */
function AdjustmentForm({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useApp();
  const cur = state.profile.currency;
  const [target, setTarget] = useState<"account" | "card">("account");
  const [id, setId] = useState(state.accounts[0]?.id ?? "");
  const [newBalance, setNewBalance] = useState("");
  const [reason, setReason] = useState("bank correction");
  const [notes, setNotes] = useState("");

  const options = target === "account" ? state.accounts : state.cards;

  function submit() {
    const nb = toNumber(newBalance);
    if (!id) return toast("Pick a target");
    dispatch({
      type: "ADD_ADJUSTMENT",
      payload: {
        accountId: target === "account" ? id : undefined,
        cardId: target === "card" ? id : undefined,
        newBalance: nb,
        reason,
        notes,
        date: todayISO(),
      },
    });
    toast("Adjustment saved");
    onDone();
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2">
        {(["account", "card"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTarget(t);
              setId(t === "account" ? state.accounts[0]?.id ?? "" : state.cards[0]?.id ?? "");
            }}
            className={`px-3 py-2.5 rounded-2xl text-sm font-bold border transition capitalize ${
              target === t
                ? "border-primary brand-gradient text-primary-foreground"
                : "border-border bg-[color:var(--card-solid)] hover:bg-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <Field label={target === "account" ? "Account" : "Card"}>
        <Select value={id} onChange={(e) => setId(e.target.value)}>
          {options.map((o) => {
            const bal = "balance" in o ? o.balance : o.currentBalance;
            return (
              <option key={o.id} value={o.id}>
                {o.name} · {formatMoney(bal, cur)}
              </option>
            );
          })}
        </Select>
      </Field>
      <Field label="New balance">
        <Input type="number" inputMode="decimal" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} />
      </Field>
      <Field label="Reason">
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>bank correction</option>
          <option>missing transaction</option>
          <option>cash correction</option>
          <option>other</option>
        </Select>
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save adjustment</Button>
      </div>
    </div>
  );
}
