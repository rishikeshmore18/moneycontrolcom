import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "wide";
}

export function Sheet({ open, onClose, title, children, footer, size = "default" }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  const maxW = size === "wide" ? "max-w-[980px]" : "max-w-[640px]";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-sm animate-fade sm:items-center"
      onClick={onClose}
    >
      <div
        className={`relative w-full ${maxW} max-h-[94vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[color:var(--card-solid)] shadow-elegant animate-sheet`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <h2 className="text-lg font-black tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-foreground hover:bg-border"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-auto px-5 py-4 flex-1">{children}</div>
        {footer && (
          <div className="border-t border-border bg-[color:var(--card-solid)] px-5 py-3 rounded-b-3xl flex flex-wrap gap-2 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
