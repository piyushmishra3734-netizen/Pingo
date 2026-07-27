-- The story module: audience, close friends, likes, viewers and an archive.
--
-- ## Why the media bucket stops being public
--
-- A story could already only be *listed* by a mutual follow, but the media sat
-- in a public bucket — so the URL worked for anyone who had it, forever, and
-- "close friends" or "hide this from Sam" would have been a label on a door
-- with no lock. Audience control is the point of this module, so the bytes move
-- behind signed URLs like chat photos and profile posts already are.
--
-- Live rows are migrated: `media_path` is recovered from the public URL they
-- were stored with, so nothing that is currently on screen breaks. Rows that
-- have already expired are left alone — nobody can see them and they are about
-- to be archive entries.
--
-- ## Why views need a function rather than a policy
--
-- `story_views` deliberately lets a viewer read only their own rows. That is
-- right: who watched what is not public. But an author is supposed to see their
-- own viewer list, and loosening the policy to "author may read" would also
-- expose *every* view row to anyone who can name a story id they own — and
-- there is no way to express "only aggregated, only mine" in a policy. So the
-- author's view goes through `story_viewers()`, which checks ownership once and
-- returns only that story's viewers.
--
-- ## Why the archive is not a table
--
-- An expired story is the same row it always was. Copying it somewhere on
-- expiry needs a job, and a job that has not run yet is an archive with holes
-- in it. Instead the read policy stops hiding a story from *its own author*, so
-- "archive" is a query — `expires_at <= now() and author_id = auth.uid()` — and
-- it is complete the instant a story expires, with nothing to run.

-- ---------------------------------------------------------------------------
-- Story content
-- ---------------------------------------------------------------------------

alter table public.stories
  add column if not exists media_path text,
  -- Video is a first-class story kind, not a photo with a flag.
  add column if not exists kind text not null default 'photo',
  add column if not exists caption text,
  -- The audience is decided per story, not per account: one picture goes to
  -- close friends and the next goes to everyone, and that is normal.
  add column if not exists audience text not null default 'friends',
  add column if not exists location text,
  add column if not exists link_url text;

alter table public.stories drop constraint if exists stories_kind;
alter table public.stories
  add constraint stories_kind check (kind in ('photo', 'video'));

alter table public.stories drop constraint if exists stories_audience;
alter table public.stories
  add constraint stories_audience
  check (audience in ('public', 'friends', 'close', 'custom'));

alter table public.stories drop constraint if exists stories_caption_length;
alter table public.stories
  add constraint stories_caption_length
  check (caption is null or char_length(caption) <= 500);

/*
 * Recover the storage path for stories that are still live.
 *
 * They were written as public URLs of the form
 * `.../object/public/stories/<uid>/story-<ms>`; everything after that marker is
 * the path. Done here rather than left to the client, because the client would
 * have to keep a branch for "old shape" forever.
 */
update public.stories
set media_path = split_part(media_url, '/object/public/stories/', 2)
where media_path is null
  and expires_at > now()
  and media_url like '%/object/public/stories/%';

-- ---------------------------------------------------------------------------
-- Close friends
-- ---------------------------------------------------------------------------

-- One-directional and private: being on somebody's close friends list is not
-- something they are told, and not something anyone else can read.
create table if not exists public.close_friends (
  owner_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, friend_id),
  constraint close_friends_not_self check (owner_id <> friend_id)
);

alter table public.close_friends enable row level security;

drop policy if exists "see my own close friends" on public.close_friends;
create policy "see my own close friends"
  on public.close_friends for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "manage my own close friends" on public.close_friends;
create policy "manage my own close friends"
  on public.close_friends for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "remove my own close friends" on public.close_friends;
create policy "remove my own close friends"
  on public.close_friends for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Specific people
-- ---------------------------------------------------------------------------

-- The audience for a `custom` story. A row per person, rather than an array on
-- the story, so the read policy can join instead of unnesting.
create table if not exists public.story_audience (
  story_id uuid not null references public.stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (story_id, user_id)
);

alter table public.story_audience enable row level security;

/*
 * Readable by the story's author and by the person named.
 *
 * The second half matters: the read policy on `stories` consults this table, and
 * a policy is evaluated as the caller — so if the viewer cannot see their own
 * row here, a custom story is invisible to precisely the people it was sent to.
 */
