-- BeautyFlow platform administrator setup
-- Run this in Supabase Dashboard > SQL Editor after the user has registered.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

grant execute on function public.is_platform_admin() to authenticated;

insert into public.platform_admins (user_id)
select id from auth.users where email = 'goshen.r@gmail.com'
on conflict (user_id) do nothing;

-- The existing owner policies remain active. These additional permissive
-- policies let a platform administrator manage every tenant's data.
create policy "platform admins manage businesses" on public.businesses
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "platform admins manage services" on public.services
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "platform admins manage customers" on public.customers
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "platform admins manage leads" on public.leads
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "platform admins manage appointments" on public.appointments
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "platform admins manage waitlist" on public.waitlist_entries
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "platform admins manage packages" on public.packages
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "platform admins view admin list" on public.platform_admins
  for select to authenticated using (public.is_platform_admin());
