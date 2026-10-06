# BeautyFlow pilot on an isolated Oracle VM

This stack runs the repository's API and static pages with a new local PostgreSQL database. It does not use the existing Vercel API or Supabase database. It is an SSH-tunnel-only trial, not a public site. It leaves the development Codespaces `docker-compose.yml` untouched.

## Before connecting

- Use Oracle Linux VM with enough free memory and disk; the E2.1.Micro has only 1 GB RAM, so measure memory, swap, and response time before relying on it. Running Docker and PostgreSQL may prove too heavy.
- Install Docker Engine and the Compose plugin on the VM and verify SSH connectivity.
- No existing production database URL or credentials are needed.

## Launch (from the repository root on the VM)

1. `cp deploy/pilot/pilot.env.example deploy/pilot/pilot.env`
2. Put **two different** values from `openssl rand -hex 32` into `PILOT_DB_PASSWORD` and `PILOT_JWT_SECRET` in `deploy/pilot/pilot.env`. Keep this file on the VM. Use only hex characters in the database password because it is embedded in a URL.
3. `docker compose --env-file deploy/pilot/pilot.env -f deploy/pilot/compose.yaml up -d --build`
4. `docker compose --env-file deploy/pilot/pilot.env -f deploy/pilot/compose.yaml ps`
5. On the VM, check `curl -fsS http://127.0.0.1:8080/api/health` and `curl -fsS http://127.0.0.1:8080/`.

If the migration fails, view its logs using `docker compose --env-file deploy/pilot/pilot.env -f deploy/pilot/compose.yaml logs migrate`; the API will not start until it succeeds. Migration runs **only** with the internal hostname `db` and database `beautyflow_pilot`. The PostgreSQL volume persists across ordinary restarts. Do not run `down -v` if you want to keep pilot data.

From the Windows PC, create an SSH tunnel with the SSH key for this VM. Substitute values on your own machine; do not put the key or VM details in the repository:

`ssh -N -L 8080:127.0.0.1:8080 -i "<PRIVATE_KEY_PATH>" <VM_USER>@<VM_PUBLIC_IP>`

Open `http://localhost:8080/` on that PC. Create a new owner account and business, add a resource and service with a nonzero price, open the generated customer booking link, book a time, and confirm the appointment and price in the owner workspace after reload/login.

The HTML copied into the image points API requests to the same origin. Its legacy Supabase URL is replaced with a local unused path; old demo or unfinished Supabase-only screens may still need separate work. No public HTTPS ingress is configured. Keep the existing hosted site unchanged while validating this pilot.
