import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { reducer, type Action } from "./reducer";
import { storage } from "./storage";
import { emptyState, type AppState } from "./types";

interface Ctx {
  state: AppState;
  dispatch: (a: Action) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, emptyState, () => storage.load());
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    storage.save(state);
  }, [state]);

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

  return <AppCtx.Provider value={{ state, dispatch }}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
