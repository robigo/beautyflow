# BeautyFlow matched local pilot — 8 November 2026

## Running on the selected Windows computer

- Application: `http://127.0.0.1:18080/`.
- Captured mailbox: `http://127.0.0.1:18080/pilot/inbox`.
- Synthetic demo account: `demo@example.test`, password `BeautyFlowDemo-2026!`.
- Synthetic business: `BeautyFlow — עסק בדיקה`; service price 120; two appointments with manually entered prices **135 and 0**, read back from PostgreSQL after creation.

These credentials are public demo data, not a real account or a production password. They apply only to the temporary local database. Resetting the demo password changes the password shown above; use the local captured mailbox to reset it again if needed. No email is delivered to a real inbox.

The pilot listens only on this computer. It is not a public hosting URL and will not open from a phone or another computer. No firewall or RMA configuration was changed.

## Isolation

The pilot adapter serves the actual candidate frontend, reset page and API from one origin. Hardcoded Production API/CDN/Supabase addresses are replaced only in test HTTP responses; shipped application files are unchanged. SDK files are served from the locked test dependencies. The adapter blocks legacy Supabase requests and external Node fetches; browser pages have a same-origin connection policy and a visible synthetic-data banner.

Database: dedicated Docker container `beautyflow-pilot-postgres-20261108`, PostgreSQL 16 Alpine, exposed only at `127.0.0.1:15439`, database/user `beautyflow_ci`. Its data is in tmpfs and is disposable: stopping/recreating the database container loses pilot data.

Before migration or application startup the adapter rejects hosted database URLs, wrong users/names, query overrides and non-PostgreSQL URLs. It then verifies the actual database identity, role and PostgreSQL major version. The guard does not load `.env.local` or use the previous local checkout's hosted connection string.

Only the exact Resend send-email call is captured in memory. Captured recipients must end in `@example.test`; captured reset links must lead back to this loopback origin. Real mail credentials are refused. The inbox contains synthetic reset tokens only and disappears when the web pilot restarts. Tokens are never printed to console.

## Start / stop

From the checkout root, after `pnpm install --frozen-lockfile` in `server` and `npm ci --ignore-scripts` in `server/test/browser`:

```powershell
.\start-local-pilot.ps1
```

The script creates/reuses only its named disposable database, validates its configuration, applies migrations only after the target guard, and starts the web pilot hidden. Runtime logs and PID are in ignored `.pilot-state/`. An existing server is identified by both PID and its specific entrypoint, so an unrelated process is not stopped.

```powershell
.\stop-local-pilot.ps1
```

This stops only the pilot web process, leaving its database running. Stopping the dedicated database container separately discards its synthetic data. RMA and the separate Loto scheduler are independent.

## Current validation

On the selected Windows computer:

- 9 reset-handler/mail tests, 3 build-safety tests, 2 disposable PostgreSQL API integration tests, and 2 local-target/mail-key guard tests passed.
- 4 Edge browser scenarios passed: owner-entered price/zero persistence through reload and fresh login; public booking; reset UI error/layout behavior; and the new matched-frontend/API reset flow.
- The new browser flow registers a synthetic account, requests a reset through the real page, opens the captured message through the mailbox UI, submits the new password to the real local API, checks old JWT/password rejection and new login, and rejects reset-link replay. No API response is mocked in that flow; only external email delivery is captured.
- Browser checks fail on requests outside the isolated origin or to legacy Supabase. The tested mobile width is 390px. Physical phone access was not enabled.
- Local health and the seeded 135/0 appointment prices were checked after startup.

Existing negative-case tests intentionally produce conflict/invalid-link messages on stderr; the test exit codes and assertions passed.

## Hosting and real mail remain pending

Plugin discovery confirmed **Vercel and Neon are DISABLED_BY_ADMIN / NOT_AVAILABLE**. No Vercel CLI login or mail-service credentials were found on this computer. No real secret was printed or copied into the pilot. Do not paste API keys or connection strings into chat, source or PR descriptions.

Before actual mail testing and Production promotion:

1. Obtain authorized hosting/configuration access (or have the account administrator complete the required configuration).
2. Verify a separate hosted Preview database and apply reviewed schema only to that verified target.
3. Configure a matched Preview frontend/API origin, CORS and reset URL, plus server-only mail settings and a verified sender.
4. Send a real test only to the recipient chosen by the user, then verify delivery/reset/replay/session invalidation/new login.
5. Separately verify the Production database, backup/recovery plan and required variables/schema before promoting PR #7. Builds do not migrate.

This work does not change `main`, the live GitHub Pages site, Vercel Production, hosted schemas, real user data or email. PR #7 stays draft until the external dependencies and actual mail E2E are verified.
