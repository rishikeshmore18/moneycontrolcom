# Plaid Liabilities rollout and verification

This rollout is **opt-in**. The existing Plaid Balance and Transactions integration remains active without Liabilities.

## Prerequisites
1. Verify production Plaid Liabilities entitlement and subscription pricing in the Plaid Dashboard. Do not add the product without explicit billing approval.
2. Apply `supabase/migrations/20261123000000_plaid_card_liabilities.sql` to the production Supabase project **before** enabling the feature. Check the schema and RLS policy afterwards.
3. Confirm the app has `PLAID_CLIENT_ID`, `PLAID_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` securely configured on the server.
4. Set server-only `PLAID_LIABILITIES_ENABLED=true` **only after** approval and migration. Never use `VITE_` for the feature gate or expose Plaid credentials to a browser.
5. Once deployed, open Profile → Bank connections → Enable statement sync for each institution. Complete Plaid Link's additional consent/update mode.
6. Explicitly map each Plaid credit-card account to its correct local card, avoiding duplicate mappings.
7. Reopen Profile → Cards and Dashboard. Verify issuer statement balance, minimum, last payment and due date against the real bank account. Test a partial payment and a $0 statement.
8. Confirm that current balance remains bank-authored, manual fallback values are retained, and statements do not mark personal early payment dates as issuer delinquency.

## Safety behavior
- Default-off gate means no production Liabilities endpoint calls.
- Repeated syncs are coalesced for 12 hours. Liabilities webhook handling uses the same cooldown.
- A failed/unsupported liability response does not prevent ordinary balance and transaction syncing.
- Bank snapshots live in `plaid_card_liabilities`, with per-user RLS. The existing `user_data` JSON keeps manual card preferences and locally mirrored snapshots.
- Plaid Link update mode retains the same access token. A successful consent refresh performs the first Liabilities query under the feature gate.
- Disabling the feature gate suspends further billable Liabilities calls but leaves existing Plaid connections and manually entered card details in place.
- If the database migration has not been applied, existing balance and transaction reads stay usable, while statement access stays unavailable.

## Remaining verification outside a coding sandbox
- Apply the migration to the actual Supabase instance and confirm grants and RLS.
- Verify production Plaid entitlement and complete a real user's Link consent.
- Compare returned billing fields and payment status against actual issuer data across institutions. Issuer support varies.
- Check real refresh cadence, webhook outcomes, and subscription charges.
- End-to-end UI verification on the deployed mobile layout.

## Automated verification
The PR's scoped tests check cashflow reconciliation, account balance authority, statement timing, and Plaid field normalization. The full suite and production build are run in the PR workflow. Historical suite failures from the unchanged `main` branch must not be presented as new failures. New tests must pass without changing their expectations to conceal defects.
