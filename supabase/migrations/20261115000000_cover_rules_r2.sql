-- Covers live on R2 now, and the rule that guards them still only knew Supabase.
--
-- profiles_cover_rules (20261013..) says a cover must be "uploaded to PINGO" by
-- looking for the Supabase Storage path in the URL. Since covers moved to the
-- media Worker (R2), a person without premium who picked a cover got that
-- refusal for a perfectly good upload, and nothing already on Supabase could be
-- moved over without tripping it.
--
-- A cover is still only accepted from PINGO's own places:
--   - the media Worker's public cover path, in this person's own folder, or
--   - the old Supabase Storage path, as before.
-- And a GIF is still premium whichever of the two it is on: the Worker names a
-- file after its type, so `.gif` says what it is.

create or replace function public.profiles_cover_rules()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  marker constant text := '/storage/v1/object/public/avatars/';
  media constant text := 'https://pingo-media.dubesminecraft.workers.dev/p/cover/';
  path text;
  mime text;
begin
  if new.banner_url is null or new.banner_url is not distinct from old.banner_url then
    return new;
  end if;

  if new.is_premium then
    return new;
  end if;

  -- On R2, in this person's own folder.
  if left(new.banner_url, length(media)) = media then
    if split_part(substr(new.banner_url, length(media) + 1), '/', 1) <> new.id::text then
      raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
    end if;
    if lower(split_part(new.banner_url, '?', 1)) like '%.gif' then
      raise exception 'GIF covers are part of PINGO premium.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if position(marker in new.banner_url) = 0 then
    raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
  end if;

  path := split_part(split_part(new.banner_url, marker, 2), '?', 1);

  select o.metadata ->> 'mimetype' into mime
    from storage.objects o
   where o.bucket_id = 'avatars' and o.name = path;

  if mime is null then
    raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
  end if;

  if mime = 'image/gif' or lower(path) like '%.gif' then
    raise exception 'GIF covers are part of PINGO premium.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
