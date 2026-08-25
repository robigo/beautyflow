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
