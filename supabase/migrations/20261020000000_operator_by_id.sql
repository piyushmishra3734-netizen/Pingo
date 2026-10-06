-- The operator is an account, not a username.
--
-- Every operator rule asked `profiles.username = 'piuxxh'`. A username is a
-- label anybody can pick once it is free: on 2026-10-03 the operator renamed
-- to `piuxxh__`, a new account took `piuxxh` minutes later, and the operator
-- powers - the update card, intro slides, splash art, missions, push health -
-- went with the name. Pinned to the account id instead, which never changes.

create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = 'f32129ea-9ecd-4e56-a67c-d9837e9e2cc2'::uuid;
$$;

revoke execute on function public.is_operator() from public, anon;
grant execute on function public.is_operator() to authenticated;

alter policy "operator upserts app splash" on public.app_splash
  using (public.is_operator()) with check (public.is_operator());
alter policy "operator upserts onboarding slides" on public.onboarding_slides
  using (public.is_operator()) with check (public.is_operator());
alter policy "operator writes missions" on public.missions
  using (public.is_operator()) with check (public.is_operator());
alter policy "operator writes the update notice" on public.update_notice
  using (public.is_operator()) with check (public.is_operator());

alter policy "operator deletes onboarding media" on storage.objects
  using (bucket_id = 'onboarding' and public.is_operator());
alter policy "operator updates onboarding media" on storage.objects
  using (bucket_id = 'onboarding' and public.is_operator())
  with check (bucket_id = 'onboarding' and public.is_operator());
alter policy "operator uploads onboarding media" on storage.objects
  with check (bucket_id = 'onboarding' and public.is_operator());

create or replace function public.is_ai_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_operator();
$$;

-- The two health readouts also let kashish_ in; kept, by id as well.
create or replace function public.push_health()
returns table(delivered bigint, dead_letters bigint, queued bigint, pruned_tokens bigint, retries_before_success bigint, avg_latency_ms numeric, success_rate_percent numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_operator() or auth.uid() = '7e9b3e44-52b0-41a1-b514-7a25f46ac72b'::uuid) then
    raise exception 'not allowed';
  end if;

  return query select * from public.push_metrics;
end;
$$;

create or replace function public.notification_engagement()
returns table(kind text, delivered bigint, opened bigint, ignored bigint, open_rate_percent numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_operator() or auth.uid() = '7e9b3e44-52b0-41a1-b514-7a25f46ac72b'::uuid) then
    raise exception 'not allowed';
  end if;

  return query
  select
    n.kind::text,
    count(*)::bigint as delivered,
    count(n.opened_at)::bigint as opened,
    (count(*) - count(n.opened_at))::bigint as ignored,
    case when count(*) = 0 then null
         else round(100.0 * count(n.opened_at) / count(*), 1)
    end as open_rate_percent
  from public.notifications n
  where n.created_at < now() - interval '1 hour'
    and n.created_at > now() - interval '30 days'
  group by n.kind
  order by count(*) desc;
end;
$$;
