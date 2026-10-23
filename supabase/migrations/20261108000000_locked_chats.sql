-- Locked chats.
--
-- A person can lock a chat on their account: it leaves their list, search and
-- unread badge, opens only behind a PIN on the device, and says nothing on a
-- lock screen. The lock list lives here so it follows the account to a new
-- phone; the PIN itself never leaves the device that set it.
--
-- Locking is private to the person: nobody else is told, and it changes nothing
-- about the chat for anyone else.

create table if not exists public.locked_chats (
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  locked_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.locked_chats enable row level security;

drop policy if exists "read my locked chats" on public.locked_chats;
create policy "read my locked chats" on public.locked_chats
  for select to authenticated using (user_id = auth.uid());

-- Only a chat you are in can be locked, and only as yourself.
drop policy if exists "lock my own chats" on public.locked_chats;
create policy "lock my own chats" on public.locked_chats
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "unlock my own chats" on public.locked_chats;
create policy "unlock my own chats" on public.locked_chats
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.locked_chats from public, anon, authenticated;
grant select, insert, delete on public.locked_chats to authenticated;

-- ---------------------------------------------------------------------------
-- The push, with a locked chat's name, face and words left out
-- (body from 20261027000000; only the lock changes)
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
                 'actorName', case when lk.conversation_id is not null then 'Someone' else coalesce(p.display_name, 'Someone') end,
                 'actorAvatar', case when lk.conversation_id is null then p.avatar_url end,
                 'subjectId', i.subject_id,
                 'count', u.unread,
                 'preview', case when lk.conversation_id is not null then 'hidden' else coalesce(np.preview, 'sender_and_text') end,
                 -- The chat side: the newest message from this sender in this chat.
                 'messageId', m.id,
                 'messageKind', m.kind,
                 'text', case when public.is_chat_notification(i.kind) and coalesce(np.preview, 'sender_and_text') = 'sender_and_text'
                              and lk.conversation_id is null and m.encryption is null then left(m.body, 400) end,
                 'chatTitle', case when c.kind in ('group', 'community') and lk.conversation_id is null then c.title end,
                 'isGroup', c.kind in ('group', 'community')
               )) as payload,
               (row_number() over (order by i.id) - 1) / 100 as bucket
          from inserted i
          left join public.profiles p on p.id = i.actor_id
          left join public.notification_prefs np on np.user_id = i.user_id
          left join public.conversations c on public.is_chat_notification(i.kind) and c.id = i.subject_id
          -- A locked chat tells the lock screen nothing: no name, no face, no words.
          left join public.locked_chats lk on public.is_chat_notification(i.kind) and lk.user_id = i.user_id and lk.conversation_id = i.subject_id
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

notify pgrst, 'reload schema';
