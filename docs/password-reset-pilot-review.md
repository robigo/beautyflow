# Password reset pilot integration — 2026-10-29

## Branch and project evidence

- Integration base: `beautyflow-v1`, commit `23b279008252ad5edd6fb0a8b3664bfa7f78804d` (11 commits ahead of main).
- Source: [PR #5](https://github.com/robigo/beautyflow/pull/5), commit `67ad339139384ef15353c59f1937a7e7005df155`, based on main.
- Shipped frontend (`index.html`, `booking.html`, and the reset page) targets `https://beautyflow-ihl7.vercel.app`. This identifies the API project used by the code, not a verified Vercel Production Branch setting.
- [Vercel bot evidence](https://github.com/robigo/beautyflow/pull/5#issuecomment-6500631737): `beautyflow-ihl7` has Root Directory `server`; `beautyflow` has repository-root configuration. A successful static frontend build does not prove API readiness.
- Both Vercel projects reported success on beautyflow-v1's head. [Pilot CI on that head](https://github.com/robigo/beautyflow/actions/runs/37355400192) passed API, booking and browser price-persistence checks.
- Vercel project settings, actual pilot entry URL/served SHA, and private build logs could not be inspected. The Vercel connection is disabled by the workspace administrator. Do not claim the live production-branch mapping is verified.

## Preserved behavior

The integration adds reset routes and login session versioning to beautyflow-v1. It keeps the owner appointment expression `item.price ?? service?.price ?? 0`; copying PR #5's server file wholesale would revert it. Existing public booking, resource conflict, browser price persistence and fresh-login tests remain in place.

## Failed deployment investigation

[Failed API deployment](https://vercel.com/robigos-projects/beautyflow-ihl7/7pXL5zd2KGcbiTYNtndQdRs5EA2o): GitHub reports failure without diagnostic logs. PR #5 still runs `src/migrate.js` during `vercel-build`, while beautyflow-v1 uses a Preview guard. This proves the missing guard, but does not establish the exact cause of that deployment failure. The integrated build now has no database or mail dependencies and never migrates, including Production builds. No Vercel setting was changed and no manual deployment was initiated.

## Validation

- Locally passed: nine password reset handler/mail tests; three build safety tests with no database or mail credentials; JavaScript and inline HTML script syntax; diff whitespace checks.
- Added CI integration test uses only a guarded local `beautyflow_ci` database and intercepts Resend in memory: hashed token storage, replacement and expiry, one-time use, old password rejection, old JWT rejection, new login success.
- Added browser test mocks API responses and blocks unrelated requests: request submission, unavailable service, fragment removal, password mismatch, success, invalid/expired token and mobile overflow. Existing booking/price browser tests are retained.
- Local PostgreSQL and browser execution were unavailable; npm dependency download was denied by network policy. New full integration/browser results must be read from the integration PR's CI, not inferred from prior successful runs.

## Before an actual email end-to-end test

1. Confirm pilot entry URL, the Vercel API project's configured Production Branch and the served commit. Choose a matched frontend/API Preview pair; the current reset page intentionally still targets the existing API host and must not be used for a Preview email test until that target is replaced with the isolated Preview API URL.
2. Confirm a separate Preview database containing synthetic test accounts only. Review the additive platform SQL (token hash, expiry, session version and limits table). Apply it separately only after verifying the target. Deploying new auth middleware before these columns exist breaks authenticated requests.
3. Set `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, `RESEND_API_KEY`, `PASSWORD_RESET_FROM` (verified sending domain) and `PASSWORD_RESET_URL` (the matching frontend's reset page) through the hosting secret/environment controls. Never commit real values. `CLIENT_ORIGIN` is an origin, without a path, and must match the chosen frontend.
4. Use a consenting test recipient/account; verify delivery, one successful reset, old JWT/password rejection, replay rejection and new login. Also check expired/replaced links and service-unavailable behavior. No real mail was sent by this work.
5. Keep Production migration/deployment blocked until the above mapping, schema and environment dependencies are verified and the intended Production action is approved.
