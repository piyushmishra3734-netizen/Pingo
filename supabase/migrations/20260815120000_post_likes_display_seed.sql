-- Display-only like seed on posts (same idea as profile friends/groups seeds).
-- Real likes stay real; the seed is only added when the client/UI counts likes.
-- Operators set it via SQL without a user JWT (auth.uid() is null).

alter table public.posts
  add column if not exists likes_display_seed integer not null default 0
    check (likes_display_seed >= 0);

comment on column public.posts.likes_display_seed is
  'Display-only offset added to real post_likes count. Not used for product logic.';

-- App users may edit their posts, but never this column.
create or replace function public.posts_preserve_likes_display_seed()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.likes_display_seed := old.likes_display_seed;
  end if;
  return new;
end;
$$;

drop trigger if exists posts_preserve_likes_display_seed on public.posts;
create trigger posts_preserve_likes_display_seed
  before update on public.posts
  for each row
  execute function public.posts_preserve_likes_display_seed();
