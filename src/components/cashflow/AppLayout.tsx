import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  CalendarClock,
  CreditCard,
  TrendingUp,
  UserCircle,
  Plus,
  Moon,
  Sun,
  Laptop,
  Menu,
  X,
} from "lucide-react";
import { useApp } from "@/lib/cashflow/AppContext";
import type { Theme } from "@/lib/cashflow/types";

export type Tab = "dashboard" | "income" | "cards" | "forecast" | "profile";

const NAV: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "income", label: "Income", icon: CalendarClock },
  { id: "cards", label: "Cards", icon: CreditCard },
  { id: "forecast", label: "Forecast", icon: TrendingUp },
  { id: "profile", label: "Profile", icon: UserCircle },
];

export function AppLayout({
  tab,
  setTab,
  onQuickAdd,
  onAddExpense,
  children,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  onQuickAdd: () => void;
  onAddExpense?: () => void;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div
      className={`min-h-screen md:grid ${sidebarOpen ? "md:grid-cols-[260px_1fr]" : "md:grid-cols-[1fr]"}`}
    >
      {sidebarOpen && (
        <Sidebar
          tab={tab}
          setTab={setTab}
          onClose={() => setSidebarOpen(false)}
        />
      )}
      <main className="w-full max-w-[1400px] mx-auto overflow-x-hidden px-4 pt-5 pb-28 md:px-8 md:pt-6 md:pb-10">
        {/* Desktop/tablet top bar with sidebar toggle */}
        <div className="hidden md:flex items-center mb-4">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-[color:var(--card-solid)] hover:bg-muted transition"
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            <Menu size={18} />
          </button>
        </div>
        {children}
      </main>
      <BottomNav tab={tab} setTab={setTab} />
      {/* Single FAB: opens Add Expense directly (falls back to full quick add menu) */}
      <button
        onClick={onAddExpense ?? onQuickAdd}
        className="fixed right-4 bottom-24 md:bottom-8 md:right-8 z-30 flex items-center gap-2 h-14 pl-4 pr-5 rounded-2xl brand-gradient text-primary-foreground font-extrabold shadow-elegant transition hover:-translate-y-1"
        aria-label="Add expense"
      >
        <Plus size={22} strokeWidth={2.75} />
        <span className="text-sm tracking-tight">Add expense</span>
      </button>
    </div>
  );
}



function Sidebar({
  tab,
  setTab,
  onClose,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  onClose: () => void;
}) {
  return (
    <aside className="hidden md:flex md:flex-col md:sticky md:top-0 md:h-screen p-6 border-r border-border bg-[color:var(--card)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-2">
        <Logo />
        <button
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-muted text-muted-foreground"
          aria-label="Hide sidebar"
        >
          <X size={16} />
        </button>
      </div>
      <nav className="grid gap-1.5 mt-2">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition ${
              tab === id
                ? "bg-gradient-to-br from-primary/20 to-primary-glow/15 text-foreground font-extrabold"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="mt-auto">
        <ThemeToggle />
        <div className="mt-4 rounded-3xl p-4 border border-border bg-gradient-to-br from-primary/12 to-primary-glow/10 text-xs leading-relaxed text-muted-foreground">
          Your data is securely synced to your account.
        </div>
      </div>
    </aside>
  );
}

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <nav className="md:hidden fixed left-2 right-2 bottom-2 z-30 grid grid-cols-5 gap-0.5 p-1.5 rounded-3xl border border-border bg-[color:var(--card)] backdrop-blur-xl shadow-elegant">
      {NAV.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={`flex min-w-0 flex-col items-center justify-center py-2 px-0.5 rounded-2xl text-[10px] font-extrabold transition ${
            tab === id
              ? "bg-gradient-to-br from-primary/22 to-primary-glow/15 text-foreground"
              : "text-muted-foreground"
          }`}
        >
          <Icon size={18} />
          <span className="mt-0.5 w-full truncate text-center leading-tight">{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="grid place-items-center h-11 w-11 rounded-2xl brand-gradient text-primary-foreground font-black shadow-soft">
        CF
      </div>
      <div>
        <div className="font-extrabold tracking-tight">CashFlow Control</div>
        <div className="text-xs text-muted-foreground">Your money, in focus</div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const theme = state.profile.theme;
  const opts: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Laptop },
  ];
  const Current = opts.find((o) => o.id === theme)?.icon ?? Laptop;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-4 py-2.5 rounded-2xl border border-border bg-[color:var(--card-solid)] text-sm font-bold hover:bg-muted"
      >
        <Current size={16} />
        Theme: <span className="capitalize">{theme}</span>
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 right-0 grid gap-1 p-1.5 rounded-2xl border border-border bg-[color:var(--card-solid)] shadow-elegant animate-rise">
          {opts.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                dispatch({ type: "UPDATE_PROFILE", payload: { theme: id } });
                setOpen(false);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm hover:bg-muted ${
                theme === id ? "font-bold text-foreground" : "text-muted-foreground"
              }`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
