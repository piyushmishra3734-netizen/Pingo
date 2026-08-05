-- Reliable like display counts (real likes + likes_display_seed).
-- Client calls this instead of only counting post_likes rows, so the seed
-- always shows even if a row field is dropped by a stale API schema cache.

create or replace function public.post_like_display_counts(ids uuid[])
returns table (post_id uuid, like_count integer, liked_by_me boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as post_id,
    (
      (select count(*)::int from public.post_likes l where l.post_id = p.id)
      + coalesce(p.likes_display_seed, 0)
    ) as like_count,
    exists (
      select 1
      from public.post_likes l
      where l.post_id = p.id and l.user_id = auth.uid()
    ) as liked_by_me
  from public.posts p
  where p.id = any (ids);
$$;

revoke all on function public.post_like_display_counts(uuid[]) from public;
grant execute on function public.post_like_display_counts(uuid[]) to authenticated;

notify pgrst, 'reload schema';
