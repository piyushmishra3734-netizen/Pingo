-- Which of these story and post files may the caller see?
--
-- Stories, posts, profile pictures and covers are moving to Cloudflare R2
-- (workers/media). A row keeps pointing at its file, now as
-- `r2:<kind>/<owner>/<file>`, and who may see it stays the database's call:
-- the Worker hands out a signed link only for paths this returns, and it asks
-- with the viewer's own token. Security invoker, so it sees exactly the rows
-- row level security already lets the caller read (audience, close friends,
-- private accounts), and nothing more.
--
-- The owner is the second part of every path, which narrows each search to
-- that person's rows before anything else is looked at.

create or replace function public.visible_media(p_paths text[])
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  with asked as (
    select distinct p as path, split_part(p, '/', 2) as owner
    from unnest(coalesce(p_paths, '{}'::text[])) as p
    where p like 'r2:%'
    limit 200
  )
  select s.media_path
  from stories s
  join asked a on a.path = s.media_path and s.author_id::text = a.owner
  union
  select clip.value ->> 'path'
  from stories s
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(s.audio) = 'array' then s.audio else '[]'::jsonb end
  ) as clip
  join asked a on a.path = clip.value ->> 'path'
  where s.author_id::text in (select owner from asked)
  union
  select p.image_path
  from posts p
  join asked a on a.path = p.image_path and p.author_id::text = a.owner;
$$;

revoke all on function public.visible_media(text[]) from public, anon;
grant execute on function public.visible_media(text[]) to authenticated;
