-- A per-person hourly allowance for the polish function, which spends the
-- OpenAI key. The function asks this before it calls OpenAI; it is counted
-- here, in the database, because an edge function instance remembers nothing
-- between requests.

create table if not exists public.polish_calls (
  user_id uuid not null,
  at timestamptz not null default now()
);

create index if not exists polish_calls_user_at on public.polish_calls (user_id, at desc);

alter table public.polish_calls enable row level security;
revoke all on public.polish_calls from public, anon, authenticated;

-- True when the caller may make another call this hour, and counts it.
create or replace function public.polish_allow(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  used integer;
begin
  if me is null then
    return false;
  end if;

  delete from public.polish_calls where user_id = me and at < now() - interval '1 hour';
  select count(*) into used from public.polish_calls where user_id = me;
  if used >= p_limit then
    return false;
  end if;

  insert into public.polish_calls (user_id) values (me);
  return true;
end;
$$;

revoke execute on function public.polish_allow(integer) from public, anon;
grant execute on function public.polish_allow(integer) to authenticated;

notify pgrst, 'reload schema';
