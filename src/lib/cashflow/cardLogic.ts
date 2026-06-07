import { AppState, Card } from "./types";

export function utilization(card: Card): number {
  if (card.limit <= 0) return 0;
  return Math.min(1, card.currentBalance / card.limit);
}

export function availableCredit(card: Card): number {
  return Math.max(0, card.limit - card.currentBalance);
}

export function recommendCardForCategory(
  state: AppState,
  category: string,
  amount: number,
): { card: Card; reason: string } | null {
  const eligible = state.cards.filter((c) => availableCredit(c) >= amount);
  if (eligible.length === 0) return null;
  // 1) preferred category + under target util
  const preferred = eligible.find(
    (c) => c.preferredCategories.includes(category) && utilization(c) * 100 < c.targetUtilizationPercent,
  );
  if (preferred) return { card: preferred, reason: "Best category match, under target utilization" };
  const underTarget = eligible.find((c) => utilization(c) * 100 < c.targetUtilizationPercent);
  if (underTarget) return { card: underTarget, reason: "Under target utilization" };
  // fall back to lowest util
  const best = [...eligible].sort((a, b) => utilization(a) - utilization(b))[0];
  return { card: best, reason: "Lowest current utilization" };
}

export function paymentOptions(card: Card) {
  const target = (card.targetUtilizationPercent / 100) * card.limit;
  const aboveTarget = Math.max(0, card.currentBalance - target);
  return {
    minimum: Math.min(card.minimumDue, card.currentBalance),
    statement: Math.min(card.statementBalance, card.currentBalance),
    current: card.currentBalance,
    toTarget: aboveTarget,
  };
}
