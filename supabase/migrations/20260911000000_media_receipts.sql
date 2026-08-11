-- PINGO's storage is a delivery buffer, not a library.
--
-- A video sent from somebody's gallery is uploaded whole and unmodified, which
-- is the only way to keep the quality the sender chose - and also the reason it
-- cannot simply be left there. The bytes belong on the recipients' devices, and
-- the server's copy exists only for as long as it takes to get them there.
--
-- The hard part is knowing when that is. "Delivered" and "read" are already
-- tracked and neither one answers it: a recipient can open the chat, watch the
-- whole video and close it again without ever having held a complete copy,
-- because `<video src>` streams ranges rather than downloading a file. Deleting
-- on any of those signals destroys the buffer copy of something the recipient
-- can no longer watch, at the exact moment they appear to be finished with it.
--
-- So this is a separate receipt with a narrower meaning than the others:
--
--   media_receipts = "the whole file is written to my device's storage"
--
-- The client writes one only after the IndexedDB put has resolved - see
-- `video-vault.ts`. Nothing about playback, visibility or read state touches it.

create table if not exists public.media_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.media_receipts enable row level security;

-- A receipt is a statement about your own device, so you may only make one
-- about yourself, and only for a conversation you are actually in.
drop policy if exists "members record their own media receipt" on public.media_receipts;
create policy "members record their own media receipt"
  on public.media_receipts for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.messages m
      join public.conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = message_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "members read media receipts" on public.media_receipts;
create policy "members read media receipts"
  on public.media_receipts for select
  using (
    exists (
      select 1
      from public.messages m
      join public.conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = message_id
        and cm.user_id = auth.uid()
    )
  );

/*
 * Called by the recipient once the file is persisted locally.
 *
 * Idempotent: a second call from the same device - a retry, a reinstall that
 * re-downloads, two tabs - is not an error and must not be, because the client
 * cannot always know whether the first one landed.
 */
create or replace function public.confirm_media_received(target uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.media_receipts (message_id, user_id)
  values (target, auth.uid())
  on conflict (message_id, user_id) do nothing;
$$;

/*
 * Videos every recipient now holds a complete copy of.
 *
 * The sender is excluded from the count deliberately - they still have the
 * original in their own gallery, which is where it came from, so waiting for a
 * receipt from them would mean waiting forever.
 *
 * This is a view rather than a delete because Postgres is the wrong place to
 * remove a storage object: deleting the `storage.objects` row hides the file
 * from the API but leaves the bytes behind in the bucket, which turns a storage
 * bill into an invisible storage bill. The reaper reads this and calls the
 * Storage API properly.
 */
create or replace view public.media_fully_delivered as
  select
    m.id as message_id,
    m.file_path,
    m.created_at
  from public.messages m
  where m.file_path is not null
    and m.mime_type like 'video/%'
    and not exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = m.conversation_id
        and cm.user_id <> m.sender_id
        and not exists (
          select 1
          from public.media_receipts r
          where r.message_id = m.id
            and r.user_id = cm.user_id
        )
    );

-- The reaper walks this by age; without the index it walks every message.
create index if not exists media_receipts_message_idx
  on public.media_receipts (message_id);
