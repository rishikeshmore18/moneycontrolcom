import type { AppState, SavingsGoal } from "./types";

export const goalCents = (amount: number) => Math.round(amount * 100);
export const goalMoney = (cents: number) => cents / 100;
export const validGoalAmount = (amount: number) =>
  Number.isFinite(amount) &&
  amount > 0 &&
  Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001;

export function goalBalanceInAccount(goal: SavingsGoal, accountId: string): number {
  return goalMoney(
    goal.movements
      .filter((movement) => movement.accountId === accountId)
      .reduce((sum, movement) => sum + goalCents(movement.amount), 0),
  );
}

export function goalBalance(goal: SavingsGoal): number {
  return goalMoney(goal.movements.reduce((sum, movement) => sum + goalCents(movement.amount), 0));
}

/** Contribution reminders measure recorded allocations; a plan never moves cash. */
export function goalPlanProgress(
  state: AppState,
  goal: SavingsGoal,
  today: string,
): {
  cadence: "weekly" | "monthly";
  saved: number;
  remaining: number;
  periodEnd: string;
  estimatedAtDeadline?: number;
} | null {
  const cadence = goal.plan?.cadence;
  const amount = goal.plan?.amount;
  if ((cadence !== "weekly" && cadence !== "monthly") || !amount) return null;
  const date = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  let start: string;
  let end: string;
  if (cadence === "monthly") {
    start = `${today.slice(0, 7)}-01`;
    end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  } else {
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    start = monday.toISOString().slice(0, 10);
    monday.setUTCDate(monday.getUTCDate() + 6);
    end = monday.toISOString().slice(0, 10);
  }
  const saved = goalMoney(
    Math.max(
      0,
      goal.movements
        .filter(
          (movement) =>
            movement.date >= start &&
            movement.date <= end &&
            (movement.kind === "save" || movement.kind === "release"),
        )
        .reduce((sum, movement) => sum + goalCents(movement.amount), 0),
    ),
  );
  const remaining = goalMoney(Math.max(0, goalCents(amount) - goalCents(saved)));
  let estimatedAtDeadline: number | undefined;
  if (goal.targetDate && goal.targetDate >= today) {
    const deadline = new Date(`${goal.targetDate}T12:00:00Z`);
    let periods: number;
    if (cadence === "monthly") {
      periods = (deadline.getUTCFullYear() - year) * 12 + deadline.getUTCMonth() - month + 1;
    } else {
      const deadlineWeek = new Date(deadline);
      deadlineWeek.setUTCDate(deadline.getUTCDate() - ((deadline.getUTCDay() + 6) % 7));
      periods =
        Math.round(
          (deadlineWeek.getTime() - new Date(`${start}T12:00:00Z`).getTime()) / (7 * 86_400_000),
        ) + 1;
    }
    estimatedAtDeadline = goalMoney(
      goalCents(backedGoalTotal(state, goal.id)) +
        goalCents(remaining) +
        Math.max(0, periods - 1) * goalCents(amount),
    );
  }
  return { cadence, saved, remaining, periodEnd: end, estimatedAtDeadline };
}

export function allocatedInAccount(state: AppState, accountId: string): number {
  return goalMoney(
    (state.savingsGoals ?? []).reduce(
      (sum, goal) => sum + goalCents(goalBalanceInAccount(goal, accountId)),
      0,
    ),
  );
}

/** Synced balances may fall after an allocation. Never count more backing than exists. */
export function backedGoalReserve(state: AppState, accountId: string): number {
  const account = state.accounts.find((item) => item.id === accountId);
  return account
    ? Math.min(Math.max(0, account.balance), Math.max(0, allocatedInAccount(state, accountId)))
    : 0;
}

export function goalUnfundedAmount(state: AppState): number {
  return state.accounts.reduce(
    (sum, account) =>
      sum +
      Math.max(0, allocatedInAccount(state, account.id) - backedGoalReserve(state, account.id)),
    0,
  );
}

export function backedGoalInAccount(state: AppState, goalId: string, accountId: string): number {
  const account = state.accounts.find((item) => item.id === accountId);
  let remaining = Math.max(0, goalCents(account?.balance ?? 0));
  for (const goal of state.savingsGoals ?? []) {
    const covered = Math.min(
      remaining,
      Math.max(0, goalCents(goalBalanceInAccount(goal, accountId))),
    );
    if (goal.id === goalId) return goalMoney(covered);
    remaining -= covered;
  }
  return 0;
}

export function backedGoalTotal(state: AppState, goalId: string): number {
  return goalMoney(
    state.accounts.reduce(
      (sum, account) => sum + goalCents(backedGoalInAccount(state, goalId, account.id)),
      0,
    ),
  );
}

export function outstandingGoalCardCharges(
  state: AppState,
  goalId: string,
  cardId?: string,
): number {
  const charges = state.transactions
    .filter(
      (tx) =>
        tx.type === "expense" &&
        tx.savingsGoalId === goalId &&
        !!tx.cardId &&
        (!cardId || tx.cardId === cardId),
    )
    .reduce((sum, tx) => sum + goalCents(tx.savingsGoalAmount ?? tx.amount), 0);
  const payments = state.transactions
    .filter(
      (tx) =>
        tx.type === "card_payment" &&
        tx.savingsGoalId === goalId &&
        (!cardId || tx.cardId === cardId),
    )
    .reduce((sum, tx) => sum + goalCents(tx.savingsGoalAmount ?? 0), 0);
  return goalMoney(Math.max(0, charges - payments));
}

export function goalAvailable(state: AppState, goal: SavingsGoal): number {
  return goalMoney(
    Math.max(
      0,
      goalCents(backedGoalTotal(state, goal.id)) -
        goalCents(outstandingGoalCardCharges(state, goal.id)),
    ),
  );
}

/** Commitments use source allocations in their recorded order for release validation. */
export function goalAvailableInAccount(
  state: AppState,
  goal: SavingsGoal,
  accountId: string,
): number {
  let committed = goalCents(outstandingGoalCardCharges(state, goal.id));
  for (const account of state.accounts) {
    const held = Math.max(0, goalCents(backedGoalInAccount(state, goal.id, account.id)));
    const consumed = Math.min(held, committed);
    if (account.id === accountId) return goalMoney(held - consumed);
    committed -= consumed;
  }
  return 0;
}

/** One card due can use each dollar of earmarked savings at most once. */
export function goalCoverageByCard(state: AppState): Map<string, number> {
  const result = new Map<string, number>();
  const remainingBacking = new Map(
    state.accounts.map((account) => [account.id, goalCents(backedGoalReserve(state, account.id))]),
  );
  for (const goal of state.savingsGoals ?? []) {
    const backing = state.accounts.reduce((sum, account) => {
      const available = remainingBacking.get(account.id) ?? 0;
      const held = Math.min(
        available,
        Math.max(0, goalCents(backedGoalInAccount(state, goal.id, account.id))),
      );
      remainingBacking.set(account.id, available - held);
      return sum + held;
    }, 0);
    let remaining = Math.min(backing, goalCents(outstandingGoalCardCharges(state, goal.id)));
    const cardIds = [
      ...new Set(
        state.transactions
          .filter((tx) => tx.type === "expense" && tx.savingsGoalId === goal.id && tx.cardId)
          .map((tx) => tx.cardId!),
      ),
    ];
    for (const cardId of cardIds) {
      const amount = Math.min(
        remaining,
        goalCents(outstandingGoalCardCharges(state, goal.id, cardId)),
      );
      result.set(cardId, goalMoney(goalCents(result.get(cardId) ?? 0) + amount));
      remaining -= amount;
    }
  }
  return result;
}
