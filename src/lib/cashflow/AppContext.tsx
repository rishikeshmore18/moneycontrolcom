import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { reducer, type Action } from "./reducer";
import { loadUserState, saveUserState } from "./storage";
import { emptyState, type AppState } from "./types";

interface Ctx {
  state: AppState;
  dispatch: (a: Action) => void;
  userEmail: string | null;
  signOut: () => Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, emptyState);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const hydratedFor = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth subscription
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUserId(u?.id ?? null);
      setUserEmail(u?.email ?? null);
      if (!u) {
        hydratedFor.current = null;
        setReady(true);
        navigate({ to: "/auth" });
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUserId(u?.id ?? null);
      setUserEmail(u?.email ?? null);
      if (!u) {
        setReady(true);
        navigate({ to: "/auth" });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  // Hydrate from Supabase when user changes
  useEffect(() => {
    if (!userId) return;
    if (hydratedFor.current === userId) return;
    hydratedFor.current = userId;
    setReady(false);
    loadUserState(userId).then((s) => {
      dispatch({ type: "HYDRATE", state: s });
      setReady(true);
    });
  }, [userId]);

  // Persist on state changes (debounced)
  useEffect(() => {
    if (!userId || !ready) return;
    if (hydratedFor.current !== userId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveUserState(userId, state);
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, userId, ready]);

  // theme
  useEffect(() => {
    const root = document.documentElement;
    const theme = state.profile.theme;
    const applyDark = (dark: boolean) => {
      root.classList.toggle("dark", dark);
      root.setAttribute("data-theme", dark ? "dark" : "light");
    };
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyDark(mq.matches);
      const onChange = (e: MediaQueryListEvent) => applyDark(e.matches);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    applyDark(theme === "dark");
  }, [state.profile.theme]);

  const signOut = async () => {
    await supabase.auth.signOut();
    dispatch({ type: "HYDRATE", state: emptyState });
  };

  if (!ready || (userId && hydratedFor.current !== userId)) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (!userId) {
    // Will redirect to /auth via effect; render nothing.
    return null;
  }

  return (
    <AppCtx.Provider value={{ state, dispatch, userEmail, signOut }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
