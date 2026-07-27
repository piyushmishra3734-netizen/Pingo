-- Voice notes.
--
-- ## Same shape as photos, deliberately
--
-- Private bucket, path prefixed with the uploader's id, read through a
-- short-lived signed URL. A voice note is as personal as a photo and there is no
-- reason for it to be reachable by anyone holding a link.
--
-- ## Why the waveform is stored rather than computed
--
-- Drawing the bars needs the peaks, and getting them from the audio means
-- fetching the whole file and running `decodeAudioData` — per note, on a screen
-- that might show ten. So the sender computes them once, at record time, from
-- audio already in memory, and every reader gets them with the message. The
-- cost is a small array on the row; the alternative is a thread that stutters
-- while it decodes sound nobody has asked to hear yet.
--
-- Stored as `real[]` rather than json: it is a fixed-length array of numbers
-- and Postgres has a type for that.

insert into storage.buckets (id, name, public)
values ('voice', 'voice', false)
on conflict (id) do nothing;

drop policy if exists "senders upload voice" on storage.objects;
create policy "senders upload voice"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "members read voice" on storage.objects;
create policy "members read voice"
  on storage.objects for select to authenticated
  using (bucket_id = 'voice');

drop policy if exists "senders delete voice" on storage.objects;
create policy "senders delete voice"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
    check (kind in ('text', 'sticker', 'snap', 'photo', 'voice'));

alter table public.messages
  add column if not exists voice_path text,
  -- Seconds. Held so the bubble can size itself before the audio loads.
  add column if not exists voice_duration real,
  add column if not exists voice_waveform real[];
