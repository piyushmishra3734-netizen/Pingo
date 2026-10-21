-- The operator can take down a message that has been reported.
--
-- Not a general power over other people's chats. The operator can list messages
-- somebody reported (ids, who sent it, how many reports, never the text: chats
-- are end to end encrypted and the server has no words to show) and remove one
-- of those for everyone. A message nobody reported cannot be touched this way.
--
-- It leaves the same tombstone as any other delete for everyone, so everybody
-- in the chat still sees that a message was removed, and every use is written to
-- operator_actions, which no API role can read.

create table if not exists public.operator_actions (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid not null,
  kind text not null,
  conversation_id uuid,
  message_id uuid
);

alter table public.operator_actions enable row level security;
revoke all on public.operator_actions from public, anon, authenticated;

create or replace function public.operator_reported_messages()
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_name text,
  reports bigint,
  first_reported_at timestamptz,
  sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_operator() then
    raise exception 'Only the operator can read reports.';
  end if;

  return query
    select m.id,
           m.conversation_id,
           m.sender_id,
           p.display_name,
           count(r.id),
           min(r.created_at),
           m.created_at
      from public.message_reports r
      join public.messages m on m.id = r.message_id
      left join public.profiles p on p.id = m.sender_id
     where m.deleted_at is null
     group by m.id, m.conversation_id, m.sender_id, p.display_name, m.created_at
     order by min(r.created_at) desc
     limit 100;
end;
$$;

create or replace function public.operator_remove_reported_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  if not public.is_operator() then
    raise exception 'Only the operator can remove a reported message.';
  end if;

  if not exists (select 1 from public.message_reports where message_id = p_message_id) then
    raise exception 'Nobody has reported this message.';
  end if;

  select * into m from public.messages where id = p_message_id;
  if m is null then
    return;
  end if;

  update public.messages
     set deleted_at = coalesce(deleted_at, now()),
         body = '',
         -- Parked, not dropped: the object goes through the usual collector.
         media_purge_path = coalesce(media_purge_path, m.photo_path, m.file_path, m.voice_path),
         media_purge_bucket = coalesce(
           media_purge_bucket,
           case
             when m.photo_path is not null then 'photos'
             when m.file_path is not null then 'documents'
             when m.voice_path is not null then 'voice'
           end
         ),
         snap_purge_path = coalesce(snap_purge_path, m.snap_path)
   where id = p_message_id;

  insert into public.operator_actions (actor, kind, conversation_id, message_id)
  values (auth.uid(), 'remove_reported_message', m.conversation_id, p_message_id);
end;
$$;

revoke execute on function public.operator_reported_messages() from public, anon;
revoke execute on function public.operator_remove_reported_message(uuid) from public, anon;
grant execute on function public.operator_reported_messages() to authenticated;
grant execute on function public.operator_remove_reported_message(uuid) to authenticated;
