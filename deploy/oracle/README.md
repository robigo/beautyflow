# BeautyFlow Oracle deployment

This directory prepares the BeautyFlow API for a staged Oracle VM deployment.

## Intended architecture

```text
Vercel frontend
      |
    HTTPS
      |
WAF/CDN (later gate)
      |
Caddy on Oracle VM :443
      |
BeautyFlow API container :3000 (private only)
      |
Managed PostgreSQL / Supabase-compatible PostgreSQL
```

The production Compose file does **not** publish port 3000 or 5432.

## Safety rules

- Do not commit `.env.production`.
- Do not put JWT/database/admin secrets in the Docker image.
- `./deploy.sh all` never runs a migration.
- A migration is possible only with the explicit command:
  `ALLOW_MIGRATIONS=YES ./deploy.sh migrate`
- Review the production `DATABASE_URL` immediately before any migration.
- Keep Vercel production endpoints unchanged until staging verification is complete.

## First-time preparation on the Oracle VM

1. Install Docker Engine + Docker Compose v2 using the supported Oracle Linux procedure.
2. Clone the repository and checkout the approved deployment branch.
3. Enter this directory.
4. Create the secret file:

   ```bash
   cp .env.production.example .env.production
   chmod 600 .env.production
   ```

5. Set:
   - `API_DOMAIN`
   - `CLIENT_ORIGIN`
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `PLATFORM_ADMIN_EMAIL`

6. Point DNS for `API_DOMAIN` to the Oracle VM public IP.
7. At the OCI network layer and OS firewall, expose only:
   - TCP 80 (HTTP redirect / certificate issuance)
   - TCP 443 (HTTPS)
   - SSH only from an approved source range where possible

Do **not** expose 3000 or 5432.

## Staged deployment

Run each step separately:

```bash
./deploy.sh preflight
./deploy.sh build
./deploy.sh up
./deploy.sh verify
./security-check.sh
```

The stack can be inspected with:

```bash
./deploy.sh status
./deploy.sh logs
```

## Database migration

Migration is deliberately separate from deployment.

Only after the target DB has been reviewed and backed up:

```bash
ALLOW_MIGRATIONS=YES ./deploy.sh migrate
```

Then run:

```bash
./deploy.sh verify
./security-check.sh
```

## Before switching Vercel frontend to Oracle API

Required gates:

- GitHub pilot checks pass.
- HTTPS health endpoint passes.
- Tenant isolation/auth flows have been tested against staging.
- CORS allows only the intended Vercel domain(s).
- Rate limiting or an approved WAF/API protection layer is enabled for public auth/booking endpoints.
- Database backup and restore procedure is confirmed.
- No secrets appear in Git history or client-side bundles.
- Production migration was explicitly reviewed.

Only after these gates should the frontend API base URL be changed.
