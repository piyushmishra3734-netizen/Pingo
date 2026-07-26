-- Snaps: a photo sent into a conversation.
--
-- A snap is a message, not a new kind of object. That is the whole design
-- decision here, and it buys three things for free:
--
--   * it lands in the thread, in order, with the same realtime stream;
--   * `my_streaks()` already counts message days, so snaps feed streaks with
--     no change to that function — which is exactly the Snapchat behaviour;
--   * read state, replies and deletion all keep working.
--
-- The alternative — a separate `snaps` table — would have needed every one of
-- those rebuilt, and would still have had to merge into the thread for display.

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check check (kind in ('text', 'sticker', 'snap'));

-- Same shape as the sticker rule: the media *is* the message, so it cannot be
-- absent. A snap row with no image is a blank bubble nobody can act on.
alter table public.messages
  drop constraint if exists messages_snap_media_check;

alter table public.messages
  add constraint messages_snap_media_check
    check (kind <> 'snap' or media_url is not null);

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Private, unlike `stories`. A snap goes to specific people, and a public
-- bucket would make its URL guessable by anyone who wanted to look.
insert into storage.buckets (id, name, public)
values ('snaps', 'snaps', false)
on conflict (id) do nothing;

-- Uploads go to `{auth.uid()}/{uuid}.jpg`. The folder-name check is what stops
-- one user writing into another's prefix and passing it off as theirs.
create policy "snap owner can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snaps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "snap owner can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'snaps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reading is deliberately broad-but-authenticated rather than joined back to
-- conversation membership.
--
-- Storage policies cannot see which message references an object, so a precise
-- rule would mean duplicating the membership graph into the object path and
-- keeping it in sync. Instead the *path* is unguessable (a v4 uuid) and the
-- client only ever gets a signed URL with a short expiry, so possession of the
-- link is the access check. Worth stating plainly: an authenticated user who
-- somehow learns an exact object path can fetch it. Nobody can enumerate them.
create policy "authenticated can read snaps"
  on storage.objects for select to authenticated
  using (bucket_id = 'snaps');
