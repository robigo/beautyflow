-- BeautyFlow: multi-tenant backend
-- Run this file once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  business_type text not null default 'עסק שירות אחר',
  brand_color text not null default '#d85f91',
  slot_length integer not null default 60 check (slot_length between 15 and 480),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (business_id, phone)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  phone text not null,
  service_name text,
  message text,
  source text not null default 'קישור לקוחות',
  status text not null default 'חדש' check (status in ('חדש','בטיפול','נקבעה שיחה','נסגר','לא רלוונטי')),
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  phone text,
  service_name text not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  starts_at timestamptz not null,
  notes text,
  status text not null default 'מאושר' check (status in ('מאושר','הושלם','בוטל')),
  created_at timestamptz not null default now()
);

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  phone text not null,
  service_name text,
  preference text,
  created_at timestamptz not null default now()
);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_name text not null,
  name text not null,
  total_sessions integer not null check (total_sessions > 0),
  used_sessions integer not null default 0 check (used_sessions >= 0 and used_sessions <= total_sessions),
  price numeric(10,2) not null default 0 check (price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists appointments_business_starts_at_idx on public.appointments (business_id, starts_at);
create index if not exists leads_business_created_at_idx on public.leads (business_id, created_at desc);

-- This function is deliberately SECURITY DEFINER so RLS checks do not recurse.
create or replace function public.owns_business(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses
    where id = target_business_id and owner_id = auth.uid()
  );
$$;

grant execute on function public.owns_business(uuid) to authenticated;

alter table public.businesses enable row level security;
alter table public.services enable row level security;
alter table public.customers enable row level security;
alter table public.leads enable row level security;
alter table public.appointments enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.packages enable row level security;

create policy "owners manage their business" on public.businesses
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owners manage services" on public.services
  for all to authenticated using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy "owners manage customers" on public.customers
  for all to authenticated using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy "owners manage appointments" on public.appointments
  for all to authenticated using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy "owners manage waitlist" on public.waitlist_entries
  for all to authenticated using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy "owners manage packages" on public.packages
  for all to authenticated using (public.owns_business(business_id)) with check (public.owns_business(business_id));

-- A customer can submit a lead without an account, but cannot read any business data.
create policy "public can submit leads" on public.leads
  for insert to anon, authenticated with check (true);
create policy "owners read and manage their leads" on public.leads
  for select to authenticated using (public.owns_business(business_id));
create policy "owners update their leads" on public.leads
  for update to authenticated using (public.owns_business(business_id)) with check (public.owns_business(business_id));
create policy "owners delete their leads" on public.leads
  for delete to authenticated using (public.owns_business(business_id));
