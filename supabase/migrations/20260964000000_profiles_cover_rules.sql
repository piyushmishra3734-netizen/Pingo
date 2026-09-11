-- GIF covers are premium, and a cover lives in PINGO's own bucket.
--
-- The app refuses a GIF cover from anybody without premium, but the app is not
-- the only thing that can write banner_url: the "update your own profile"
-- grant includes that column, so the rule has to live where every write goes.
--
-- A cover that points outside the avatars bucket is refused for the same
-- reason. Otherwise the GIF check is one URL away - any animated image on the
-- internet, linked straight into the column - and every cover today is in the
-- bucket, so nobody who uses the app loses anything.
--
-- Only on change: an account that loses premium keeps the cover it already
-- has, rather than having a profile save fail over a field it did not touch.
--
-- ponytail: the check reads the content type the uploader declared, and the
-- bucket lets people overwrite their own files. A hand-built client can still
-- upload a GIF labelled as a JPEG, or swap one in over an existing cover. This
-- stops the app and casual edits; closing it fully means sniffing the file's
-- bytes on upload (an edge function), which is worth it only if people do it.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as
-- `profiles_cover_rules`.

create or replace function public.profiles_cover_rules()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  marker constant text := '/storage/v1/object/public/avatars/';
  path text;
  mime text;
begin
  if new.banner_url is null or new.banner_url is not distinct from old.banner_url then
    return new;
  end if;

  if new.is_premium then
    return new;
  end if;

  if position(marker in new.banner_url) = 0 then
    raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
  end if;

  path := split_part(split_part(new.banner_url, marker, 2), '?', 1);

  select o.metadata ->> 'mimetype' into mime
    from storage.objects o
   where o.bucket_id = 'avatars' and o.name = path;

  -- The file has to be there already: an empty path would pass the check below
  -- and could have a GIF uploaded into it afterwards.
  if mime is null then
    raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
  end if;

  if mime = 'image/gif' or lower(path) like '%.gif' then
    raise exception 'GIF covers are part of PINGO premium.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_cover_rules on public.profiles;

create trigger profiles_cover_rules
  before update of banner_url on public.profiles
  for each row
  execute function public.profiles_cover_rules();
