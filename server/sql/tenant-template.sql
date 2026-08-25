create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists business_settings (
  id boolean primary key default true check (id), brand_color text not null default '#d85f91',
  slot_length integer not null default 30 check (slot_length between 15 and 480),
  treatments text[] not null default '{}', updated_at timestamptz not null default now()
);

create table if not exists resources (
  id uuid primary key default gen_random_uuid(), name text not null,
  resource_type text not null default 'איש צוות', capacity integer not null default 1 check (capacity between 1 and 20),
  is_active boolean not null default true, created_at timestamptz not null default now(), unique(name)
);

create table if not exists business_hours (
  day_of_week integer primary key check (day_of_week between 0 and 6), opens_at time, closes_at time,
  is_closed boolean not null default false,
  check ((is_closed and opens_at is null and closes_at is null) or (not is_closed and opens_at is not null and closes_at is not null and opens_at < closes_at))
);
insert into business_hours (day_of_week, opens_at, closes_at, is_closed) values
  (0, '09:00', '17:00', false), (1, '09:00', '17:00', false), (2, '09:00', '17:00', false),
  (3, '09:00', '17:00', false), (4, '09:00', '17:00', false), (5, '09:00', '13:00', false),
  (6, null, null, true) on conflict (day_of_week) do nothing;

create table if not exists services (
  id uuid primary key default gen_random_uuid(), name text not null, price numeric(10,2) not null default 0 check (price >= 0),
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  preparation_minutes integer not null default 0 check (preparation_minutes between 0 and 180),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 180),
  is_active boolean not null default true, created_at timestamptz not null default now(), unique(name)
);
alter table services add column if not exists preparation_minutes integer not null default 0 check (preparation_minutes between 0 and 180);
alter table services add column if not exists buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 180);

create table if not exists service_resources (
  service_id uuid not null references services(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade, primary key (service_id, resource_id)
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(), full_name text not null, phone text not null,
  notes text, created_at timestamptz not null default now()
);

create unique index if not exists customers_full_name_phone_key on customers (full_name, phone);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(), customer_id uuid references customers(id) on delete set null,
  customer_name text not null, phone text, service_id uuid references services(id) on delete set null, service_name text not null,
  resource_id uuid references resources(id) on delete set null, price numeric(10,2) not null default 0 check (price >= 0),
  starts_at timestamptz not null, ends_at timestamptz, notes text, status text not null default 'ממתין', created_at timestamptz not null default now()
);
alter table appointments add column if not exists service_id uuid references services(id) on delete set null;
alter table appointments add column if not exists resource_id uuid references resources(id) on delete set null;
alter table appointments add column if not exists ends_at timestamptz;
update appointments set ends_at = starts_at + interval '60 minutes' where ends_at is null;
alter table appointments alter column ends_at set not null;
alter table appointments drop constraint if exists appointments_status_check;
alter table appointments add constraint appointments_status_check check (status in ('ממתין', 'מאושר', 'הושלם', 'בוטל', 'לא הגיע'));
alter table appointments drop constraint if exists appointments_ends_after_starts_check;
alter table appointments add constraint appointments_ends_after_starts_check check (ends_at > starts_at);
create index if not exists appointments_starts_at_idx on appointments(starts_at);
create index if not exists appointments_resource_starts_at_idx on appointments(resource_id, starts_at);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_resource_time_exclusion') then
    alter table appointments add constraint appointments_resource_time_exclusion
      exclude using gist (resource_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
      where (status <> 'בוטל' and resource_id is not null);
  end if;
end $$;

create table if not exists time_blocks (
  id uuid primary key default gen_random_uuid(), resource_id uuid references resources(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null, reason text,
  created_at timestamptz not null default now(), check (ends_at > starts_at)
);
create index if not exists time_blocks_resource_starts_at_idx on time_blocks(resource_id, starts_at);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(), full_name text not null, phone text not null, service_name text, message text,
  source text not null default 'קישור לקוחות', status text not null default 'חדש' check (status in ('חדש','בטיפול','נקבעה שיחה','נסגר','לא רלוונטי')),
  created_at timestamptz not null default now()
);
create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(), full_name text not null, phone text not null,
  service_name text, preference text, created_at timestamptz not null default now()
);
create table if not exists packages (
  id uuid primary key default gen_random_uuid(), customer_name text not null, name text not null,
  total_sessions integer not null check (total_sessions > 0), used_sessions integer not null default 0 check (used_sessions between 0 and total_sessions),
  price numeric(10,2) not null default 0 check (price >= 0), created_at timestamptz not null default now()
);
