-- PINGO AI daily allowance for free accounts.
--
-- 15 credits a day (India's day: they reset at midnight IST and never carry
-- over): a web search, a picture or a /think reply costs 5 each; plain chat is
-- free. Voice calls: 120 seconds a day. The operator account is unlimited.
--
-- Only the Edge Functions spend (service role): the app can read what is left,
-- never write it.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  credits_used integer not null default 0 check (credits_used >= 0),
  call_seconds integer not null default 0 check (call_seconds >= 0),
  call_started_at timestamptz,
  call_reserved integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
drop policy if exists "own ai usage read" on public.ai_usage;
create policy "own ai usage read" on public.ai_usage
  for select to authenticated using (user_id = auth.uid());
grant select on public.ai_usage to authenticated;

create or replace function public.ai_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

create or replace function public.ai_unlimited(p_user uuid)
returns boolean language sql stable as $$
  select p_user = 'f32129ea-9ecd-4e56-a67c-d9837e9e2cc2'::uuid;
$$;

/** Credits and call seconds left today, for the app. */
create or replace function public.ai_allowance()
returns table (credits_left integer, credits_daily integer, call_seconds_left integer, unlimited boolean)
language sql stable security definer set search_path = public as $$
  select
    case when public.ai_unlimited(auth.uid()) then 9999 else greatest(0, 15 - coalesce(u.credits_used, 0)) end,
    15,
    case when public.ai_unlimited(auth.uid()) then 99999 else greatest(0, 120 - coalesce(u.call_seconds, 0)) end,
    public.ai_unlimited(auth.uid())
  from (select 1) one
  left join public.ai_usage u on u.user_id = auth.uid() and u.day = public.ai_today();
$$;
revoke all on function public.ai_allowance() from public, anon;
grant execute on function public.ai_allowance() to authenticated;

/** Spends credits if there are enough; returns what is left after, or -1 when there were not enough. */
create or replace function public.ai_spend_credits(p_user uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  used integer;
begin
  if public.ai_unlimited(p_user) then return 9999; end if;
  insert into public.ai_usage (user_id, day) values (p_user, public.ai_today())
  on conflict (user_id, day) do nothing;
  update public.ai_usage set credits_used = credits_used + p_amount
  where user_id = p_user and day = public.ai_today() and credits_used + p_amount <= 15
  returning credits_used into used;
  if used is null then return -1; end if;
  return 15 - used;
end;
$$;

/** Credits left without spending, for the function deciding which tools to offer. */
create or replace function public.ai_credits_left(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when public.ai_unlimited(p_user) then 9999
    else greatest(0, 15 - coalesce((select credits_used from public.ai_usage where user_id = p_user and day = public.ai_today()), 0)) end;
$$;

/**
 * A call starting: the seconds it may last, all reserved now so two calls at
 * once cannot both use the full allowance. `ai_call_end` gives back what the
 * call did not use. 0 means no time left today.
 */
create or replace function public.ai_call_start(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  allowed integer;
begin
  if public.ai_unlimited(p_user) then return 0 - 1; end if;
  insert into public.ai_usage (user_id, day) values (p_user, public.ai_today())
  on conflict (user_id, day) do nothing;
  select greatest(0, 120 - call_seconds) into allowed
  from public.ai_usage where user_id = p_user and day = public.ai_today() for update;
  if allowed <= 0 then return 0; end if;
  update public.ai_usage
  set call_seconds = call_seconds + allowed, call_started_at = now(), call_reserved = allowed
  where user_id = p_user and day = public.ai_today();
  return allowed;
end;
$$;

/** A call ended: returns the reserved seconds it did not use (measured here, not told by the app). */
create or replace function public.ai_call_end(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_usage
  set call_seconds = greatest(0, call_seconds - greatest(0, call_reserved - ceil(extract(epoch from now() - call_started_at))::integer)),
      call_started_at = null,
      call_reserved = 0
  where user_id = p_user and day = public.ai_today() and call_started_at is not null;
end;
$$;

revoke all on function public.ai_spend_credits(uuid, integer) from public, anon, authenticated;
revoke all on function public.ai_credits_left(uuid) from public, anon, authenticated;
revoke all on function public.ai_call_start(uuid) from public, anon, authenticated;
revoke all on function public.ai_call_end(uuid) from public, anon, authenticated;
grant execute on function public.ai_spend_credits(uuid, integer) to service_role;
grant execute on function public.ai_credits_left(uuid) to service_role;
grant execute on function public.ai_call_start(uuid) to service_role;
grant execute on function public.ai_call_end(uuid) to service_role;
