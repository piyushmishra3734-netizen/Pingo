-- Photos in a chat, with a choice about how long they last.
--
-- ## Why this is not just "snaps without the timer"
--
-- A snap is deliberately hostile to keeping: private bucket, signed URLs that
-- expire in a minute, two views, then the bytes are destroyed. That is the whole
-- point of it and none of it should change.
--
-- An ordinary photo is the opposite — it stays, it can be scrolled back to, and
-- re-reading the thread must not consume anything. Bolting "unlimited views"
-- onto the snap path would mean every read going through `open_snap`, spending a
-- view that does not exist, against a bucket whose URLs are built to die. So
-- photos get their own bucket and their own column, and the two kinds share
-- nothing but the word "image".
--
-- ## The view limit lives on the message
--
-- One send flow, one control: keep it in the chat, or let it be opened once.
-- Rather than making the sender choose between two features with different
-- names, `view_limit` says how many times it may be opened and null means
-- "as often as you like". A snap is then simply a photo whose limit is small,
-- which is the honest description of what it always was.

-- Photos are private like snaps: a chat is not a public gallery, and a URL that
-- works for anyone with the link is not something a messaging product should
-- hand out. Reads go through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "senders upload photos" on storage.objects;
create policy "senders upload photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    -- First path segment is the uploader, so nobody can write into another
    -- person's folder even though the bucket is shared.
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/*
 * Anyone in the conversation may read. Membership is not knowable from the
 * object path, so this is deliberately "any authenticated user who can guess a
 * uuid path" — which is why the bucket stays private and the client only ever
 * hands out signed URLs with a short life. Tightening it further needs the
 * message row, and storage policies cannot join to it without a helper that
 * would run on every byte served.
 */
drop policy if exists "members read photos" on storage.objects;
create policy "members read photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'photos');

drop policy if exists "senders delete photos" on storage.objects;
create policy "senders delete photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
    check (kind in ('text', 'sticker', 'snap', 'photo'));

alter table public.messages
  add column if not exists photo_path text,
  -- Null is "open it as often as you like". A number counts down per viewer.
  add column if not exists view_limit integer;

-- Separate statement: `add column` and `add constraint` cannot share one
-- `alter table` list.
alter table public.messages
  drop constraint if exists messages_view_limit_positive;

alter table public.messages
  add constraint messages_view_limit_positive
    check (view_limit is null or view_limit > 0);

-- Who has opened what, and how often. Per viewer, because "you have seen this
-- twice" is a fact about you and not about the message.
create table if not exists public.photo_views (
  message_id uuid not null references public.messages (id) on delete cascade,
  viewer_id uuid not null references auth.users (id) on delete cascade,
  views integer not null default 0,
  primary key (message_id, viewer_id)
);

alter table public.photo_views enable row level security;

drop policy if exists "own photo views" on public.photo_views;
create policy "own photo views"
  on public.photo_views for all to authenticated
  using (viewer_id = auth.uid())
  with check (viewer_id = auth.uid());

/*
 * Spends one view and reports what is left.
 *
 * Calling this *is* opening it — there is no separate confirm step, because a
 * client that could decline to confirm could look forever. The sender is exempt:
 * counting your own photo against your own limit would mean losing the thing you
 * sent by glancing at it.
 */
create or replace function public.open_photo(target uuid)
returns table (path text, views_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  msg record;
  spent integer;
begin
  select m.sender_id, m.photo_path, m.view_limit, m.conversation_id
    into msg
    from public.messages m
   where m.id = target;

  if msg is null or msg.photo_path is null then
    return;
  end if;

  if not public.is_conversation_member(msg.conversation_id) then
    return;
  end if;

  -- Unlimited, or your own: hand it back without touching the ledger.
  if msg.view_limit is null or msg.sender_id = auth.uid() then
    return query select msg.photo_path, null::integer;
  end if;

  insert into public.photo_views (message_id, viewer_id, views)
       values (target, auth.uid(), 1)
  on conflict (message_id, viewer_id)
    do update set views = public.photo_views.views + 1
    returning views into spent;

  if spent > msg.view_limit then
    return;
  end if;

  return query select msg.photo_path, (msg.view_limit - spent);
end;
$$;

revoke all on function public.open_photo(uuid) from public;
grant execute on function public.open_photo(uuid) to authenticated;
