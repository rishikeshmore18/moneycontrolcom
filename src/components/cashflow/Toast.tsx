import { useEffect, useSyncExternalStore } from "react";

interface ToastItem {
  id: number;
  message: string;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function toast(message: string) {
  items = [...items, { id: Date.now() + Math.random(), message }];
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return items;
}

function remove(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function ToastViewport() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div className="fixed left-1/2 bottom-24 z-[80] -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
      {list.map((t) => (
        <ToastBubble key={t.id} id={t.id} message={t.message} />
      ))}
    </div>
  );
}

function ToastBubble({ id, message }: { id: number; message: string }) {
  useEffect(() => {
    const t = setTimeout(() => remove(id), 2400);
    return () => clearTimeout(t);
  }, [id]);
  return (
    <div className="rounded-full bg-foreground text-background px-4 py-2.5 text-sm font-medium shadow-elegant animate-rise">
      {message}
    </div>
  );
}
