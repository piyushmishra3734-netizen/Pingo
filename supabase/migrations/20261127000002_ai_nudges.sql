-- PINGO AI reaches out to somebody who has been away: one line, picked up from
-- where the two of them left off, delivered as a normal push.
--
-- The decision of WHO lives here, in one place, so it is easy to read and to
-- change. The words are written by the `ai-nudge` edge function, which asks this
-- for candidates and posts the message (the existing message trigger turns it
-- into a notification, which `push_allowed` and the person's own settings still
-- govern).
--
-- Rules, all in `ai_nudge_candidates`:
--   * has PINGO AI's main thread, and has written in it before (there is a
--     "last conversation" to pick up);
--   * nothing from them (any message, or the app opening) for the idle window;
--   * a phone that can be reached, notifications for messages AND for PINGO AI
--     on, not paused, not in their quiet hours - the person's settings win;
--   * not a banned account;
--   * their local time is between 10:00 and 21:00;
--   * at most one nudge in 5 days, and never more than 3 in a row without them
--     writing back - after that PINGO AI waits until they do.
--
-- The cron job is NOT created here. It is switched on separately, after a dry
-- run, with `select public.ai_nudge_enable()`; `ai_nudge_disable()` stops it.

create table if not exists public.ai_nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  message_id uuid,
  sent_at timestamptz not null default now()
);
create index if not exists ai_nudges_user_sent on public.ai_nudges (user_id, sent_at desc);
alter table public.ai_nudges enable row level security;
-- No policies: only the service role (the edge function) reads or writes this.

create or replace function public.ai_nudge_candidates(
  p_limit integer default 5,
  p_idle interval default interval '2 days',
  -- Only a dry run sets this: it reads what would be written without caring what time it is for them.
  p_any_hour boolean default false
)
returns table (user_id uuid, conversation_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, c.id
    from public.conversations c
    join public.conversation_members m
      on m.conversation_id = c.id and m.deleted_at is null
   where c.kind = 'ai'
     and not c.ai_side
     and m.user_id <> public.pingo_ai_user_id()
     and exists (select 1 from public.device_tokens d where d.user_id = m.user_id)
     and public.push_allowed(m.user_id, 'message')
     and public.push_allowed(m.user_id, 'ai')
     and not exists (
       select 1 from auth.users u
        where u.id = m.user_id and u.banned_until is not null and u.banned_until > now()
     )
     and exists (
       select 1 from public.messages x
        where x.conversation_id = c.id and x.sender_id = m.user_id
     )
     and greatest(
           coalesce((select max(x.created_at) from public.messages x where x.sender_id = m.user_id), 'epoch'::timestamptz),
           coalesce((select max(d.last_seen_at) from public.device_tokens d where d.user_id = m.user_id), 'epoch'::timestamptz)
         ) < now() - p_idle
     and (p_any_hour or extract(hour from (now() at time zone 'utc') + make_interval(
           mins => coalesce(nullif((select p.utc_offset_minutes from public.notification_prefs p where p.user_id = m.user_id), 0), 330)
         )) between 10 and 20)
     and not exists (
       select 1 from public.ai_nudges n
        where n.user_id = m.user_id and n.sent_at > now() - interval '5 days'
     )
     and (
       select count(*) from public.ai_nudges n
        where n.user_id = m.user_id
          and n.sent_at > coalesce((select max(x.created_at) from public.messages x where x.sender_id = m.user_id), 'epoch'::timestamptz)
     ) < 3
   order by random()
   limit p_limit;
$$;
revoke all on function public.ai_nudge_candidates(integer, interval, boolean) from public, anon, authenticated;
grant execute on function public.ai_nudge_candidates(integer, interval, boolean) to service_role;

-- What the cron job runs: ask the edge function to do one round. Same shared
-- secret as the push trigger; it never carries the service role key.
create or replace function public.ai_nudge_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_trigger_secret';
  if secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://gpijpmepzowwhvgkriqu.supabase.co/functions/v1/ai-nudge',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-pingo-push-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
exception when others then
  null;
end;
$$;
revoke all on function public.ai_nudge_tick() from public, anon, authenticated;

-- On and off, by hand. Every 30 minutes, five people at most per round.
create or replace function public.ai_nudge_enable()
returns void language sql security definer set search_path = public as $$
  select cron.schedule('ai-nudge', '*/30 * * * *', $c$select public.ai_nudge_tick()$c$);
$$;
create or replace function public.ai_nudge_disable()
returns void language sql security definer set search_path = public as $$
  select cron.unschedule('ai-nudge');
$$;
revoke all on function public.ai_nudge_enable() from public, anon, authenticated;
revoke all on function public.ai_nudge_disable() from public, anon, authenticated;
