import { useState } from "react";
import { useApp } from "@/lib/cashflow/AppContext";
import { formatMoney, toNumber } from "@/lib/cashflow/money";
import { formatDisplayDate, todayISO } from "@/lib/cashflow/dates";
import {
  allocatedInAccount,
  backedGoalInAccount,
  backedGoalTotal,
  goalAvailable,
  goalAvailableInAccount,
  goalBalance,
  goalBalanceInAccount,
  goalUnfundedAmount,
  outstandingGoalCardCharges,
} from "@/lib/cashflow/savingsGoals";
import { Sheet } from "./Sheet";
import { Field, Input, Select } from "./Field";
import { Button } from "./Button";
import { toast } from "./Toast";

export function SavingsGoalsSheet({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [goalId, setGoalId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState<"save" | "release">("save");
  const [editing, setEditing] = useState("");
  const money = (value: number) => formatMoney(value, state.profile.currency);
  const goal = state.savingsGoals?.find((item) => item.id === goalId);
  const source = state.accounts.find((account) => account.id === accountId);

  function submitGoal() {
    const desired = target.trim() ? toNumber(target) : undefined;
    if (!name.trim() || (target.trim() && (!desired || desired <= 0)))
      return toast("Enter a goal name and a valid target or deadline.");
    const payload = { name, targetAmount: desired, targetDate: deadline || undefined };
    if (editing) dispatch({ type: "UPDATE_SAVINGS_GOAL", id: editing, payload });
    else dispatch({ type: "ADD_SAVINGS_GOAL", payload });
    setEditing("");
    setName("");
    setTarget("");
    setDeadline("");
  }

  function moveAllocation() {
    const value = toNumber(amount);
    if (!goal || !source || value <= 0 || !date)
      return toast("Choose a goal, source, amount and date.");
    const available =
      mode === "save"
        ? source.balance - allocatedInAccount(state, source.id)
        : goalAvailableInAccount(state, goal, source.id);
    if (Math.round(value * 100) > Math.round((available + 0.00001) * 100))
      return toast(`Only ${money(Math.max(0, available))} is available in this source.`);
    dispatch({
      type: mode === "save" ? "ALLOCATE_GOAL" : "RELEASE_GOAL",
      goalId: goal.id,
      accountId: source.id,
      amount: value,
      date,
    });
    toast(mode === "save" ? "Set aside for goal" : "Returned to available money");
    setAmount("");
  }

  return (
    <Sheet open onClose={onClose} title="Savings goals">
      <div className="grid min-w-0 gap-5">
        <p className="text-sm text-muted-foreground">
          Track where your money is saved. Moving money between your own accounts keeps the goal
          attached. A goal never adds to your bank balance.
        </p>
        {goalUnfundedAmount(state) > 0 && (
          <p role="status" className="rounded-xl border border-[color:var(--warn)] p-3 text-sm">
            {money(goalUnfundedAmount(state))} of allocations are no longer backed by current
            account balances. Check your bank and update the goal.
          </p>
        )}
        <div className="grid gap-3">
          {(state.savingsGoals ?? []).map((item) => {
            const held = backedGoalTotal(state, item.id);
            const recorded = goalBalance(item);
            const committed = outstandingGoalCardCharges(state, item.id);
            const monthsLeft =
              item.targetDate && item.targetDate >= todayISO()
                ? Math.max(
                    1,
                    (Number(item.targetDate.slice(0, 4)) - Number(todayISO().slice(0, 4))) * 12 +
                      Number(item.targetDate.slice(5, 7)) -
                      Number(todayISO().slice(5, 7)) +
                      1,
                  )
                : 0;
            return (
              <div key={item.id} className="min-w-0 rounded-2xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="break-words">{item.name}</strong>
                    <p className="text-xs text-muted-foreground">
                      {item.targetDate
                        ? `Needed by ${formatDisplayDate(item.targetDate)}`
                        : "No deadline"}
                      {item.targetAmount ? ` · target ${money(item.targetAmount)}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(item.id);
                      setName(item.name);
                      setTarget(item.targetAmount ? String(item.targetAmount) : "");
                      setDeadline(item.targetDate ?? "");
                    }}
                  >
                    Edit
                  </Button>
                </div>
                <p className="mt-2 text-lg font-black">{money(held)} saved</p>
                {recorded > held && (
                  <p className="text-xs text-[color:var(--warn)]">
                    {money(recorded - held)} of recorded savings needs bank or cash backing.
                  </p>
                )}
                {item.targetAmount && (
                  <p className="text-xs text-muted-foreground">
                    {Math.min(100, Math.round((held / item.targetAmount) * 100))}% of target
                    {monthsLeft && held < item.targetAmount
                      ? ` · about ${money(Math.ceil(((item.targetAmount - held) / monthsLeft) * 100) / 100)} per month to reach the deadline`
                      : ""}
                  </p>
                )}
                {committed > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {money(committed)} used on a card, awaiting payment ·{" "}
                    {money(goalAvailable(state, item))} still free in the goal
                  </p>
                )}
                {state.accounts
                  .filter((account) => goalBalanceInAccount(item, account.id) > 0)
                  .map((account) => (
                    <p key={account.id} className="break-words text-sm">
                      {account.type === "cash" ? "Cash" : "Bank"} · {account.name}:{" "}
                      <b>{money(backedGoalInAccount(state, item.id, account.id))}</b>
                    </p>
                  ))}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setGoalId(item.id);
                    setMode("save");
                  }}
                >
                  Save this month
                </Button>
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 rounded-2xl border border-border p-4">
          <strong>{editing ? "Edit goal" : "New goal"}</strong>
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trip, car expenses…"
            />
          </Field>
          <Field label="Target amount (optional)">
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
          <Field label="Deadline (optional)">
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={submitGoal}>
            {editing ? "Save goal" : "Create goal"}
          </Button>
        </div>
        {(state.savingsGoals ?? []).length > 0 && (
          <div className="grid gap-3 rounded-2xl border border-border p-4">
            <strong>Save money or release it</strong>
            <p className="text-xs text-muted-foreground">
              Choose where this month’s money is held. This earmarks existing money; it does not
              transfer it.
            </p>
            <Field label="Goal">
              <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">Choose goal</option>
                {state.savingsGoals!.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Action">
              <Select value={mode} onChange={(e) => setMode(e.target.value as "save" | "release")}>
                <option value="save">Save this month</option>
                <option value="release">Release uncommitted savings</option>
              </Select>
            </Field>
            <Field label="Where is it saved?">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose bank account or cash</option>
                {state.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.type === "cash" ? "Cash" : "Bank"} · {account.name} ·{" "}
                    {money(
                      mode === "save"
                        ? Math.max(0, account.balance - allocatedInAccount(state, account.id))
                        : goal
                          ? goalBalanceInAccount(goal, account.id)
                          : 0,
                    )}{" "}
                    available
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount">
              <Input
                type="number"
                min="0"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={moveAllocation}>
              {mode === "save" ? "Set aside" : "Release"}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
