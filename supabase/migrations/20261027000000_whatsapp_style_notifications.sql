-- Chat notifications that behave like WhatsApp's.
--
-- ## What was wrong
--
-- A message notification was only ever marked read from the Activity screen.
-- Reading the chat itself moved `conversation_members.last_read_at` and left
-- every notification for it unread, so:
--   - the push said "47 new messages" for a chat already read twice over, the
--     count being every unread notification from that person, ever;
--   - the tray kept a stale entry for a chat already read, and a burst of new
--     ones for messages already seen;
--   - the Activity badge counted chat messages the inbox had already cleared.
--
-- ## What this does
--
-- 1. Reading a chat marks its chat notifications read, from a trigger on
--    `last_read_at`, so every way of reading (the app, another device, the
--    "Mark as read" button on a notification) does it.
-- 2. When that cleared anything, the person's devices get a silent "clear"
--    push, so the tray entry for that chat goes on every phone, as on WhatsApp.
-- 3. The count in a push is the chat's own unread messages, not the sender's
--    across every chat.
-- 4. A chat push carries what the notification needs to look like a message:
--    the text, who sent it, the chat's name and the sender's picture. Chats
--    are stored as plain text now (end-to-end encryption was retired), and
--    the lock-screen preview setting still decides whether text is shown.
-- 5. The preview default becomes "sender and text", as on WhatsApp.
-- 6. The Activity badge counts activity only: likes, follows, calls and the
--    rest. Chats have their own unread counts on the inbox.
-- 7. A per-device "action key", so a notification's Reply and Mark as read
--    buttons can act for that device's account without opening the app.

-- ---------------------------------------------------------------------------
-- The kinds that are a chat, in one place
-- ---------------------------------------------------------------------------

create or replace function public.is_chat_notification(kind text)
returns boolean
language sql
immutable
as $$
  select kind in ('message', 'voice', 'snap', 'mention', 'ai');
$$;

-- ---------------------------------------------------------------------------
-- 5. WhatsApp's default preview
-- ---------------------------------------------------------------------------

alter table public.notification_prefs alter column preview set default 'sender_and_text';
-- Nobody could tell "chose sender only" from "never opened the setting", and
-- almost nobody has opened it. The setting is still there to turn text off.
update public.notification_prefs set preview = 'sender_and_text' where preview = 'sender_only';

-- ---------------------------------------------------------------------------
-- 7. The device action key
-- ---------------------------------------------------------------------------

alter table public.device_tokens add column if not exists action_key_hash text;

/*
 * The app makes a random key per device, keeps it on the device, and sends
 * its SHA-256 here. A notification's Reply / Mark as read sends the key with
 * the device's push token to `push-action`, which checks the hash. Only the
 * hash is stored, and only for a token this account owns.
 */
