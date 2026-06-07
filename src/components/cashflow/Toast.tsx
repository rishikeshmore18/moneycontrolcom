import { create } from "zustand";
import { useEffect } from "react";

interface ToastItem { id: number; message: string; }
interface ToastStore {
  items: ToastItem[];
  push: (m: string) => void;
  remove: (id: number) => void;
}
const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (m) => set((s) => ({ items: [...s.items, { id: Date.now() + Math.random(), message: m }] })),
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(message: string) {
  useToastStore.getState().push(message);
}

export function ToastViewport() {
  const items = useToastStore((s) => s.items);
  const remove = useToastStore((s) => s.remove);
  return (
    <div className="fixed left-1/2 bottom-24 z-[80] -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
      {items.map((t) => (
        <ToastBubble key={t.id} id={t.id} message={t.message} remove={remove} />
      ))}
    </div>
  );
}

function ToastBubble({ id, message, remove }: { id: number; message: string; remove: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => remove(id), 2400);
    return () => clearTimeout(t);
  }, [id, remove]);
  return (
    <div className="rounded-full bg-foreground text-background px-4 py-2.5 text-sm font-medium shadow-elegant animate-rise">
      {message}
    </div>
  );
}
