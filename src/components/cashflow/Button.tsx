import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "soft" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "soft", full, className = "", ...rest },
  ref,
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold text-sm transition-all duration-150 active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<Variant, string> = {
    primary:
      "brand-gradient text-primary-foreground hover:-translate-y-0.5 shadow-soft hover:shadow-elegant",
    soft: "bg-[color:var(--card-solid)] text-foreground shadow-soft hover:-translate-y-0.5 hover:shadow-elegant",
    ghost: "bg-transparent text-foreground border border-border hover:bg-muted",
    danger: "bg-[color:var(--bad)] text-white hover:opacity-90 shadow-soft",
  };
  return (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    />
  );
});
