import { useState } from "react";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { Field, Input, Select } from "./Field";
import { useApp } from "@/lib/cashflow/AppContext";
import { newId } from "@/lib/cashflow/dates";
import { formatMoney, toNumber } from "@/lib/cashflow/money";
import type {
  Account, AccountType, AppState, Card, CardType, Debt, Job, PayFrequency, RecurringBill, Theme,
} from "@/lib/cashflow/types";
import { Trash2, Plus } from "lucide-react";
import { toast } from "./Toast";

interface DraftAccount extends Omit<Account, "id" | "createdAt" | "updatedAt"> {}
interface DraftCard extends Omit<Card, "id"> {}
interface DraftJob extends Omit<Job, "id"> {}
interface DraftDebt extends Omit<Debt, "id"> {}
interface DraftBill extends Omit<RecurringBill, "id"> {}

const STEPS = ["Profile", "Accounts", "Income", "Cards", "Debts & bills", "Review"] as const;

export function OnboardingWizard({ open }: { open: boolean }) {
  const { dispatch } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [theme, setTheme] = useState<Theme>("system");
  const [floor, setFloor] = useState(100);

  const [accounts, setAccounts] = useState<DraftAccount[]>([
    { bankName: "Chase", name: "Checking", type: "checking", balance: 0 },
    { bankName: "Cash", name: "Cash", type: "cash", balance: 0 },
  ]);

  const [fullTime, setFullTime] = useState<DraftJob>({
    name: "Full-time", type: "full_time", netHourlyRate: 0, netPaycheckAmount: 0,
    payFrequency: "biweekly", paydayWeekday: 4, defaultDepositAccountId: "",
  });
  const [partTime, setPartTime] = useState<DraftJob[]>([
    { name: "Part-time A", type: "part_time", netHourlyRate: 15, netPaycheckAmount: 0, payFrequency: "weekly", paydayWeekday: 5, defaultDepositAccountId: "" },
  ]);

  const [cards, setCards] = useState<DraftCard[]>([]);
  const [debts, setDebts] = useState<DraftDebt[]>([]);
  const [bills, setBills] = useState<DraftBill[]>([]);

  function finish() {
    const now = new Date().toISOString();
    const realAccounts: Account[] = accounts
      .filter((a) => a.name.trim())
      .map((a) => ({ ...a, id: newId(), createdAt: now, updatedAt: now }));

    // resolve default deposit accounts
    const firstChecking = realAccounts.find((a) => a.type === "checking") ?? realAccounts[0];

    const jobList: Job[] = [];
    if (fullTime.netPaycheckAmount > 0 || fullTime.netHourlyRate > 0) {
      jobList.push({
        ...fullTime,
        id: newId(),
        defaultDepositAccountId: firstChecking?.id ?? "",
      });
    }
    partTime
      .filter((j) => j.name.trim())
      .forEach((j) =>
        jobList.push({
          ...j,
          id: newId(),
          defaultDepositAccountId: j.defaultDepositAccountId || firstChecking?.id || "",
        }),
      );

    const cardList: Card[] = cards.filter((c) => c.name.trim()).map((c) => ({ ...c, id: newId() }));
    const debtList: Debt[] = debts.filter((d) => d.name.trim()).map((d) => ({ ...d, id: newId() }));
    const billList: RecurringBill[] = bills
      .filter((b) => b.name.trim())
      .map((b) => ({ ...b, id: newId(), accountId: b.accountId || firstChecking?.id || "" }));

    const payload: Partial<AppState> = {
      profile: { name, currency, theme, safeToSpendFloor: floor },
      accounts: realAccounts,
      jobs: jobList,
      cards: cardList,
      debts: debtList,
      recurringBills: billList,
    };
    dispatch({ type: "COMPLETE_ONBOARDING", payload });
    toast(`Welcome${name ? `, ${name}` : ""}! 🎉`);
  }

  // unique name check for accounts
  const accountNamesValid = (() => {
    const seen = new Set<string>();
    for (const a of accounts) {
      const n = a.name.trim().toLowerCase();
      if (!n) continue;
      if (seen.has(n)) return false;
      seen.add(n);
    }
    return true;
  })();

  const stepValid: boolean[] = [
    !!name.trim(),
    accounts.some((a) => a.name.trim()) && accountNamesValid,
    true,
    true,
    true,
    true,
  ];
  const canNext = stepValid[step];

  return (
    <Sheet
      open={open}
      onClose={() => undefined}
      title=""
      size="wide"
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" onClick={finish}>Finish setup</Button>
          )}
        </div>
      }
    >
      <div className="grid gap-5">
        <Progress step={step} />

        {step === 0 && (
          <div className="grid gap-4">
            <Heading title="Welcome to CashFlow Control" sub="Tell us a bit about yourself." />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your name / label"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" autoFocus /></Field>
              <Field label="Currency"><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
              <Field label="Theme">
                <Select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                  <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
                </Select>
              </Field>
              <Field label="Safe-to-spend floor" hint="Always reserved before 'safe to spend' calculation.">
                <Input type="number" value={floor} onChange={(e) => setFloor(toNumber(e.target.value))} />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4">
            <Heading title="Your accounts" sub="Add the bank accounts, cash and wallets that hold your money." />
            {!accountNamesValid && (
              <div className="rounded-2xl border border-[color:var(--bad)]/30 bg-[color:var(--bad)]/10 p-3 text-sm">
                Account names must be unique.
              </div>
            )}
            <div className="grid gap-3">
              {accounts.map((a, i) => (
                <div key={i} className="rounded-2xl border border-border p-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] items-end">
                  <Field label="Bank / wallet"><Input placeholder="e.g. Chase" value={a.bankName} onChange={(e) => updateAt(setAccounts, i, { bankName: e.target.value })} /></Field>
                  <Field label="Nickname"><Input placeholder="e.g. Checking" value={a.name} onChange={(e) => updateAt(setAccounts, i, { name: e.target.value })} /></Field>
                  <Field label="Type">
                    <Select value={a.type} onChange={(e) => updateAt(setAccounts, i, { type: e.target.value as AccountType })}>
                      <option value="checking">Checking</option><option value="savings">Savings</option>
                      <option value="cash">Cash</option><option value="other">Other</option>
                    </Select>
                  </Field>
                  <Field label="Current balance"><Input type="number" placeholder="0.00" value={a.balance || ""} onChange={(e) => updateAt(setAccounts, i, { balance: toNumber(e.target.value) })} /></Field>
                  <button onClick={() => setAccounts((arr) => arr.filter((_, ix) => ix !== i))} className="text-[color:var(--bad)] p-2 rounded-lg hover:bg-[color:var(--bad)]/10 mb-2"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setAccounts((a) => [...a, { bankName: "", name: "", type: "checking", balance: 0 }])}>
              <Plus size={14} /> Add another account
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <Heading title="Income" sub="Enter your full-time and part-time net pay (after tax)." />
            <div className="rounded-3xl border border-border p-4 grid gap-3">
              <div className="font-extrabold">Full-time salary</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Net paycheck amount"><Input type="number" value={fullTime.netPaycheckAmount} onChange={(e) => setFullTime({ ...fullTime, netPaycheckAmount: toNumber(e.target.value) })} /></Field>
                <Field label="Net hourly rate"><Input type="number" value={fullTime.netHourlyRate} onChange={(e) => setFullTime({ ...fullTime, netHourlyRate: toNumber(e.target.value) })} /></Field>
                <Field label="Pay frequency">
                  <Select value={fullTime.payFrequency} onChange={(e) => setFullTime({ ...fullTime, payFrequency: e.target.value as PayFrequency })}>
                    <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option>
                    <option value="semimonthly">Semimonthly</option><option value="monthly">Monthly</option>
                  </Select>
                </Field>
                <Field label="Payday weekday (0=Sun..6=Sat)"><Input type="number" min={0} max={6} value={fullTime.paydayWeekday} onChange={(e) => setFullTime({ ...fullTime, paydayWeekday: toNumber(e.target.value) })} /></Field>
                {fullTime.payFrequency === "biweekly" && (
                  <Field label="Next/known payday (anchor)"><Input type="date" value={fullTime.biweeklyAnchorDate ?? ""} onChange={(e) => setFullTime({ ...fullTime, biweeklyAnchorDate: e.target.value })} /></Field>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-border p-4 grid gap-3">
              <div className="flex items-center justify-between">
                <div className="font-extrabold">Part-time jobs</div>
                <Button variant="ghost" onClick={() => setPartTime((p) => [...p, { name: `Part-time ${String.fromCharCode(65 + p.length)}`, type: "part_time", netHourlyRate: 15, netPaycheckAmount: 0, payFrequency: "weekly", paydayWeekday: 5, defaultDepositAccountId: "" }])}>
                  <Plus size={14} /> Add job
                </Button>
              </div>
              {partTime.map((j, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] items-end">
                  <Field label="Job name"><Input value={j.name} onChange={(e) => updateAt(setPartTime, i, { name: e.target.value })} /></Field>
                  <Field label="Net hourly rate"><Input type="number" value={j.netHourlyRate} onChange={(e) => updateAt(setPartTime, i, { netHourlyRate: toNumber(e.target.value) })} /></Field>
                  <Field label="Pay frequency">
                    <Select value={j.payFrequency} onChange={(e) => updateAt(setPartTime, i, { payFrequency: e.target.value as PayFrequency })}>
                      <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option>
                      <option value="semimonthly">Semimonthly</option><option value="monthly">Monthly</option>
                    </Select>
                  </Field>
                  <button onClick={() => setPartTime((arr) => arr.filter((_, ix) => ix !== i))} className="text-[color:var(--bad)] p-2 rounded-lg hover:bg-[color:var(--bad)]/10 mb-3"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <Heading title="Credit cards" sub="Optional — skip if you don't use any." />
            <div className="grid gap-3">
              {cards.map((c, i) => (
                <div key={i} className="rounded-2xl border border-border p-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
                  <Input placeholder="Card name" value={c.name} onChange={(e) => updateAt(setCards, i, { name: e.target.value })} />
                  <Select value={c.type} onChange={(e) => updateAt(setCards, i, { type: e.target.value as CardType })}>
                    <option value="regular">Regular</option><option value="zero_apr">0% APR</option><option value="zero_apr_car">0% car</option><option value="other">Other</option>
                  </Select>
                  <Input type="number" placeholder="Limit" value={c.limit} onChange={(e) => updateAt(setCards, i, { limit: toNumber(e.target.value) })} />
                  <Input type="number" placeholder="Balance" value={c.currentBalance} onChange={(e) => updateAt(setCards, i, { currentBalance: toNumber(e.target.value) })} />
                  <Input type="number" placeholder="Min due" value={c.minimumDue} onChange={(e) => updateAt(setCards, i, { minimumDue: toNumber(e.target.value) })} />
                  <button onClick={() => setCards((arr) => arr.filter((_, ix) => ix !== i))} className="text-[color:var(--bad)] p-2 rounded-lg hover:bg-[color:var(--bad)]/10"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setCards((arr) => [...arr, { name: "", type: "regular", limit: 0, currentBalance: 0, statementBalance: 0, minimumDue: 0, billingDate: 1, dueDate: 15, apr: 22, targetUtilizationPercent: 30, preferredCategories: [] }])}>
              <Plus size={14} /> Add a card
            </Button>
          </div>
        )}

        {step === 4 && (
          <div className="grid gap-4">
            <Heading title="Debts & recurring bills" sub="Loans, IOUs, rent, subscriptions — anything that auto-drains." />
            <div className="rounded-3xl border border-border p-4 grid gap-3">
              <div className="flex items-center justify-between">
                <div className="font-extrabold">Debts</div>
                <Button variant="ghost" onClick={() => setDebts((arr) => [...arr, { name: "", balance: 0, minimumPayment: 0, dueDate: 1, status: "active" }])}><Plus size={14} /> Add debt</Button>
              </div>
              {debts.map((d, i) => (
                <div key={i} className="grid sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2">
                  <Input placeholder="Name" value={d.name} onChange={(e) => updateAt(setDebts, i, { name: e.target.value })} />
                  <Input type="number" placeholder="Balance" value={d.balance} onChange={(e) => updateAt(setDebts, i, { balance: toNumber(e.target.value) })} />
                  <Input type="number" placeholder="Min payment" value={d.minimumPayment} onChange={(e) => updateAt(setDebts, i, { minimumPayment: toNumber(e.target.value) })} />
                  <Select value={d.status} onChange={(e) => updateAt(setDebts, i, { status: e.target.value as Debt["status"] })}>
                    <option value="active">Active</option><option value="not_started">Not started</option>
                    <option value="paused">Paused</option><option value="paid_off">Paid off</option>
                  </Select>
                  <button onClick={() => setDebts((arr) => arr.filter((_, ix) => ix !== i))} className="text-[color:var(--bad)] p-2 rounded-lg hover:bg-[color:var(--bad)]/10"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>

            <div className="rounded-3xl border border-border p-4 grid gap-3">
              <div className="flex items-center justify-between">
                <div className="font-extrabold">Recurring bills</div>
                <Button variant="ghost" onClick={() => setBills((arr) => [...arr, { name: "", amount: 0, dueDay: 1, accountId: "", active: true }])}><Plus size={14} /> Add bill</Button>
              </div>
              {bills.map((b, i) => (
                <div key={i} className="grid sm:grid-cols-[2fr_1fr_1fr_auto] gap-2">
                  <Input placeholder="Name (Rent, Netflix…)" value={b.name} onChange={(e) => updateAt(setBills, i, { name: e.target.value })} />
                  <Input type="number" placeholder="Amount" value={b.amount} onChange={(e) => updateAt(setBills, i, { amount: toNumber(e.target.value) })} />
                  <Input type="number" placeholder="Due day" value={b.dueDay} onChange={(e) => updateAt(setBills, i, { dueDay: toNumber(e.target.value) })} />
                  <button onClick={() => setBills((arr) => arr.filter((_, ix) => ix !== i))} className="text-[color:var(--bad)] p-2 rounded-lg hover:bg-[color:var(--bad)]/10"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-4">
            <Heading title="Review" sub="Everything looks right? You can edit anytime in Profile." />
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryStat label="Cash total" value={formatMoney(accounts.reduce((s, a) => s + a.balance, 0), currency)} />
              <SummaryStat label="Card debt" value={formatMoney(cards.reduce((s, c) => s + c.currentBalance, 0), currency)} />
              <SummaryStat label="Debt total" value={formatMoney(debts.reduce((s, d) => s + d.balance, 0), currency)} />
            </div>
            <div className="rounded-2xl border border-border p-4 text-sm">
              <div><b>{accounts.filter((a) => a.name.trim()).length}</b> accounts · <b>{cards.filter((c) => c.name.trim()).length}</b> cards · <b>{partTime.filter((j) => j.name.trim()).length + (fullTime.netPaycheckAmount > 0 ? 1 : 0)}</b> jobs · <b>{bills.filter((b) => b.name.trim()).length}</b> bills</div>
              {fullTime.netPaycheckAmount > 0 && (
                <div className="mt-2">Full-time paycheck of <b>{formatMoney(fullTime.netPaycheckAmount, currency)}</b> {fullTime.payFrequency}.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function updateAt<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number, patch: Partial<T>) {
  setter((arr) => arr.map((x, i) => (i === index ? { ...x, ...patch } : x)));
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-2xl font-black tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {STEPS.map((label, i) => (
        <div key={label} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-extrabold ${i === step ? "brand-gradient text-primary-foreground" : i < step ? "bg-[color:var(--good)]/15 text-[color:var(--good)]" : "bg-muted text-muted-foreground"}`}>
          <span className="grid place-items-center h-5 w-5 rounded-full bg-black/10">{i + 1}</span>
          {label}
        </div>
      ))}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="text-xs uppercase font-bold tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-black mt-1">{value}</div>
    </div>
  );
}
