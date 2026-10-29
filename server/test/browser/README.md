# Isolated pilot browser checks

The owner test creates a service priced at 120, books appointments priced at 135 and 0, and checks both the UI and persisted API data after refresh and logout/login. It clears local storage before the second login, so a stale browser cache cannot satisfy the assertions. The public booking test checks that the service price is displayed and saved on the appointment.

GitHub Actions runs the existing API test and these Chromium checks for pull requests targeting `beautyflow-v1` and pushes to that branch. Each job uses a disposable PostgreSQL 16 service. Both the workflow and browser suite require the exact database host `127.0.0.1` and database name `beautyflow_ci` before database operations.

The test imports the real Express app and serves the real repository HTML from one ephemeral loopback HTTP server. Only test HTTP responses rewrite the hardcoded API/Supabase URLs and CDN scripts to local addresses. The real Chart.js and Supabase SDKs are served from test dependencies. All browser requests outside this local origin, and all legacy Supabase requests, are blocked and fail the test. Service workers are disabled. No real deployed application or Supabase database is used.

Run from `server/`, with a disposable PostgreSQL 16 instance available:

```sh
export DATABASE_URL=postgresql://beautyflow_ci:beautyflow_ci_only@127.0.0.1:5432/beautyflow_ci
export JWT_SECRET=disposable-ci-secret-not-for-production
node --input-type=module -e "const u = new URL(process.env.DATABASE_URL); if (u.hostname !== '127.0.0.1' || u.pathname !== '/beautyflow_ci') process.exit(1)"
pnpm install --frozen-lockfile
pnpm run db:migrate
npm ci --prefix test/browser --ignore-scripts
test/browser/node_modules/.bin/playwright install --with-deps chromium
npm test --prefix test/browser
```

Failure screenshots contain only synthetic test data and are uploaded by CI for seven days. Test tools are separate from production server dependencies.
