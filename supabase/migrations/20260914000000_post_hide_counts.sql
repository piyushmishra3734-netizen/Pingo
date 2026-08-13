-- Letting the author take the numbers off their own post.
--
-- A like count is a score on something somebody made, and it is read as one by
-- the person who made it more than by anybody else. Every product this shape
-- has arrived at the same answer: the author may hide it, the post stays, and
-- the likes keep working - they are simply not counted out loud.
--
-- Comments are hidden by the same flag rather than a second one. Nobody wants
-- half of it: the reason for turning either off is the same reason, and two
-- switches would be two things to explain for one decision.
--
-- What this does *not* do:
--   · it does not stop anybody liking or commenting
--   · it does not hide the comments themselves, only how many there are
--   · it does not hide the count from the author, who can always see it
--
-- False for every post ever written, which is what they meant when there was
-- no way to say otherwise. No backfill.

alter table public.posts
  add column if not exists hide_counts boolean not null default false;

comment on column public.posts.hide_counts is
  'Author hid the like and comment totals on this post. Others see no numbers; the author still does. Likes and comments themselves are unaffected.';
