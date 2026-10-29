create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.app_users add column if not exists is_platform_admin boolean not null default false;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  business_type text not null default 'עסק שירות אחר',
  schema_name text not null unique check (schema_name ~ '^tenant_[a-z0-9_]+$'),
  public_id uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index if not exists businesses_owner_id_idx on public.businesses(owner_id);

-- Password reset tokens are random, hashed, expiring and consumed atomically.
alter table public.app_users add column if not exists password_reset_token_hash text;
alter table public.app_users add column if not exists password_reset_expires_at timestamptz;
alter table public.app_users add column if not exists token_version integer not null default 0;
create unique index if not exists app_users_password_reset_token_idx
  on public.app_users(password_reset_token_hash) where password_reset_token_hash is not null;
create table if not exists public.password_reset_limits (
  key_hash text primary key,
  attempts integer not null,
  window_ends_at timestamptz not null
);
create index if not exists password_reset_limits_expiry_idx on public.password_reset_limits(window_ends_at);
