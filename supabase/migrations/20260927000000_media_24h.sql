-- Chat media is meant to leave the server a day after it lands on the devices
-- it was sent to. It was not leaving, for three reasons, and only the first of
-- them was a number.
--
-- 1. `media_min_retention` was seven days, so nothing could go before then.
-- 2. Every media message written before `20260918000000` has a null
--    `media_expires_at`, and both halves of the collector skip those on
--    purpose. 215 of 393 media rows were permanently out of reach.
-- 3. The PINGO AI bot is a conversation member and has no client, so it never
--    writes a `media_receipt`. Every conversation it sits in could therefore
--    never satisfy "everyone holds a copy", and its media waited for the
--    ceiling instead of the delivery rule.
--
-- Posts, avatars and stories are untouched: they live in their own buckets and
-- are not what `messages.photo_path`/`file_path`/`voice_path` point at.

-- 1. The numbers.
create or replace function public.media_min_retention()
returns interval language sql immutable as $$ select interval '24 hours' $$;

-- The ceiling for media whose receipts are never coming - a recipient who
-- stopped opening the app. Was thirty days.
create or replace function public.media_max_retention()
returns interval language sql immutable as $$ select interval '7 days' $$;

-- 2. The bot cannot hold a copy, so it must not be counted among those who
--    have to. Same view otherwise.
drop view if exists public.media_fully_delivered;
create view public.media_fully_delivered as
  select
    m.id as message_id,
    m.sender_id,
    m.conversation_id,
    coalesce(m.photo_path, m.file_path, m.voice_path) as path,
    case
      when m.photo_path is not null then 'photos'
      when m.file_path is not null then 'documents'
      when m.voice_path is not null then 'voice'
    end as bucket,
    m.created_at,
    m.media_expires_at,
    (
      select max(r.received_at)
      from public.media_receipts r
      where r.message_id = m.id
    ) as delivered_at
  from public.messages m
  where coalesce(m.photo_path, m.file_path, m.voice_path) is not null
    and m.media_purge_path is null
    and m.media_expires_at is not null
    and not exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = m.conversation_id
        and cm.user_id <> m.sender_id
        and cm.user_id <> public.pingo_ai_user_id()
        and not exists (
          select 1
          from public.media_receipts r
          where r.message_id = m.id
            and r.user_id = cm.user_id
        )
    );

-- 3. Bring the legacy rows into the lifecycle.
--
-- Dated from now rather than from `created_at`, which would park all 215 on the
-- next tick. A day of runway means a client that still has one of these on
-- screen gets a chance to write its receipt - and a chance to keep its own
-- copy - before the ceiling takes it.
update public.messages
   set media_expires_at = now() + interval '24 hours'
 where media_expires_at is null
   and media_purged_at is null
   and coalesce(photo_path, file_path, voice_path) is not null;
