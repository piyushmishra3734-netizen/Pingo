-- Chat banners: a picture behind your row in other people's chat lists, the
-- way Discord's nameplates sit behind a name.
--
-- Ready-made banners (the app's collections, files under
-- `/banners/<collection>/<id>.webp` on the website) are for anybody; your own
-- upload is PINGO premium and has to be PINGO's own - the media Worker in your
-- own folder, or the old Supabase Storage path.
--
-- Also puts the profile cover back as it was on 2026-11-15 (20261115000000):
-- 20261119000000 made the cover itself collections-only for non-premium, which
-- was a misunderstanding - the collections were meant for this banner.

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

alter table public.profiles add column if not exists chat_banner_url text;

-- Everybody who can see a name can see its banner; only you change yours.
grant select (chat_banner_url) on public.profiles to anon, authenticated;
grant update (chat_banner_url) on public.profiles to authenticated;

create or replace function public.profiles_chat_banner_rules()
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
  if new.chat_banner_url is null or new.chat_banner_url is not distinct from old.chat_banner_url then
    return new;
  end if;

  if new.chat_banner_url ~ '^https://(pingochat\.xyz|pingochat\.pages\.dev)/banners/[a-z0-9-]+/[a-z0-9-]+\.webp$' then
    return new;
  end if;

  if not new.is_premium then
    raise exception 'Your own chat banner is part of PINGO premium. Pick one from the collections.'
      using errcode = 'check_violation';
  end if;

  if left(new.chat_banner_url, length(media)) = media then
    if split_part(substr(new.chat_banner_url, length(media) + 1), '/', 1) <> new.id::text then
      raise exception 'A chat banner has to be uploaded to PINGO.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if position(marker in new.chat_banner_url) = 0 then
    raise exception 'A chat banner has to be uploaded to PINGO.' using errcode = 'check_violation';
  end if;
  path := split_part(split_part(new.chat_banner_url, marker, 2), '?', 1);
  if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = path) then
    raise exception 'A chat banner has to be uploaded to PINGO.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_chat_banner_rules on public.profiles;
create trigger profiles_chat_banner_rules
before update of chat_banner_url on public.profiles
for each row execute function public.profiles_chat_banner_rules();
