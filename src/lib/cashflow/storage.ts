// Versioned localStorage service — swappable backend later.
import { AppState, SCHEMA_VERSION, emptyState } from "./types";

const KEY = "cashflow-control:v1";

export interface StorageDriver {
  load(): AppState;
  save(state: AppState): void;
  clear(): void;
}

function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== "object") return emptyState;
  const obj = raw as Partial<AppState>;
  if (!obj.schemaVersion || obj.schemaVersion < SCHEMA_VERSION) {
    return { ...emptyState, ...obj, schemaVersion: SCHEMA_VERSION };
  }
  return obj as AppState;
}

export const localStorageDriver: StorageDriver = {
  load() {
    if (typeof window === "undefined") return emptyState;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return emptyState;
      return migrate(JSON.parse(raw));
    } catch {
      return emptyState;
    }
  },
  save(state) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  },
  clear() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(KEY);
  },
};

export const storage = localStorageDriver;
