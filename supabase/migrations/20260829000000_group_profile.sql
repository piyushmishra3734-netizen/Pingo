-- Group profile: description + cover, and a fuller update_group.
--
-- avatar_url already exists (group face). Cover is the wide banner; description
-- is a short bio. Admins set them via update_group; members only read.

alter table public.conversations
  add column if not exists description text,
  add column if not exists cover_url text;

comment on column public.conversations.description is
  'Optional group/community bio on group info. Max 280 chars in update_group.';
comment on column public.conversations.cover_url is
  'Optional wide cover image URL for group/community info header.';

-- Drop previous overloads so only the full signature remains.
drop function if exists public.update_group(uuid, text, text);
drop function if exists public.update_group(uuid, text, text, text, text);
drop function if exists public.update_group(uuid, text, text, text, text, boolean, boolean);

create or replace function public.update_group(
  conv uuid,
  title text,
  avatar_url text default null,
  description text default null,
  cover_url text default null,
  clear_avatar boolean default false,
  clear_cover boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_title text := nullif(btrim(title), '');
  clean_desc text := nullif(btrim(coalesce(description, '')), '');
  clean_avatar text := nullif(btrim(coalesce(avatar_url, '')), '');
  clean_cover text := nullif(btrim(coalesce(cover_url, '')), '');
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can change the group' using errcode = 'GR003';
  end if;

  if clean_title is null or char_length(clean_title) > 60 then
    raise exception 'that name will not do' using errcode = 'GR001';
  end if;

  if clean_desc is not null and char_length(clean_desc) > 280 then
    raise exception 'that description is too long' using errcode = 'GR001';
  end if;

  /*
   * URL args:
   * - clear_* true  → set column null
   * - non-empty url → set column
   * - otherwise     → leave column alone
   *
   * Description always writes the cleaned value (including null = cleared).
   */
  update public.conversations c
  set
    title = clean_title,
    description = clean_desc,
    avatar_url = case
      when clear_avatar then null
      when clean_avatar is not null then clean_avatar
      else c.avatar_url
    end,
    cover_url = case
      when clear_cover then null
      when clean_cover is not null then clean_cover
      else c.cover_url
    end
  where c.id = conv
    and c.kind in ('group', 'community');
end;
$$;

revoke all on function public.update_group(uuid, text, text, text, text, boolean, boolean) from public;
grant execute on function public.update_group(uuid, text, text, text, text, boolean, boolean) to authenticated;
