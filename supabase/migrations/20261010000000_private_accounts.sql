-- PINGO — private accounts.
--
-- A private account's posts are for the people it has let in. Everybody else
-- still finds the account - its name, photo, bio and counts, the way a private
-- account is found anywhere - but sees "This account is private" where the
-- posts would be, and has to ask to follow.
--
-- ## What already worked, and what this adds
--
-- Every follow on PINGO is a request the other person accepts, and stories,
-- calls and Pings already need both people to follow each other. So a private
-- account changes one thing: posts. Until now they were `using (true)` - any
-- signed-in account could read any post - and that is the switch this adds.
--
-- ## Enforced here, not in the app
--
-- The flag lives beside the other privacy rules and is checked by the post
-- policies themselves, for the rows and for the image files. An app that
-- merely hid the grid would still hand the posts to anybody who asked the API.
--
-- ## Defaults are open
--
-- No row, or a row from before this column, is public: exactly what everybody
-- has today. Nobody's profile changes until they turn it on.

alter table public.privacy_settings
  add column if not exists private_account boolean not null default false;

/**
 * Is `subject` a private account?
 *
 * `security definer` so the post policies can ask about anybody; the answer is
 * a rule that is shown on the profile anyway, not a secret.
 */
create or replace function public.is_private_account(subject uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select private_account from public.privacy_settings where user_id = subject),
    false
  );
$$;

grant execute on function public.is_private_account(uuid) to authenticated;

/**
 * May `viewer` see `subject`'s posts?
 *
 * Their own, always. A public account's, always. A private account's only once
 * the viewer's follow has been accepted - one direction is enough, the same
 * way following a private account works everywhere else.
 */
create or replace function public.may_see_posts(viewer uuid, subject uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    viewer = subject
    or not public.is_private_account(subject)
    or exists (
      select 1 from public.follows
      where follower_id = viewer
        and followee_id = subject
        and status = 'accepted'
    );
$$;

grant execute on function public.may_see_posts(uuid, uuid) to authenticated;

drop policy if exists "posts are readable by signed-in users" on public.posts;
create policy "posts are readable by signed-in users"
  on public.posts for select to authenticated
  using (public.may_see_posts(auth.uid(), author_id));

/*
 * The files too. A post image lives at `<author id>/<file>`, so the folder
 * names whose post it is. Without this a private post's picture could still
 * be signed and fetched by anyone who learned its path.
 */
drop policy if exists "post images are readable" on storage.objects;
create policy "post images are readable"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'posts'
    and case
      -- Checked before the cast: one stray non-uuid folder must not turn
      -- every read in the bucket into an error.
      when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        then public.may_see_posts(auth.uid(), ((storage.foldername(name))[1])::uuid)
      else false
    end
  );
