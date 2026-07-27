-- Point a comment's author at the profile, not at the auth user.
--
-- ## What was broken
--
-- `post_comments.author_id` referenced `auth.users(id)`, which is where every
-- other table in this product points and is the right target for ownership. But
-- the client reads a comment *with its author's name and photo*, and those live
-- in `public.profiles`. PostgREST resolves an embed by following a declared
-- foreign key, and there was no key from `post_comments` to `profiles` — so
-- `profiles!post_comments_author_id_fkey(*)` was a relationship that does not
-- exist and every insert came back 400.
--
-- The two are interchangeable as an ownership check: `profiles.id` *is* the
-- auth user's id, and it cascades from `auth.users` already. Pointing at
-- `profiles` therefore keeps the same delete behaviour, keeps `author_id =
-- auth.uid()` working in the policies, and gives the embed a key to follow.
--
-- ## Why this is not the same for `follows`
--
-- `follows` has the same shape and `listFollowRequests` embeds through it the
-- same way, so it has the same defect. It is left alone here: `follows` is a
-- live table with four policies written against it, and repointing its keys is
-- a change to working sign-in-critical machinery. That read is rewritten in the
-- client instead, where a bug costs a list and not an account.

alter table public.post_comments
  drop constraint if exists post_comments_author_id_fkey;

alter table public.post_comments
  add constraint post_comments_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete cascade;
