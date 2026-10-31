-- Covers: ready-made collections for everybody, your own upload for premium.
--
-- The cover is the banner at the top of a profile and of a one-to-one chat's
-- info. It now comes from collections the app ships (`cover-presets.ts`): files
-- under `/covers/<collection>/<id>.webp` on the website, saved as their full
-- public address. Anybody may pick one. Uploading your own picture - GIF or
-- not - is PINGO premium, and an upload still has to be PINGO's own: the media
-- Worker in the person's own folder, or the old Supabase Storage path.
--
-- Only a change is checked, as before: covers people already uploaded stay.

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
begin
  if new.banner_url is null or new.banner_url is not distinct from old.banner_url then
    return new;
  end if;

  -- One of the app's own collections, on either address the website answers on.
  if new.banner_url ~ '^https://(pingochat\.xyz|pingochat\.pages\.dev)/covers/[a-z0-9-]+/[a-z0-9-]+\.webp$' then
    return new;
  end if;

  if not new.is_premium then
    raise exception 'Uploading your own cover is part of PINGO premium. Pick one from the collections.'
      using errcode = 'check_violation';
  end if;

  -- Premium: their own upload, on R2 in their own folder.
  if left(new.banner_url, length(media)) = media then
    if split_part(substr(new.banner_url, length(media) + 1), '/', 1) <> new.id::text then
      raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Or on the old Supabase Storage path, as an object that exists.
  if position(marker in new.banner_url) = 0 then
    raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
  end if;
  path := split_part(split_part(new.banner_url, marker, 2), '?', 1);
  if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = path) then
    raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
