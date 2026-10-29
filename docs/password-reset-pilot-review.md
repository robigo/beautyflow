# Password reset pilot integration — 2026-10-29

## Branch and project evidence

- Integration base: `beautyflow-v1`, commit `23b279008252ad5edd6fb0a8b3664bfa7f78804d` (11 commits ahead of main).
- Source: [PR #5](https://github.com/robigo/beautyflow/pull/5), commit `67ad339139384ef15353c59f1937a7e7005df155`, based on main.
- Shipped frontend (`index.html`, `booking.html`, and the reset page) targets `https://beautyflow-ihl7.vercel.app`. The active deployment mapping was subsequently verified from the user's settings screenshots (see below).
- [Vercel bot evidence](https://github.com/robigo/beautyflow/pull/5#issuecomment-6500631737): `beautyflow-ihl7` has Root Directory `server`; `beautyflow` has repository-root configuration. A successful static frontend build does not prove API readiness.
- Both Vercel projects reported success on beautyflow-v1's head. [Pilot CI on that head](https://github.com/robigo/beautyflow/actions/runs/37355400192) passed API, booking and browser price-persistence checks.
- User-provided screenshots on 2026-10-29 confirm GitHub Pages at `https://robigo.github.io/beautyflow/` deploys from `main`, `/ (root)`. Its exact served frontend SHA has not been fingerprinted.
- User-provided Vercel screenshots confirm `beautyflow-ihl7.vercel.app` is assigned to the Ready Production deployment sourced from `main`, commit `424c45e`, created 2026-09-06. The UI says pushes to `main` update Production.
- The Vercel connector remains disabled by the workspace administrator. Private build logs, database isolation and environment configuration remain unverified; screenshots establishing the branch mapping do not establish these dependencies.

## Preserved behavior

The integration adds reset routes and login session versioning to beautyflow-v1. It keeps the owner appointment expression `item.price ?? service?.price ?? 0`; copying PR #5's server file wholesale would revert it. Existing public booking, resource conflict, browser price persistence and fresh-login tests remain in place.

## Failed deployment investigation

[Failed API deployment](https://vercel.com/robigos-projects/beautyflow-ihl7/7pXL5zd2KGcbiTYNtndQdRs5EA2o): GitHub reports failure without diagnostic logs. PR #5 still runs `src/migrate.js` during `vercel-build`, while beautyflow-v1 uses a Preview guard. This proves the missing guard, but does not establish the exact cause of that deployment failure. The integrated build now has no database or mail dependencies and never migrates, including Production builds. No Vercel setting was changed and no manual deployment was initiated.

## Validation

- Locally passed: nine password reset handler/mail tests; three build safety tests with no database or mail credentials; JavaScript and inline HTML script syntax; diff whitespace checks.
- Added CI integration test uses only a guarded local `beautyflow_ci` database and intercepts Resend in memory: hashed token storage, replacement and expiry, one-time use, old password rejection, old JWT rejection, new login success.
- Added browser test mocks API responses and blocks unrelated requests: request submission, unavailable service, fragment removal, password mismatch, success, invalid/expired token and mobile overflow. Existing booking/price browser tests are retained.
- Integration head `b76e82de215bc49a3d4bfc6ba6c1f1d0da1b4aeb` passed [CI](https://github.com/robigo/beautyflow/actions/runs/40909263894): 12 unit/build tests, 2 disposable PostgreSQL API tests and 3 Chromium browser tests. Both automatic Vercel Preview builds also succeeded. These results do not establish actual mail delivery or Production schema readiness.
- CI also covers pull requests targeting `main`, so the full promotion candidate is checked with a disposable database. CI migration never targets a hosted database.

## Before an actual email end-to-end test

1. Live entry and API Production source are verified above. Choose a matched frontend/API Preview pair; the current reset page intentionally still targets the existing API host and must not be used for a Preview email test until that target is replaced with the isolated Preview API URL.
2. Confirm a separate Preview database containing synthetic test accounts only. Review the additive platform SQL (token hash, expiry, session version and limits table). Apply it separately only after verifying the target. Deploying new auth middleware before these columns exist breaks authenticated requests.
3. Set `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, `RESEND_API_KEY`, `PASSWORD_RESET_FROM` (verified sending domain) and `PASSWORD_RESET_URL` (the matching frontend's reset page) through the hosting secret/environment controls. Never commit real values. `CLIENT_ORIGIN` is an origin, without a path, and must match the chosen frontend.
4. Use a consenting test recipient/account; verify delivery, one successful reset, old JWT/password rejection, replay rejection and new login. Also check expired/replaced links and service-unavailable behavior. No real mail was sent by this work.
5. Keep Production migration/deployment blocked until the above mapping, schema and environment dependencies are verified and the intended Production action is approved.

## Production promotion

`beautyflow-v1` is the integration base, while `main` drives both live entry points. The complete candidate must carry forward the eleven later pilot commits plus the reset integration; merging PR #5 alone loses the intended booking/price improvements. Review the full candidate against main and keep it draft until the isolated email E2E test passes.

Before Production: verify the actual target database and recovery plan; confirm required server variables and verified sender; apply the reviewed additive schema separately before activating auth middleware that queries token_version; release matching server/frontend versions and verify login, booking and preserved prices. Builds never migrate. Never commit real credentials. Do not promote merely because builds are green.
