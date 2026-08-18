-- Removes only duplicate businesses that have no related server data.
-- Keeps the oldest record for each owner/name/type combination.
-- Run this once in Supabase SQL Editor, then refresh Platform Management.

with ranked as (
  select id,
         row_number() over (
           partition by owner_id, name, business_type
           order by created_at asc, id asc
         ) as row_number
  from public.businesses
), unused_duplicates as (
  select r.id
  from ranked r
  where r.row_number > 1
    and not exists (select 1 from public.services s where s.business_id = r.id)
    and not exists (select 1 from public.customers c where c.business_id = r.id)
    and not exists (select 1 from public.leads l where l.business_id = r.id)
    and not exists (select 1 from public.appointments a where a.business_id = r.id)
    and not exists (select 1 from public.waitlist_entries w where w.business_id = r.id)
    and not exists (select 1 from public.packages p where p.business_id = r.id)
)
delete from public.businesses b
using unused_duplicates d
where b.id = d.id;
