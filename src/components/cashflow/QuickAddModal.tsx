import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { Field, Input, Select } from "./Field";
import { Button } from "./Button";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney, toNumber } from "@/lib/cashflow/money";
import { todayISO } from "@/lib/cashflow/dates";
import {
  recommendCardForCategory,
  availableCredit,
  cycleForDate,
  expensesInCycle,
} from "@/lib/cashflow/cardLogic";
import { isSpendableAccount, plannedDebtPayment, expensesComingBreakdown } from "@/lib/cashflow/forecast";
import type { CashFlowBreakdownItem } from "@/lib/cashflow/forecast";
import { toast } from "./Toast";

type ExpenseMethod = "credit_card" | "debit" | "cash" | "debt_payment" | "other";
type SourcePickerKind = "card" | "account" | null;

export function ExpenseForm({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useApp();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Groceries");
  const [otherCategory, setOtherCategory] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<ExpenseMethod | null>(null);
  const [sourcePicker, setSourcePicker] = useState<SourcePickerKind>(null);
  const [cardId, setCardId] = useState<string>("");
  const [debtId, setDebtId] = useState<string>("");
  const [sourceAccountId, setSourceAccountId] = useState<string>("");

  const amt = toNumber(amount);
  const cur = state.profile.currency;

  const cashAccount = state.accounts.find((a) => a.type === "cash" && isSpendableAccount(a));
  const nonCashAccounts = state.accounts.filter((a) => a.type !== "cash" && isSpendableAccount(a));
  const categories = state.categories?.length ? state.categories : ["Groceries", "Other"];
  const selectedCategory =
    category === "Other" && otherCategory.trim() ? otherCategory.trim() : category;
  const activeDebts = state.debts.filter((d) => d.status === "active" && d.balance > 0);
  const chosenDebt = state.debts.find((d) => d.id === debtId);

  const recommendation = useMemo(
    () =>
      method === "credit_card" && amt > 0
        ? recommendCardForCategory(state, selectedCategory, amt)
        : null,
    [state, selectedCategory, method, amt],
  );

  const chosenAccount = state.accounts.find(
    (a) => a.id === (method === "cash" ? cashAccount?.id : sourceAccountId),
  );
  const overdraft = chosenAccount && amt > chosenAccount.balance;
  const chosenCard = state.cards.find((c) => c.id === cardId);
  const overLimit = chosenCard && amt > availableCredit(chosenCard);

  function chooseMethod(nextMethod: ExpenseMethod) {
    setMethod(nextMethod);
    if (nextMethod === "credit_card" && state.cards.length > 0) {
      setSourcePicker("card");
      return;
    }
    if ((nextMethod === "debit" || nextMethod === "debt_payment") && nonCashAccounts.length > 0) {
      setSourcePicker("account");
      return;
    }
    setSourcePicker(null);
  }

  function submit() {
    if (amt <= 0) return toast("Enter an amount");
    if (!method) return toast("Choose a payment method");
    if (method === "credit_card" && !cardId) return toast("Select a card");
    if ((method === "debit" || method === "debt_payment") && !sourceAccountId)
      return toast("Select an account");
    if (method === "debt_payment" && !debtId) return toast("Select a debt");
    if (method === "cash" && !cashAccount) return toast("Add a cash account first");

    if (method === "debt_payment") {
      dispatch({
        type: "PAY_DEBT",
        payload: {
          debtId,
          amount: amt,
          sourceAccountId,
          date,
          notes: description,
        },
      });
      toast(`Debt payment logged Â· ${formatMoney(amt, cur)}`);
      onDone();
      return;
    }

    dispatch({
      type: "ADD_EXPENSE",
      payload: {
        amount: amt,
        category: selectedCategory,
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
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      {category === "Other" && (
        <Field label="Category name" hint="Leave blank to keep this as Other.">
          <Input
            value={otherCategory}
            onChange={(e) => setOtherCategory(e.target.value)}
            placeholder="e.g. Parking, Laundry"
          />
        </Field>
      )}
      <Field label="Description (optional)">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was it?"
        />
      </Field>
      <Field label="Payment method">
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["credit_card", "Credit card"],
                ["debit", "Debit / bank"],
                ["cash", "Cash"],
                ["debt_payment", "Debt payment"],
                ["other", "Other"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => chooseMethod(id)}
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
          {method === "credit_card" && chosenCard && (
            <SelectedSourceCard
              label="Selected card"
              title={chosenCard.name}
              detail={`Available ${formatMoney(availableCredit(chosenCard), cur)}`}
              onChange={() => setSourcePicker("card")}
            />
          )}
          {(method === "debit" || method === "debt_payment") && chosenAccount && (
            <SelectedSourceCard
              label="Selected account"
              title={
                chosenAccount.bankName
                  ? `${chosenAccount.bankName} ${chosenAccount.name}`
                  : chosenAccount.name
              }
              detail={`${chosenAccount.type} · ${formatMoney(chosenAccount.balance, cur)}`}
              onChange={() => setSourcePicker("account")}
            />
          )}
        </div>
      </Field>

      {method === "credit_card" && (
        <>
          {state.cards.length === 0 ? (
            <Notice tone="warn">No cards yet. Add one in your profile first.</Notice>
          ) : null}
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

      {method === "debt_payment" && (
        <>
          {activeDebts.length === 0 ? (
            <Notice tone="warn">No active debts to pay. Add one in Profile first.</Notice>
          ) : (
            <Field label="Debt">
              <Select value={debtId} onChange={(e) => setDebtId(e.target.value)}>
                <option value="">Pick a debtâ€¦</option>
                {activeDebts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} Â· bal {formatMoney(d.balance, cur)} Â· plan{" "}
                    {formatMoney(plannedDebtPayment(d), cur)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {chosenDebt && (
            <Notice tone="info">
              Monthly plan for <b>{chosenDebt.name}</b>:{" "}
              <button
                className="underline font-bold"
                onClick={() => setAmount(String(plannedDebtPayment(chosenDebt)))}
              >
                Use {formatMoney(plannedDebtPayment(chosenDebt), cur)}
              </button>
            </Notice>
          )}
        </>
      )}

      {method === "cash" && !cashAccount && (
        <Notice tone="warn">No cash account exists. Add one in profile.</Notice>
      )}

      {(method === "debit" || method === "debt_payment") && nonCashAccounts.length === 0 && (
        <Notice tone="warn">No spendable bank accounts available. Add one in Profile first.</Notice>
      )}

      {overdraft && <Notice tone="warn">This will overdraw the selected account.</Notice>}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          {method === "debt_payment" ? "Save debt payment" : "Save expense"}
        </Button>
      </div>
      {sourcePicker === "card" && (
        <SourcePickerDialog
          title="Select card"
          onClose={() => setSourcePicker(null)}
          items={state.cards.map((card) => ({
            id: card.id,
            title: card.name,
            detail: `Available ${formatMoney(availableCredit(card), cur)}`,
          }))}
          selectedId={cardId}
          onSelect={(id) => {
            setCardId(id);
            setSourcePicker(null);
          }}
        />
      )}
      {sourcePicker === "account" && (
        <SourcePickerDialog
          title="Select account"
          onClose={() => setSourcePicker(null)}
          items={nonCashAccounts.map((account) => ({
            id: account.id,
            title: account.bankName ? `${account.bankName} ${account.name}` : account.name,
            detail: `${account.type} · ${formatMoney(account.balance, cur)}`,
          }))}
          selectedId={sourceAccountId}
          onSelect={(id) => {
            setSourceAccountId(id);
            setSourcePicker(null);
          }}
        />
      )}
    </div>
  );
}

function SelectedSourceCard({
  label,
  title,
  detail,
  onChange,
}: {
  label: string;
  title: string;
  detail: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="rounded-2xl border border-border bg-[color:var(--card-solid)] px-4 py-3 text-left transition hover:bg-muted"
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-bold">{title}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </button>
  );
}

function SourcePickerDialog({
  title,
  items,
  selectedId,
  onSelect,
  onClose,
}: {
  title: string;
  items: { id: string; title: string; detail: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/65 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-[color:var(--card-solid)] p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-black">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-muted text-lg leading-none text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
            aria-label={`Close ${title}`}
          >
            x
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {items.map((item) => {
            const selected = selectedId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition ${
                  selected
                    ? "border-primary brand-gradient text-primary-foreground"
                    : "border-border bg-[color:var(--card-solid)] hover:bg-muted"
                }`}
              >
                <div className="font-bold">{item.title}</div>
                <div
                  className={`text-xs ${
                    selected ? "text-primary-foreground/80" : "text-muted-foreground"
                  }`}
                >
                  {item.detail}
                </div>
              </button>
            );
          })}
        </div>
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
  const [mode, setMode] = useState<
    "cycle" | "minimum" | "statement" | "current" | "target" | "custom"
  >("cycle");
  const [custom, setCustom] = useState("");
  const spendableAccounts = state.accounts.filter(isSpendableAccount);
  const [sourceAccountId, setSourceAccountId] = useState(spendableAccounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());

  if (state.cards.length === 0)
    return <div className="text-sm text-muted-foreground">No cards configured.</div>;
  if (spendableAccounts.length === 0)
    return <div className="text-sm text-muted-foreground">No spendable accounts to pay from.</div>;

  const target = card ? (card.targetUtilizationPercent / 100) * card.limit : 0;
  const toTarget = card ? Math.max(0, card.currentBalance - target) : 0;
  const cycle = card ? cycleForDate(card, date) : null;
  const cycleExpenses = card && cycle ? expensesInCycle(state.transactions, card.id, cycle) : [];
  const cycleTotal = cycleExpenses.reduce((s, t) => s + t.amount, 0);

  const amounts = card
    ? {
        cycle: Math.min(cycleTotal, card.currentBalance),
        minimum: Math.min(card.minimumDue, card.currentBalance),
        statement: Math.min(card.statementBalance, card.currentBalance),
        current: card.currentBalance,
        target: toTarget,
        custom: toNumber(custom),
      }
    : { cycle: 0, minimum: 0, statement: 0, current: 0, target: 0, custom: toNumber(custom) };

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

      {card && cycle && (
        <div className="rounded-2xl border border-border bg-muted/40 p-3 text-xs">
          <div className="font-bold text-sm mb-1">Billing cycle for this payment</div>
          <div className="text-muted-foreground">
            Cycle <b className="text-foreground">{cycle.cycleStart}</b> →{" "}
            <b className="text-foreground">{cycle.cycleEnd}</b>
            {" · "}due <b className="text-foreground">{cycle.dueDate}</b>
          </div>
          <div className="mt-1.5">
            <b>{cycleExpenses.length}</b> unreconciled expense
            {cycleExpenses.length === 1 ? "" : "s"} totaling <b>{formatMoney(cycleTotal, cur)}</b>.
            {date > cycle.dueDate && <span className="text-[color:var(--warn)]"> · Past due</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(
          [
            ["cycle", "This cycle"],
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
          {spendableAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.bankName} {a.name} · {a.type} · {formatMoney(a.balance, cur)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Payment date" hint="We use this to match the right cycle.">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
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

  if (state.accounts.length < 2)
    return <div className="text-sm text-muted-foreground">Need at least 2 accounts.</div>;

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
          <Input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          Transfer
        </Button>
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
              setId(t === "account" ? (state.accounts[0]?.id ?? "") : (state.cards[0]?.id ?? ""));
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
        <Input
          type="number"
          inputMode="decimal"
          value={newBalance}
          onChange={(e) => setNewBalance(e.target.value)}
        />
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
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          Save adjustment
        </Button>
      </div>
    </div>
  );
}
