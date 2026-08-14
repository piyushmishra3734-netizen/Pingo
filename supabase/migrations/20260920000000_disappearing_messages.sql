-- Messages that go away on their own.
--
-- ## What "gone" means here
--
-- Not `delete from messages`. This schema already has a careful answer for
-- media: a storage object is only removed once its path has been *parked* on
-- the message row, because the row is the only reference to it (see
-- `20260918000000_media_lifecycle`). Deleting the row would throw that
-- reference away and leave the bytes in the bucket for ever - a disappearing
-- message that quietly does the opposite of what it promises.
--
-- So expiry does exactly what "delete for everyone" does, and then a little
-- more: the body is emptied, the E2EE envelope is emptied with it, and the
-- media path is parked for the collector that already exists. What survives is
-- an empty row holding a timestamp, which is what keeps replies quoting it from
-- losing their anchor.
--
-- The envelope matters. `delete_message` clears `body` and leaves `envelope`
-- alone, which is defensible for a tombstone somebody chose to leave in the
-- thread and is not defensible here: a timer that expires the plaintext and
-- leaves the ciphertext has expired nothing.
--
-- ## Why the server stamps the clock
--
-- `expires_at` is written by a trigger from the conversation's own setting
-- rather than sent by the client. A sender who would rather their message
-- stayed cannot simply not stamp it, and a receiver cannot argue for a longer
-- one. Both halves of the promise are made by the same row.
--
-- ## Changing the timer is not retroactive
--
-- The stamp is taken at insert, so turning the timer on affects what is said
-- next and nothing that was already said. That is WhatsApp's rule and it is the
-- right one: a setting that reaches backwards would let one person delete a
-- conversation's history by changing a dropdown.

-- ---------------------------------------------------------------------------
-- 1. The setting, and the stamp
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists disappear_seconds integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_disappear_seconds'
  ) then
    alter table public.conversations
      add constraint conversations_disappear_seconds check (
        disappear_seconds is null
        or (disappear_seconds >= 3600 and disappear_seconds <= 7776000)
      );
  end if;
end
$$;

comment on column public.conversations.disappear_seconds is
  'How long a new message in this conversation lives, in seconds. Null is off. One hour to ninety days.';

alter table public.messages
  add column if not exists expires_at timestamptz;

comment on column public.messages.expires_at is
  'When this message empties itself. Stamped at insert from the conversation setting, never sent by a client.';

-- Only expiring messages are ever swept, so only they are indexed.
create index if not exists messages_expires_idx
  on public.messages (expires_at)
  where expires_at is not null;

create or replace function public.messages_stamp_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  secs integer;
begin
  -- A notice explaining that the timer was turned on must outlive the timer,
  -- or the record of the decision expires with the messages it governs.
  if new.kind = 'system' then
    return new;
  end if;

  select disappear_seconds into secs
  from public.conversations
  where id = new.conversation_id;

  if secs is not null then
    new.expires_at := now() + make_interval(secs => secs);
  end if;

  return new;
end;
$$;

drop trigger if exists messages_stamp_expiry on public.messages;
create trigger messages_stamp_expiry
  before insert on public.messages
  for each row
  execute function public.messages_stamp_expiry();

-- ---------------------------------------------------------------------------
-- 2. Turning it on and off
-- ---------------------------------------------------------------------------

/*
 * Any member may set it, and everybody is told.
 *
 * Not admin-only, even in a group: a timer is a privacy decision about what
 * somebody is willing to have kept, and the person who most needs it is rarely
 * the one holding the admin badge. The system notice is what keeps that from
 * being a change nobody noticed - it names who did it and what to.
 */
create or replace function public.set_disappearing(conv uuid, seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  current_seconds integer;
  label text;
begin
  if me is null or not public.is_conversation_member(conv) then
    raise exception 'not a member of this conversation';
  end if;

  if seconds is not null and (seconds < 3600 or seconds > 7776000) then
    raise exception 'unsupported duration';
  end if;

  select disappear_seconds into current_seconds
  from public.conversations
  where id = conv
  for update;

  -- Setting it to what it already is is not an event, and must not post a
  -- notice - two people opening the same sheet would otherwise fill the thread.
  if current_seconds is not distinct from seconds then
    return;
  end if;

  update public.conversations
  set disappear_seconds = seconds
  where id = conv;

  if seconds is null then
    label := public.profile_label(me) || ' turned off disappearing messages';
  else
    label := public.profile_label(me)
      || ' set messages to disappear after '
      || case
           when seconds % 86400 = 0 and seconds / 86400 = 1 then '1 day'
           when seconds % 86400 = 0 then (seconds / 86400)::text || ' days'
           when seconds % 3600 = 0 and seconds / 3600 = 1 then '1 hour'
           else (seconds / 3600)::text || ' hours'
         end;
  end if;

  perform public.post_group_system_notice(conv, me, label);
end;
$$;

revoke all on function public.set_disappearing(uuid, integer) from public;
grant execute on function public.set_disappearing(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The sweep
-- ---------------------------------------------------------------------------

/*
 * Empties what has run out, and parks whatever it was carrying.
 *
 * Deliberately identical in shape to `delete_message(for_everyone => true)`,
 * because it is the same operation with a clock instead of a person. The one
 * difference is the envelope, which is cleared here - see the note at the top.
 *
 * `expires_at` is kept rather than cleared, because it is what tells a client
 * the difference between "somebody took this back" and "this ran out" - the
 * first is a tombstone the thread should show, the second is a message that is
 * supposed to be gone. Idempotency comes from the emptiness instead: a row that
 * has already been swept matches none of the three conditions below.
 */
create or replace function public.expire_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  swept integer := 0;
begin
  update public.messages m
     set body = '',
         encryption = null,
         envelope = null,
         deleted_at = coalesce(m.deleted_at, now()),
         -- Parked, not dropped, exactly as delete_message does it. The live
         -- pointer stays until the uploader's client confirms the bytes are
         -- gone.
         media_purge_path = coalesce(
           m.media_purge_path,
           m.photo_path, m.file_path, m.voice_path
         ),
         media_purge_bucket = coalesce(
           m.media_purge_bucket,
           case
             when m.photo_path is not null then 'photos'
             when m.file_path is not null then 'documents'
             when m.voice_path is not null then 'voice'
           end
         ),
         snap_purge_path = coalesce(m.snap_purge_path, m.snap_path)
   where m.expires_at is not null
     and m.expires_at < now()
     -- Anything still holding content. All three false means this row was
     -- swept already.
     and (m.body <> '' or m.envelope is not null or m.deleted_at is null);

  get diagnostics swept = row_count;
  return swept;
end;
$$;

comment on function public.expire_messages is
  'Empties messages whose timer has run out and parks their media for the existing collector. Deletes no rows and no objects itself.';

revoke all on function public.expire_messages() from public;

/*
 * Every five minutes, not every hour.
 *
 * The media collector runs hourly because bytes sitting in a bucket for an
 * extra hour cost storage and nothing else. This one is a promise about how
 * long something is readable, and "an hour late" is the wrong answer to it.
 * The clients hide an expired message the moment they see it either way; this
 * is what makes the server agree.
 */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('pingo-disappearing-sweep')
      where exists (select 1 from cron.job where jobname = 'pingo-disappearing-sweep');

    perform cron.schedule('pingo-disappearing-sweep', '*/5 * * * *',
      $job$select public.expire_messages();$job$);
  end if;
end
$$;
