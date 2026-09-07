/*
 * Recovered from the database - see the note in
 * `20260932000001_device_key_seen_column_privilege.sql` for how it went missing.
 *
 * The sweep keeps a device only while it is one of the eight most recently
 * published for that account and has been seen inside forty-five days. Rank 1 is
 * always spared regardless of age, so an account that has been quiet for a year
 * still has the device it signed in on and does not come back to an empty list.
 */

create or replace function public.prune_stale_device_keys()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
begin
  with ranked as (
    select device_id,
           row_number() over (partition by user_id order by key_seen_at desc) as rank,
           key_seen_at
      from public.device_keys
  )
  delete from public.device_keys d
   using ranked r
   where r.device_id = d.device_id
     and r.rank > 1
     and (r.rank > 8 or r.key_seen_at < now() - interval '45 days');

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_stale_device_keys() from anon, authenticated;
