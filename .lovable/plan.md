# Connect Plaid for live bank, card, and investment sync

Link real accounts through Plaid, pull balances and transactions automatically, and review every imported item before it becomes part of your numbers. Manual and cash entries keep working exactly as they do today.

## What you'll be able to do

- Tap "Connect bank" and go through Plaid's secure login for checking/savings, credit cards, and investment accounts.
- See each linked account listed with its live balance, updated automatically.
- Get new bank transactions in an **Inbox** where you accept, edit the category, or dismiss each one.
- When an imported item looks like something you already typed in, the inbox flags it as a possible duplicate and you decide: merge or keep both. Nothing merges on its own.
- Balances on linked accounts and cards come from the bank and aren't hand-editable; manual and cash accounts stay fully editable.
- Disconnect an account any time; its history stays, it just stops syncing.

## Behaviour rules

- **Manual first, always.** Nothing existing is moved or rewritten. Plaid data lives in its own place and only enters your dashboard once you accept it.
- **Nothing double-counts.** An accepted bank transaction becomes a normal transaction with a marker saying it came from the bank. If you merge it with a manual one, the manual one is updated, not duplicated.
- **Pending transactions** are shown separately and only settle into the inbox when the bank finalises them.
- **Card payments** imported from a card account are recognised as card payments and run through the existing billing-cycle logic.
- **Transfers between two linked accounts** are detected as one transfer instead of an expense plus an income.
- **Investment accounts** contribute their balance to net worth only; their trades don't appear as expenses.
- **Re-authentication.** Banks periodically force a re-login. The app shows a "Reconnect" banner on that account instead of silently failing.
- **Sync errors** (bank down, rate limit, item revoked) are stored per account with a plain-language status, and retried on a schedule.

## Interface

- New **Connections** section in Profile: connect, list, status, last synced, reconnect, disconnect.
- New **Inbox** badge on the dashboard showing count of items awaiting review.
- Linked accounts get a small bank badge and a read-only balance in Accounts and Cards.

## Technical detail

**Environment:** Plaid production from the start. Credentials stored as secrets: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_WEBHOOK_SECRET` (Plaid's JWT verification key is fetched, not stored). Requires that your Plaid production access is approved and that the redirect/webhook URL is registered in the Plaid dashboard.

**New tables (all RLS-scoped to `auth.uid()`, with GRANTs):**

- `plaid_items` — one per linked institution: `item_id`, encrypted `access_token`, institution name/logo, `cursor` for incremental sync, `status` (`good` / `login_required` / `error`), `last_synced_at`, error code/message.
- `plaid_accounts` — one per account inside an item: `account_id`, name, mask, `type`/`subtype`, `current_balance`, `available_balance`, `iso_currency`, `linked_local_id` (the app-side account/card id it maps to), `is_active`.
- `plaid_transactions` — raw ledger from Plaid: `transaction_id` (unique), `account_id`, amount, date, merchant, category, `pending`, `pending_transaction_id`, `status` (`inbox` / `accepted` / `dismissed` / `merged`), `local_transaction_id`, `suggested_match_id`.
- `plaid_sync_log` — webhook and sync run history for debugging.

Access tokens are encrypted at rest (pgcrypto with a `PLAID_TOKEN_ENC_KEY` secret) and never leave server code.

**Server functions** (`src/lib/plaid/*.functions.ts`, all behind `requireSupabaseAuth`):
`createLinkToken`, `exchangePublicToken`, `syncTransactions` (Plaid `/transactions/sync` with cursor), `refreshBalances`, `listInbox`, `acceptInboxItem`, `mergeInboxItem`, `dismissInboxItem`, `unlinkItem`, `createUpdateModeLinkToken` (re-auth).

**Webhook:** `src/routes/api/public/plaid/webhook.ts` — verifies Plaid's JWT signature before doing anything, then queues a sync for the affected item. Handles `SYNC_UPDATES_AVAILABLE`, `ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`, `USER_PERMISSION_REVOKED`, `TRANSACTIONS_REMOVED`.

**Bridging to existing state:** the current app state stays in `user_data` JSONB. Accepting an inbox item calls the existing reducer actions (`ADD_EXPENSE`, `ADD_INCOME`, `PAY_CREDIT_CARD`, `PAY_DEBT`, transfer) so all downstream forecast, budget, and cycle logic works unchanged. Linked balances are overlaid onto accounts/cards at read time from `plaid_accounts`, so the JSONB balance is never fought over.

**Duplicate suggestion rule:** same signed amount within ±2 cents, date within ±4 days, same mapped account → flagged as a suggested match, surfaced in the inbox, never auto-applied.

**Client:** `react-plaid-link` for the Link modal, loaded client-side only (no SSR import). Idempotency on `exchangePublicToken` so a double-tap can't create two items.

## Build order

1. Secrets + database tables and policies.
2. Server functions for link token, token exchange, and item storage; Connections UI in Profile.
3. Balance sync + read-only overlay on Accounts and Cards.
4. Transaction sync + Inbox screen with accept / dismiss.
5. Duplicate detection and merge flow.
6. Webhook route, re-auth banner, error states.
7. Transfer and card-payment detection, investment handling.

## Not included

- No automatic categorisation rules engine (Plaid's category is used as the default suggestion; you can change it on accept).
- No historical backfill beyond Plaid's default window (typically up to 24 months, institution-dependent).
