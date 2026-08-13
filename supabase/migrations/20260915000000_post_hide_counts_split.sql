-- Likes and comments, decided separately.
--
-- The first version of this was one switch for both, on the reasoning that
-- whatever makes somebody want the like count off a picture wants the comment
-- count off it too. That is often true and not always: a photograph can be
-- worth a conversation and not worth a score, and the author is the one who
-- knows which. Two flags, two menu items, no explanation needed for either.
--
-- The old flag is carried across rather than reset - a post that was hidden
-- yesterday stays hidden in both senses today - and then dropped, because a
-- column nothing writes to is a column somebody will read by mistake.

alter table public.posts
  add column if not exists hide_like_count boolean not null default false,
  add column if not exists hide_comment_count boolean not null default false;

update public.posts
  set hide_like_count = true, hide_comment_count = true
  where hide_counts is true;

alter table public.posts
  drop column if exists hide_counts;

comment on column public.posts.hide_like_count is
  'Author hid the like total on this post. Others see no number; the author still does. Liking itself is unaffected.';

comment on column public.posts.hide_comment_count is
  'Author hid the comment total on this post. The comments themselves stay readable - only the count goes.';