drop policy if exists "audience rows are readable by author and member" on public.story_audience;
create policy "audience rows are readable by author and member"
  on public.story_audience for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_audience.story_id and s.author_id = auth.uid()
    )
  );

drop policy if exists "authors set their own audience" on public.story_audience;
create policy "authors set their own audience"
  on public.story_audience for insert to authenticated
  with check (
    exists (
      select 1 from public.stories s
      where s.id = story_audience.story_id and s.author_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Hiding and muting
-- ---------------------------------------------------------------------------

-- "Hide my story from these people." An account-level list rather than a
-- per-story one, which is what the control actually means: you do not decide
-- afresh every time whether your colleague sees this.
create table if not exists public.story_hidden_from (
  owner_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  constraint story_hidden_not_self check (owner_id <> user_id)
);

alter table public.story_hidden_from enable row level security;

/*
 * Readable by the owner *and* by the hidden person.
 *
 * The second half is not a leak in practice and is required in principle: the
 * `stories` read policy consults this table as the caller, so a hidden viewer
 * who could not see their own row would still be shown the story. Being able to
 * discover you are hidden is the price of the rule being enforced at the
 * database rather than in a client anyone can edit — and the alternative,
 * a `security definer` helper, has the same outcome for a determined caller.
 */
drop policy if exists "hidden rows are readable by both sides" on public.story_hidden_from;
create policy "hidden rows are readable by both sides"
  on public.story_hidden_from for select to authenticated
  using (owner_id = auth.uid() or user_id = auth.uid());

drop policy if exists "manage my own hidden list" on public.story_hidden_from;
create policy "manage my own hidden list"
  on public.story_hidden_from for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "unhide from my own list" on public.story_hidden_from;
create policy "unhide from my own list"
  on public.story_hidden_from for delete to authenticated
  using (owner_id = auth.uid());

-- "Do not show me this person's stories." Entirely the muter's business; the
-- author is never told and the rail simply drops them.
create table if not exists public.story_muted_authors (
  muter_id uuid not null references auth.users (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, author_id),
  constraint story_muted_not_self check (muter_id <> author_id)
);

alter table public.story_muted_authors enable row level security;

drop policy if exists "see my own story mutes" on public.story_muted_authors;
create policy "see my own story mutes"
  on public.story_muted_authors for select to authenticated
  using (muter_id = auth.uid());

drop policy if exists "mute stories as myself" on public.story_muted_authors;
create policy "mute stories as myself"
  on public.story_muted_authors for insert to authenticated
  with check (muter_id = auth.uid());

drop policy if exists "unmute stories as myself" on public.story_muted_authors;
create policy "unmute stories as myself"
  on public.story_muted_authors for delete to authenticated
  using (muter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Likes
-- ---------------------------------------------------------------------------

create table if not exists public.story_likes (
  story_id uuid not null references public.stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

alter table public.story_likes enable row level security;

-- The liker sees their own; the author sees likes on their stories. Unlike a
-- post, a story's likes are not public — the viewer list is for the owner.
drop policy if exists "story likes are readable by liker and author" on public.story_likes;
create policy "story likes are readable by liker and author"
  on public.story_likes for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_likes.story_id and s.author_id = auth.uid()
    )
  );

drop policy if exists "like a story as myself" on public.story_likes;
create policy "like a story as myself"
  on public.story_likes for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "unlike my own story like" on public.story_likes;
create policy "unlike my own story like"
  on public.story_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Who may see a story
-- ---------------------------------------------------------------------------

/*
 * The whole audience rule, in one function.
 *
 * `security definer` because it reads `close_friends`, which is private to its
 * owner — a viewer cannot be allowed to read that list, but the rule has to
 * consult it. It takes a story id and answers only about `auth.uid()`, so it
 * cannot be used to ask what anybody else can see.
 *
 * The order matters: hidden beats everything, including a story addressed to
 * you by name. Hiding somebody is the stronger statement.
 */
create or replace function public.can_see_story(target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.stories s
    where s.id = target
      and (
        s.author_id = auth.uid()
        or (
          not exists (
            select 1 from public.story_hidden_from h
            where h.owner_id = s.author_id and h.user_id = auth.uid()
          )
          and (
            s.audience = 'public'
            or (s.audience = 'friends' and public.is_mutual(s.author_id))
            or (
              s.audience = 'close'
              and exists (
                select 1 from public.close_friends cf
                where cf.owner_id = s.author_id and cf.friend_id = auth.uid()
              )
            )
            or (
              s.audience = 'custom'
              and exists (
                select 1 from public.story_audience a
                where a.story_id = s.id and a.user_id = auth.uid()
              )
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_see_story(uuid) from public;
grant execute on function public.can_see_story(uuid) to authenticated;

/*
 * Replaces the mutual-follow rule from the follows migration.
 *
 * Two changes. The audience is now the story's own, not a blanket "mutual
 * only" — that is the feature. And an author can read their own expired
 * stories, which is what makes the archive a query rather than a copy.
 */
drop policy if exists "live stories are readable" on public.stories;
create policy "live stories are readable"
  on public.stories for select to authenticated
  using (
    (author_id = auth.uid() and expires_at <= now())  -- the archive
    or (expires_at > now() and public.can_see_story(id))
  );

drop policy if exists "authors update their own stories" on public.stories;
create policy "authors update their own stories"
  on public.stories for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Story media
-- ---------------------------------------------------------------------------

-- Private from here on. See the note at the top: an audience you cannot enforce
-- on the bytes is not an audience.
update storage.buckets set public = false where id = 'stories';

drop policy if exists "story media is publicly readable" on storage.objects;

/*
 * Any signed-in user may fetch a story object.
 *
 * Membership is not knowable from the object path, so this is deliberately the
 * same shape as the photos bucket: private, readable by authenticated callers,
 * and only ever handed out as a signed URL with a short life by a client that
 * has already passed the audience check. Tightening it further needs the story
 * row, and a storage policy cannot join to it without a helper that would run
 * on every byte served.
 */
drop policy if exists "story media is readable by signed-in users" on storage.objects;
create policy "story media is readable by signed-in users"
  on storage.objects for select to authenticated
  using (bucket_id = 'stories');

drop policy if exists "authors delete their own story media" on storage.objects;
create policy "authors delete their own story media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'stories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Insights
-- ---------------------------------------------------------------------------

/*
 * Who watched one story. Author only.
 *
 * `security definer` for the reason given at the top — the ownership check is
 * here, once, rather than being a policy that would have to express "only
 * aggregated, only mine" and cannot.
 *
 * Returns the viewer's identity plus whether they liked it, because the list
 * and the like count are the same list read two ways, and two round trips to
 * say so would be one more than necessary.
 */
create or replace function public.story_viewers(target uuid)
returns table (
  viewer_id uuid,
  username text,
  display_name text,
  avatar_url text,
  viewed_at timestamptz,
  liked boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    v.viewer_id,
    p.username,
    p.display_name,
    p.avatar_url,
    v.viewed_at,
    exists (
      select 1 from public.story_likes l
      where l.story_id = v.story_id and l.user_id = v.viewer_id
    )
  from public.story_views v
  join public.profiles p on p.id = v.viewer_id
  where v.story_id = target
    and exists (
      select 1 from public.stories s
      where s.id = target and s.author_id = auth.uid()
    )
  order by v.viewed_at desc;
$$;

revoke all on function public.story_viewers(uuid) from public;
grant execute on function public.story_viewers(uuid) to authenticated;

/*
 * The three numbers under a story: views, likes, replies. Author only.
 *
 * Replies are counted from `messages`, because that is where a story reply
 * actually goes — it is a private message in the thread with that person, and
 * the product has no other kind. Tagging it in `meta` is what makes it
 * countable without a second table that could disagree with the first.
 */
create or replace function public.story_insights(target uuid)
returns table (views integer, likes integer, replies integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.story_views v where v.story_id = target)::int,
    (select count(*) from public.story_likes l where l.story_id = target)::int,
    (
      select count(*)
      from public.messages m
      where m.meta ->> 'storyId' = target::text
    )::int
  where exists (
    select 1 from public.stories s
    where s.id = target and s.author_id = auth.uid()
  );
$$;

revoke all on function public.story_insights(uuid) from public;
grant execute on function public.story_insights(uuid) to authenticated;
