export function formatMoney(amount: number, currency = "USD"): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `$${safe.toFixed(2)}`;
  }
}

export function toNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}
