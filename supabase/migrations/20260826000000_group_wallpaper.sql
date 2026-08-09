-- Shared wallpaper for group (and community) conversations.
--
-- ## Why this is on the conversation, not the member
--
-- A direct chat's wallpaper is personal - each person decorates their own side.
-- A group wallpaper is the room itself: if anyone hangs a picture, everyone
-- looking at that room should see it. Storing the choice per member would mean
-- six different backdrops for six phones, which is not a shared room.
--
-- ## Who may set it
--
-- Any member, not only admins. Wallpaper is decoration, not a roster change;
-- requiring an admin for a colour choice turns a casual act into a permission
-- fight. Adding people still needs admin + mutual; this does not.

alter table public.conversations
  add column if not exists wallpaper_id text,
  add column if not exists wallpaper_photo_url text;

comment on column public.conversations.wallpaper_id is
  'Shared wallpaper preset id for group/community chats. Direct chats ignore this.';
comment on column public.conversations.wallpaper_photo_url is
  'Public URL for a shared custom wallpaper photo (groups only).';

create or replace function public.set_group_wallpaper(
  conv uuid,
  wallpaper_id text,
  wallpaper_photo_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean_id text := nullif(btrim(coalesce(wallpaper_id, '')), '');
  clean_url text := nullif(btrim(coalesce(wallpaper_photo_url, '')), '');
  allowed text[] := array[
    'default', 'dawn', 'sea', 'ink', 'plain', 'rain', 'custom'
  ];
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'GR003';
  end if;

  if not exists (
    select 1
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.conversation_id = conv
      and cm.user_id = me
      and c.kind in ('group', 'community')
  ) then
    raise exception 'only a group member can set the wallpaper' using errcode = 'GR003';
  end if;

  if clean_id is null or not (clean_id = any (allowed)) then
    raise exception 'unknown wallpaper' using errcode = 'GR001';
  end if;

  if clean_id = 'custom' and clean_url is null then
    raise exception 'a custom wallpaper needs a photo' using errcode = 'GR001';
  end if;

  if clean_url is not null and char_length(clean_url) > 2000 then
    raise exception 'that photo link is too long' using errcode = 'GR001';
  end if;

  update public.conversations
  set wallpaper_id = clean_id,
      wallpaper_photo_url = case
        when clean_id = 'custom' then clean_url
        else null
      end
  where id = conv
    and kind in ('group', 'community');
end;
$$;

revoke all on function public.set_group_wallpaper(uuid, text, text) from public;
grant execute on function public.set_group_wallpaper(uuid, text, text) to authenticated;
