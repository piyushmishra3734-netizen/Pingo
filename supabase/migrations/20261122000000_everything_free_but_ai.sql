-- Everything is free except PINGO AI.
--
-- The only things a person could not do without `profiles.is_premium` outside
-- the AI were a GIF cover and an own-upload chat banner. Both go:
--
-- 1. `profiles_cover_rules` no longer asks for premium or refuses a GIF. It still
--    insists that a cover is a file PINGO itself holds (the media Worker, in the
--    person's own folder, or the old Supabase Storage path), which is a rule
--    about where the picture lives and not about who may have one.
-- 2. The chat banner (the "nameplate" behind a row in a chat list) is removed
--    from the app, so the trigger that guarded it goes too. The column stays:
--    apps already installed still SELECT it, and dropping it would break their
--    chat lists. Nothing writes it any more; it was never set on any account.
--
-- `is_premium`, `set_premium` and the AI's own checks are untouched.

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

  if left(new.banner_url, length(media)) = media then
    if split_part(substr(new.banner_url, length(media) + 1), '/', 1) <> new.id::text then
      raise exception 'A cover has to be uploaded to PINGO.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

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

drop trigger if exists profiles_chat_banner_rules on public.profiles;
drop function if exists public.profiles_chat_banner_rules();

-- Nobody writes a chat banner any more. With the rule gone the column would
-- take any URL from anybody, and an app already installed still draws it, so
-- the write is closed too. Reading it, which those apps do, stays.
revoke update (chat_banner_url) on public.profiles from authenticated;