create or replace function public.set_push_action_key(p_token text, p_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad key hash';
  end if;
  update public.device_tokens
     set action_key_hash = p_hash
   where token = p_token and user_id = auth.uid();
end;
$$;

revoke all on function public.set_push_action_key(text, text) from public, anon;
grant execute on function public.set_push_action_key(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1 + 2. Reading a chat clears its notifications, here and on every device
-- ---------------------------------------------------------------------------

create or replace function public.on_chat_read_clear_notifications()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  cleared integer := 0;
  secret text;
begin
  if new.last_read_at is null or new.last_read_at is not distinct from old.last_read_at then
    return new;
  end if;

  update public.notifications
     set read_at = new.last_read_at
   where user_id = new.user_id
     and subject_id = new.conversation_id
     and public.is_chat_notification(kind)
     and read_at is null
     and created_at <= new.last_read_at;
  get diagnostics cleared = row_count;

  -- Nothing was showing for this chat, so there is nothing to take down.
  if cleared = 0 then
    return new;
  end if;
  if not exists (select 1 from public.device_tokens d where d.user_id = new.user_id) then
    return new;
  end if;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_trigger_secret';
  if secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://gpijpmepzowwhvgkriqu.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-pingo-push-secret', secret),
    body := jsonb_build_object(
      'recipients',
      jsonb_build_array(jsonb_build_object('userId', new.user_id, 'kind', 'clear', 'subjectId', new.conversation_id))
    ),
    timeout_milliseconds := 10000
  );
  return new;
exception
  -- A notification that cannot be cleared must never stop a chat being read.
  when others then
    return new;
end;
$$;

drop trigger if exists chat_read_clears_notifications on public.conversation_members;
create trigger chat_read_clears_notifications
  after update of last_read_at on public.conversation_members
  for each row execute function public.on_chat_read_clear_notifications();

-- What is already stale: chats read since their notifications arrived.
update public.notifications n
   set read_at = cm.last_read_at
  from public.conversation_members cm
 where n.read_at is null
   and public.is_chat_notification(n.kind)
   and cm.user_id = n.user_id
   and cm.conversation_id = n.subject_id
   and cm.last_read_at is not null
   and n.created_at <= cm.last_read_at;

-- ---------------------------------------------------------------------------
-- 6. The Activity badge counts activity
-- ---------------------------------------------------------------------------

create or replace function public.unread_notifications()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.notifications
  where user_id = auth.uid() and read_at is null and not public.is_chat_notification(kind);
$$;

/* Unread activity by kind, for the little popup over the Activity tab. */
create or replace function public.unread_activity_counts()
returns table (kind text, count integer)
language sql
security definer
set search_path = public
stable
as $$
  select n.kind, count(*)::integer
  from public.notifications n
  where n.user_id = auth.uid() and n.read_at is null and not public.is_chat_notification(n.kind)
  group by n.kind;
$$;

revoke all on function public.unread_activity_counts() from public, anon;
grant execute on function public.unread_activity_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 3 + 4. The push: per-chat count, and the message itself
-- (body from 20261001000000; the payload and the count changed)
-- ---------------------------------------------------------------------------

create or replace function public.on_notification_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  secret text;
  base_url text := 'https://gpijpmepzowwhvgkriqu.supabase.co/functions/v1/push-send';
  chunk record;
  any_target boolean;
begin
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

  for chunk in
    select jsonb_agg(payload) as recipients
      from (
        select jsonb_strip_nulls(jsonb_build_object(
                 'notificationId', i.id,
                 'userId', i.user_id,
                 'kind', i.kind,
                 'actorId', i.actor_id,
                 'actorName', coalesce(p.display_name, 'Someone'),
                 'actorAvatar', p.avatar_url,
                 'subjectId', i.subject_id,
                 'count', u.unread,
                 'preview', coalesce(np.preview, 'sender_and_text'),
                 -- The chat side: the newest message from this sender in this chat.
                 'messageId', m.id,
                 'messageKind', m.kind,
                 'text', case when public.is_chat_notification(i.kind) and coalesce(np.preview, 'sender_and_text') = 'sender_and_text'
                              and m.encryption is null then left(m.body, 400) end,
                 'chatTitle', case when c.kind in ('group', 'community') then c.title end,
                 'isGroup', c.kind in ('group', 'community')
               )) as payload,
               (row_number() over (order by i.id) - 1) / 100 as bucket
          from inserted i
          left join public.profiles p on p.id = i.actor_id
          left join public.notification_prefs np on np.user_id = i.user_id
          left join public.conversations c on public.is_chat_notification(i.kind) and c.id = i.subject_id
          left join lateral (
            select msg.id, msg.kind, msg.body, msg.encryption
              from public.messages msg
             where public.is_chat_notification(i.kind)
               and msg.conversation_id = i.subject_id
               and msg.sender_id = i.actor_id
             order by msg.created_at desc
             limit 1
          ) m on true
          join lateral (
            select count(*) as unread
              from public.notifications n
             where n.user_id = i.user_id
               and n.read_at is null
               and (
                 case when public.is_chat_notification(i.kind)
                   -- A chat counts its own unread messages, whoever sent them.
                   then public.is_chat_notification(n.kind) and n.subject_id = i.subject_id
                   else n.kind = i.kind and n.actor_id is not distinct from i.actor_id
                 end
               )
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

-- ---------------------------------------------------------------------------
-- For push-action: read and reply as a device's account
-- ---------------------------------------------------------------------------

/*
 * `mark_conversation_read`, for a given account rather than `auth.uid()`.
 * Only the service role may call it: `push-action` has checked the device's
 * key before it does.
 */
create or replace function public.mark_conversation_read_as(target_user uuid, conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous timestamptz;
  now_at timestamptz := now();
begin
  select m.last_read_at into previous
  from public.conversation_members m
  where m.conversation_id = conv and m.user_id = target_user;

  if previous is null then
    return;
  end if;

  if exists (
    select 1 from public.messages msg
    where msg.conversation_id = conv and msg.sender_id <> target_user
      and msg.created_at > previous and msg.created_at <= now_at
  ) then
    insert into public.conversation_reads (conversation_id, user_id, upto, at)
    values (conv, target_user, now_at, now_at)
    on conflict do nothing;
  end if;

  update public.conversation_members
  set last_read_at = now_at
  where conversation_id = conv and user_id = target_user;
end;
$$;

revoke all on function public.mark_conversation_read_as(uuid, uuid) from public, anon, authenticated;
