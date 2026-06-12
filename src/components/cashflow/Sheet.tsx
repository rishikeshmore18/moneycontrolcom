import { useEffect, useId, useRef, type ReactNode } from "react";
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
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusFirstControl = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const firstControl = panel.querySelector<HTMLElement>(focusableSelector);
      (firstControl ?? panel).focus();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (el) => el.offsetParent !== null,
      );
      if (controls.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    window.requestAnimationFrame(focusFirstControl);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  const maxW = size === "wide" ? "sm:max-w-[980px]" : "sm:max-w-[640px]";
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden bg-black/45 backdrop-blur-sm animate-fade p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${maxW} flex h-[100dvh] max-h-[100dvh] flex-col rounded-none bg-[color:var(--card-solid)] shadow-elegant animate-sheet outline-none overflow-hidden sm:h-auto sm:max-h-[min(94dvh,900px)] sm:rounded-3xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <h2 id={titleId} className="text-lg font-black tracking-tight">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-foreground hover:bg-border"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-border bg-[color:var(--card-solid)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl flex flex-wrap gap-2 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
