-- One push call per message, not one per person in the room.
--
-- ## What this finishes
--
-- 20260941000000 stopped starting a push for somebody with no device, which
-- removed 79% of the invocations on today's traffic. It did nothing about the
-- shape underneath: a message to N people was still N Edge Function calls, each
-- with its own dedupe query and its own device lookup. That shape is what took
-- the API down on 29 August, and it comes back the day a group exists where
-- everybody *does* have a token.
--
-- So the fan-out moves inside one call. Two changes, and they only work
-- together:
--
--   1. `on_message_insert` writes every recipient's notification in a single
--      `insert ... select` instead of looping and inserting one at a time.
--   2. `notifications_push` becomes a statement trigger over a transition
--      table, so one insert - however many rows - is one `net.http_post`
--      carrying an array of recipients.
--
-- Either alone is pointless. A statement trigger over a loop of single-row
-- inserts still fires per row; a batched insert under a row trigger still calls
-- out per row.
--
-- `push-send` was deployed first and accepts both shapes - a bare payload is a
-- batch of one - so the retry worker, which still sends one row at a time, and
-- every other trigger that calls `notify_user` for a single person keep working
-- with no change and no deploy ordering to get wrong.
--
-- ## What is preserved deliberately
--
-- *A failed notification never blocks a message.* `notify_user` swallowed its
-- own errors, and losing that would mean a bad trigger stops people talking.
-- The set-based insert is wrapped in its own exception block for the same
-- reason.
--
-- *The unread count, the preview preference and the actor's name* are still
-- per recipient. They are gathered in one query now rather than four per
-- person, which is the other half of the saving - the old trigger ran a
-- `count(*)` for every member of the group on every message.
--
-- *The device-token guard from 20260941000000* survives as a `where` clause,
-- and the "no devices is not a failure" rule still lives in `push-send` for
-- the retry worker's sake.
--
-- ## The cap
--
-- A hundred recipients per request. The largest conversation today has nine
-- members, so nothing is chunked in practice - but a single request carrying a
-- thousand people would build a payload pg_net has to hold and ask one
-- invocation to make a thousand FCM calls inside one timeout. Chunking costs a
-- loop that almost never runs a second pass.

-- ---------------------------------------------------------------------------
-- 1. Every recipient in one insert
-- ---------------------------------------------------------------------------

create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  event_kind text;
  mentioned jsonb;
begin
  -- System notices are not messages for the inbox.
  if new.kind = 'system' then
    return new;
  end if;

  event_kind := case new.kind
    when 'snap' then 'snap'
    when 'voice' then 'voice'
    when 'call' then 'call'
    else 'message'
  end;

  mentioned := case
    when new.meta is not null and new.meta ? 'mentionedUserIds'
      then new.meta->'mentionedUserIds'
    else '[]'::jsonb
  end;

  /*
   * One statement, so the push trigger below sees one group rather than N
   * separate events. The exception block is what `notify_user` used to
   * provide: a notification that cannot be written must never stop the message
   * that caused it.
   */
  begin
    insert into public.notifications (user_id, actor_id, kind, subject_id)
    select cm.user_id,
           new.sender_id,
           case
             when mentioned @> to_jsonb(cm.user_id::text)
               or mentioned @> jsonb_build_array(cm.user_id)
             then 'mention'
             else event_kind
           end,
           new.conversation_id
      from public.conversation_members cm
     where cm.conversation_id = new.conversation_id
       and cm.user_id <> new.sender_id
       -- Muted threads stay quiet, including @mentions (same as WhatsApp mute).
       -- Computed from `muted_until`, so a mute that has run out is already over.
       and (cm.muted_until is null or cm.muted_until <= now());
  exception
    when others then
      null;
  end;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. One call for the whole statement
-- ---------------------------------------------------------------------------

create or replace function public.on_notification_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  secret text;
  base_url text := 'https://lppzoqgvshhmxqsvggug.supabase.co/functions/v1/push-send';
  chunk record;
  any_target boolean;
begin
  /*
   * Is there anybody to send to at all? Asked before the vault is opened,
   * because on this product most recipients have never granted notification
   * permission and the answer is usually no.
   */
  select exists (
    select 1
      from inserted i
     where public.push_allowed(i.user_id, i.kind)
       and exists (select 1 from public.device_tokens d where d.user_id = i.user_id)
  ) into any_target;

  if not any_target then
    return null;
  end if;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'push_trigger_secret';

  if secret is null then
    insert into public.push_failures (notification_id, user_id, reason)
    select i.id, i.user_id, 'push_trigger_secret missing from vault' from inserted i
    on conflict (notification_id) do nothing;
    return null;
  end if;

  /*
   * Everything each recipient needs, gathered once.
   *
   * The unread count is the expensive part and used to run once per member of
   * the group, per message. One lateral over the statement's rows replaces the
   * lot.
   */
  for chunk in
    select jsonb_agg(payload) as recipients
      from (
        select jsonb_build_object(
                 'notificationId', i.id,
                 'userId', i.user_id,
                 'kind', i.kind,
                 'actorId', i.actor_id,
                 'actorName', coalesce(p.display_name, 'Someone'),
                 'subjectId', i.subject_id,
                 'count', u.unread,
                 'preview', coalesce(np.preview, 'sender_only')
               ) as payload,
               (row_number() over (order by i.id) - 1) / 100 as bucket
          from inserted i
          left join public.profiles p on p.id = i.actor_id
          left join public.notification_prefs np on np.user_id = i.user_id
          join lateral (
            select count(*) as unread
              from public.notifications n
             where n.user_id = i.user_id
               and n.kind = i.kind
               and n.actor_id is not distinct from i.actor_id
               and n.read_at is null
          ) u on true
         where public.push_allowed(i.user_id, i.kind)
           and exists (select 1 from public.device_tokens d where d.user_id = i.user_id)
      ) ready
     group by bucket
  loop
    perform net.http_post(
      url := base_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-pingo-push-secret', secret
      ),
      body := jsonb_build_object('recipients', chunk.recipients),
      timeout_milliseconds := 10000
    );
  end loop;

  return null;
exception
  when others then
    insert into public.push_failures (notification_id, user_id, reason, kind, actor_id)
    select i.id, i.user_id, left(sqlerrm, 500), i.kind, i.actor_id from inserted i
    on conflict (notification_id) do nothing;
    return null;
end;
$function$;

/*
 * Recreated rather than altered: a trigger cannot change from row-level to
 * statement-level in place, and the transition table has to be declared here
 * rather than in the function.
 */
drop trigger if exists notifications_push on public.notifications;

create trigger notifications_push
  after insert on public.notifications
  referencing new table as inserted
  for each statement
  execute function public.on_notification_push();
