import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppProvider, useApp } from "@/lib/cashflow/AppContext";
import { AppLayout, type Tab } from "@/components/cashflow/AppLayout";
import { Dashboard } from "@/components/cashflow/Dashboard";
import { IncomeTimesheet } from "@/components/cashflow/IncomeTimesheet";
import { CardsScreen } from "@/components/cashflow/CardsScreen";
import { Forecast } from "@/components/cashflow/Forecast";
import { Profile } from "@/components/cashflow/Profile";
import { QuickAddModal } from "@/components/cashflow/QuickAddModal";
import { OnboardingWizard } from "@/components/cashflow/OnboardingWizard";
import { ToastViewport } from "@/components/cashflow/Toast";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CashFlow Control — Personal cash, debt & income tracker" },
      { name: "description", content: "Track cash, credit cards, debts, paychecks and timesheets. Know exactly what's safe to spend." },
      { property: "og:title", content: "CashFlow Control" },
      { property: "og:description", content: "Personal cash, debt and income tracker with timesheets and forecast." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <AppProvider>
      <Shell />
      <ToastViewport />
    </AppProvider>
  );
}

function Shell() {
  const { state } = useApp();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickFlow, setQuickFlow] = useState<"menu" | "expense">("menu");

  // Auto-open Add Expense on first load after onboarding for a faster entry experience.
  useEffect(() => {
    if (!state.onboarded) return;
    setQuickFlow("expense");
    setQuickOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.onboarded]);

  if (!state.onboarded) {
    return <OnboardingWizard open={true} />;
  }


  return (
    <>
      <AppLayout
        tab={tab}
        setTab={setTab}
        onQuickAdd={() => {
          setQuickFlow("menu");
          setQuickOpen(true);
        }}
        onAddExpense={() => {
          setQuickFlow("expense");
          setQuickOpen(true);
        }}
      >
        {tab === "dashboard" && <Dashboard />}
        {tab === "income" && <IncomeTimesheet />}
        {tab === "cards" && <CardsScreen onPay={() => setQuickOpen(true)} />}
        {tab === "forecast" && <Forecast />}
        {tab === "profile" && <Profile />}
      </AppLayout>
      <QuickAddModal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        setTab={setTab}
        initialFlow={quickFlow}
      />
    </>
  );
}

