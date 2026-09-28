-- PINGO - calls that ring a phone whose app is closed.
--
-- ## What was wrong
--
-- A call rang only over a Realtime broadcast to the other person's channel,
-- and that channel exists only while their app is open. With the app closed, in
-- the background or on a locked phone, nothing was listening: the invite went
-- nowhere, the caller heard ringback for 45 seconds, and the call ended with the
-- "not answering" tone. That was "call nahi lag raha, apne aap cut ho raha hai".
-- Push was only ever sent afterwards, as "Missed call".
--
-- ## What this adds
--
-- `call_rings` is the ring written down: who is calling whom, in which room,
-- until when. The caller writes one through `ring_call`, which also raises a
-- `call_ring` notification, and the existing push pipeline turns that into a
-- high-priority push. The phone that receives it opens the app, the app reads
-- its live ring and shows the incoming call, and answering joins the room the
-- caller is already waiting in.
--
-- `end_call_ring` closes it - on answer, decline, hang-up or timeout - and
-- removes the notification, so an old ring is never offered again and the call
-- history keeps its single "Missed call" line rather than two.

create table if not exists public.call_rings (
  call_id uuid primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id uuid not null references auth.users (id) on delete cascade,
  callee_id uuid not null references auth.users (id) on delete cascade,
  media text not null default 'voice' check (media in ('voice', 'video')),
  created_at timestamptz not null default now(),
  -- A ring nobody answers is over after this, whether or not anybody said so.
  expires_at timestamptz not null default now() + interval '45 seconds',
  ended_at timestamptz
);

create index if not exists call_rings_callee_live
  on public.call_rings (callee_id, expires_at)
  where ended_at is null;

alter table public.call_rings enable row level security;

-- Both ends may read their own rings. Writes only go through the functions below.
drop policy if exists "call rings are readable by caller and callee" on public.call_rings;
create policy "call rings are readable by caller and callee"
  on public.call_rings for select to authenticated
  using (auth.uid() = caller_id or auth.uid() = callee_id);

-- The notification kind, alongside every kind that already exists.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
    check (
      kind in (
        'follow_request',
        'follow_accepted',
        'message',
        'voice',
        'snap',
        'ping_opened',
        'ping_replayed',
        'story',
        'story_reply',
        'call',
        'mention',
        'like',
        'comment',
        'ai',
        'journey',
        'marketing',
        'new_device',
        'live',
        -- Somebody is calling you right now.
        'call_ring'
      )
    );

/**
 * Ring somebody. Called by the caller as the call starts.
 *
 * Both people must be in the conversation - the same rule the room token uses
 * - so this cannot be used to push strangers. Idempotent on the call id.
 */
create or replace function public.ring_call(
  target uuid,
  conversation uuid,
  call uuid,
  call_media text default 'voice'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or target = auth.uid() then
    return;
  end if;

  if not exists (
    select 1 from public.conversation_members
    where conversation_id = conversation and user_id = auth.uid()
  ) or not exists (
    select 1 from public.conversation_members
    where conversation_id = conversation and user_id = target
  ) then
    raise exception 'not a member of this conversation' using errcode = '42501';
  end if;

  insert into public.call_rings (call_id, conversation_id, caller_id, callee_id, media)
  values (call, conversation, auth.uid(), target, case when call_media = 'video' then 'video' else 'voice' end)
  on conflict (call_id) do nothing;

  if found then
    insert into public.notifications (user_id, actor_id, kind, subject_id)
    values (target, auth.uid(), 'call_ring', conversation);
  end if;
end;
$$;

grant execute on function public.ring_call(uuid, uuid, uuid, text) to authenticated;

/** Close a ring, from either end, and take its notification with it. */
create or replace function public.end_call_ring(call uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.call_rings%rowtype;
begin
  update public.call_rings
     set ended_at = now()
   where call_id = call
     and ended_at is null
     and (caller_id = auth.uid() or callee_id = auth.uid())
  returning * into r;

  if found then
    delete from public.notifications
     where kind = 'call_ring'
       and user_id = r.callee_id
       and actor_id = r.caller_id
       and subject_id = r.conversation_id;
  end if;
end;
$$;

grant execute on function public.end_call_ring(uuid) to authenticated;
