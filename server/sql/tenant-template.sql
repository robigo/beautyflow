create table if not exists business_settings (
  id boolean primary key default true check (id),
  brand_color text not null default '#d85f91',
  slot_length integer not null default 60 check (slot_length between 15 and 480),
  treatments text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(name)
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null unique,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  customer_name text not null,
  phone text,
  service_name text not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  starts_at timestamptz not null,
  notes text,
  status text not null default 'מאושר' check (status in ('מאושר','הושלם','בוטל')),
  created_at timestamptz not null default now()
);
create index if not exists appointments_starts_at_idx on appointments(starts_at);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  service_name text,
  message text,
  source text not null default 'קישור לקוחות',
  status text not null default 'חדש' check (status in ('חדש','בטיפול','נקבעה שיחה','נסגר','לא רלוונטי')),
  created_at timestamptz not null default now()
);

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  service_name text,
  preference text,
  created_at timestamptz not null default now()
);

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  name text not null,
  total_sessions integer not null check (total_sessions > 0),
  used_sessions integer not null default 0 check (used_sessions between 0 and total_sessions),
  price numeric(10,2) not null default 0 check (price >= 0),
  created_at timestamptz not null default now()
);
