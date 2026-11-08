# Matched hosted Preview — 8 November 2026

## Owner-confirmed hosting setup

The user completed the manual setup because Vercel and Neon connectors are disabled by the workspace administrator:

- Neon project BeautyFlow, existing branch `development-local`.
- The existing database `neondb` has one user and one business, so it was left unchanged.
- A new database `beautyflow_preview` was created under `development-local`.
- The guarded platform SQL was applied to that new database; the final result showed `beautyflow_preview`, zero users and zero businesses.
- In `beautyflow-ihl7`, `DATABASE_URL` and a new separate `JWT_SECRET` were saved for **Preview only**. Values were not inspected by the agent. A JWT value shown in a screenshot was replaced before deployment; never reproduce it in documentation.
- The owner redeployed the existing candidate as Preview and reported `{"ok":true}` from `/api/health`. The initial API-only root had no UI route; this is the change described below.

## Preview-only UI

The Preview build packages the real index, booking and reset pages plus assets and pinned local browser SDKs into `server/preview-ui` (generated and ignored by Git). Runtime HTML/static routes are enabled only when `VERCEL_ENV=preview`. The API function explicitly includes generated files in its bundle. Build-time access to the repository root is needed; current Vercel projects normally enable the monorepo outside-root build option by default.

Generated pages use relative API URLs on the same origin. Live API and Supabase hostnames are removed from those responses, and the browser connection policy allows only the same origin. The shipped root HTML and Production UI remain unchanged. Browser SDKs are pinned build-only dependencies. Preview CORS defaults to no cross-origin access when CLIENT_ORIGIN is absent; same-origin requests work without adding a separate origin variable.

The Preview runtime refuses a database name other than `beautyflow_preview` and connection-option overrides. This is a guard, not evidence about an unseen secret's host: branch/database selection still must be verified in Neon and Vercel as described above. No automatic hosted migration runs during builds.

## Overlap-constraint regression found during verification

Repeated API checks against a local database containing earlier synthetic businesses exposed an existing bug: `pg_constraint` was searched by constraint name across all tenants. Consequently only the first appointments table received the overlap constraint, while later businesses could double-book a slot. The corrected query also scopes by `conrelid='appointments'::regclass`.

The GiST extension must be in `public` so every tenant can use its UUID operator class. The tenant template now explicitly requests that schema. The reviewed platform migration creates it in public, or conditionally relocates a legacy tenant-local extension there, preserving index dependencies. **Before Production promotion, review/apply that migration separately and inspect existing bookings for overlaps.** Adding a missing constraint can fail if historic overlapping appointments already exist; do not delete or alter real appointments to force the migration through.

The new empty hosted Preview database has not had any tenant provisioned by the agent. Its first business creation will install the extension in public and apply the corrected template. No hosted extension relocation or existing-tenant migration was performed by this work.

## Validation

- 19 unit/guard/build/disposable PostgreSQL API tests passed locally.
- 5 Edge browser scenarios passed with synthetic local data, including the exact generated Preview UI and actual API: UI registration, business creation, service price 120, owner appointment prices 135/0 and captured-provider reset/session revocation/new login.
- The API regression now checks that both businesses have independent overlap constraints and that the second business also rejects a duplicate booking while allowing independent bookings in separate businesses.
- Root index/booking/reset files were not edited; the API keeps existing behavior outside the gated Preview routes.
- Hosted frontend serving, actual hosted UI writes and real email delivery still require verification after the new Preview build. Vercel's access protection prevents the agent from using the owner's authenticated browser session.

## Remaining mail setup

No real email has been sent. The user authorized one test email to `goshen.r@gmail.com`. Before that test configure a verified sender and server-only `RESEND_API_KEY`, `PASSWORD_RESET_FROM`, and `PASSWORD_RESET_URL` for Preview. The reset URL must use the same current Preview branch-alias origin followed by `/reset-password.html`. Do not use the Production API/reset page or a local-only URL. Then verify delivery, one successful reset, replay rejection, old-session/password rejection and new login against the hosted test account.

PR #7 remains draft. No main merge, Production deploy, Production variable change or Production migration is part of this Preview change.
