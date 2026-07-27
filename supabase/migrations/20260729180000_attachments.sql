-- Documents, locations, contacts and events.
--
-- ## One column for three of them
--
-- A document needs bytes in storage. A location, a shared contact and an event
-- do not — they are a handful of fields each, and giving every one its own set
-- of columns would add a dozen mostly-null columns to a table every message in
-- the product already lives in.
--
-- So the structured kinds share a `meta` jsonb. That is the right trade here and
-- not everywhere: it is only reasonable because nothing queries *inside* these.
-- The moment something needs "all messages within 2km", latitude belongs in a
-- real column with a real index, and this should be split rather than indexed
-- through json.
--
-- Documents still get their own columns, because a file has a path, a name and
-- a size that the bubble reads on every render, and burying those in json would
-- make the common case the awkward one.
--
-- ## Shape of `meta`, by kind
--
--   location  { lat, lng, label? }
--   contact   { name, handle?, userId? }
--   event     { title, startsAt, location? }
--
-- Written by the client and read by the client. The database does not validate
-- it beyond being json, which is honest: nothing on the server acts on any of
-- these yet, and a check constraint would imply otherwise.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "senders upload documents" on storage.objects;
create policy "senders upload documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "members read documents" on storage.objects;
create policy "members read documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'documents');

drop policy if exists "senders delete documents" on storage.objects;
create policy "senders delete documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
    check (
      kind in (
        'text', 'sticker', 'snap', 'photo', 'voice',
        'document', 'location', 'contact', 'event'
      )
    );

alter table public.messages
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists file_mime text,
  -- Everything the structured kinds need. See the note above.
  add column if not exists meta jsonb;
