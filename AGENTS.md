# CashFlow Control project guidance

This is a personal finance app, not a construction project. The installed DDC skills are optional references for relevant data validation tasks. Do not apply construction estimating, BIM, or scheduling assumptions to users' money. Use the Impeccable skill for interface work when relevant.

## Architecture

- `src/lib/cashflow/types.ts` defines persisted financial data. `AppContext.tsx` hydrates it from Supabase and triggers Plaid bank balance sync. `src/lib/cashflow/forecast.ts` computes dashboard and forecast figures. `src/components/cashflow/Dashboard.tsx` displays them.
- Keep financial calculations in domain functions, not duplicated in visual components. Keep a visible breakdown aligned with the displayed total.
- A synced balance is only as fresh and complete as the underlying bank connection. Never assert that a calculated figure matches an actual bank account without checking the user's authorized live data and sync status.

## Money and forecast changes

- Define the source, time window, and status of every amount before changing a formula. Distinguish current account balances, expected income, unpaid bills, and the 90 day spendable forecast.
- Preserve the dashboard identity: `Left to spend = Have now + Income coming - Expenses coming` for the selected period. `Spendable today` is a separate 90 day calculation and must not be inferred from that identity.
- Avoid counting transfers, card charges and their payments, or posted transactions twice. Preserve existing exclusions for reserved accounts and unconfirmed income.
- For a calculation change, add a focused test using fixed dates and cent values, including the relevant breakdown and a boundary case such as a paid item, a period change, or a delayed bank update. Run the test suite and build before merging. State clearly if an environment or data access limitation prevents verification.
- Do not hardcode screenshot amounts, represent estimates as confirmed cash, or silently replace nonfinite financial data with a believable amount.

## Project skills

- Skills live under `.agents/skills/`, and `skills-lock.json` records their source revisions. Use only skills relevant to the task at hand; their presence does not validate this app's calculations.
