// Supabase-backed storage for CashFlow Control.
// Each user has one row in `user_data` whose `data` column holds the AppState JSON.
import { supabase } from "@/integrations/supabase/client";
import { AppState, SCHEMA_VERSION, emptyState } from "./types";

function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== "object") return emptyState;
  const obj = raw as Partial<AppState>;
  if (!obj.schemaVersion || obj.schemaVersion < SCHEMA_VERSION) {
    return { ...emptyState, ...obj, schemaVersion: SCHEMA_VERSION };
  }
  return obj as AppState;
}

export async function loadUserState(userId: string): Promise<AppState> {
  const { data, error } = await supabase
    .from("user_data")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[storage] load error", error);
    return emptyState;
  }
  if (!data) {
    // Initialize empty row so subsequent updates always have a target.
    await supabase.from("user_data").insert({ user_id: userId, data: emptyState as never });
    return emptyState;
  }
  return migrate(data.data);
}

export async function saveUserState(userId: string, state: AppState): Promise<void> {
  const { error } = await supabase
    .from("user_data")
    .upsert({ user_id: userId, data: state as never }, { onConflict: "user_id" });
  if (error) console.error("[storage] save error", error);
}
