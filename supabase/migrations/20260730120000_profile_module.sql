-- The profile module: a bio, three posts, and the facts a profile shows.
--
-- ## Why posts are capped at three, in the database
--
-- Three is the product rule, not a UI preference — a PINGO profile is a
-- portrait, not a feed. A cap enforced only in the client is a cap that lasts
-- until someone opens the network tab, so it lives in a trigger. The client
-- still checks, because a dialog beats an error, but the trigger is what makes
-- it true.
--
-- ## Why there are no follower or following counts here
--
-- Deliberately absent. A profile shows Posts, Friends and Groups: things the
-- person has and belongs to, not an audience size. `friends` is the count of
-- mutual follows, which the product already treats as the real relationship —
-- a one-way follow is a request, not a connection.
--
-- ## Why stats and shared-history are functions
--
-- Both answer questions about *another* person: how many groups they are in,
-- when the two of you became friends, how many photos you have exchanged. Row
-- level security correctly hides someone else's memberships and follow rows, so
-- a plain query returns zero for every profile that is not your own. These are
-- `security definer` and return only aggregate counts — never the rows behind
-- them, and never anything that would let a caller enumerate who someone knows.

-- ---------------------------------------------------------------------------
-- Bio
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists bio text;

alter table public.profiles
  drop constraint if exists profiles_bio_length;

-- Multi-line and emoji-friendly. 200 characters is long enough for a sentence
-- about yourself and a link, and short enough that it never pushes the posts
-- grid off the first screen.
alter table public.profiles
  add constraint profiles_bio_length
  check (bio is null or char_length(bio) <= 200);

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,

  -- A path in the `posts` bucket, not a URL. The bucket is private and reads go
  -- through short-lived signed URLs, the same as chat photos.
  image_path text not null,

  caption text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint posts_caption_length
    check (caption is null or char_length(caption) <= 2200)
);

create index if not exists posts_author_created_idx
  on public.posts (author_id, created_at desc);

drop trigger if exists posts_touch_updated_at on public.posts;
create trigger posts_touch_updated_at
  before update on public.posts
  for each row execute function public.touch_updated_at();

/*
 * The cap, enforced where it cannot be edited around.
 *
 * A custom SQLSTATE rather than a check violation: the client already maps
 * 23514 to "that username is not allowed", and a post limit arriving as a
 * username error would be worse than no message at all. `PT001` is in the
 * range Postgres leaves to applications.
 */
create or replace function public.enforce_post_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.posts where author_id = new.author_id) >= 3 then
    raise exception 'A profile can hold three posts. Replace one instead.'
      using errcode = 'PT001';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_limit on public.posts;
create trigger posts_limit
  before insert on public.posts
  for each row execute function public.enforce_post_limit();

alter table public.posts enable row level security;

-- Posts are the public face of a profile, so any signed-in user may read them.
-- Nothing private is here: the image is a picture its author chose to publish.
drop policy if exists "posts are readable by signed-in users" on public.posts;
create policy "posts are readable by signed-in users"
  on public.posts for select to authenticated
  using (true);

drop policy if exists "authors write their own posts" on public.posts;
create policy "authors write their own posts"
  on public.posts for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "authors edit their own posts" on public.posts;
create policy "authors edit their own posts"
  on public.posts for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "authors delete their own posts" on public.posts;
create policy "authors delete their own posts"
  on public.posts for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Post images
-- ---------------------------------------------------------------------------

-- Private, like every other bucket in the product. "Public" would mean a URL
-- that works forever for anyone who has ever seen it, including after the post
-- is deleted — which is not what deleting a post is supposed to mean.
insert into storage.buckets (id, name, public)
values ('posts', 'posts', false)
on conflict (id) do nothing;

drop policy if exists "authors upload post images" on storage.objects;
create policy "authors upload post images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'posts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "post images are readable" on storage.objects;
create policy "post images are readable"
  on storage.objects for select to authenticated
  using (bucket_id = 'posts');

drop policy if exists "authors delete post images" on storage.objects;
create policy "authors delete post images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'posts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Likes
-- ---------------------------------------------------------------------------

create table if not exists public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_likes enable row level security;

-- Readable by everyone, because the count is shown on the post and "did I like
-- this?" is answered from the same rows.
drop policy if exists "likes are readable" on public.post_likes;
create policy "likes are readable"
  on public.post_likes for select to authenticated
  using (true);

drop policy if exists "like as myself" on public.post_likes;
create policy "like as myself"
  on public.post_likes for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "unlike my own like" on public.post_likes;
create policy "unlike my own like"
  on public.post_likes for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),

  constraint post_comments_body_length check (char_length(body) between 1 and 1000)
);

create index if not exists post_comments_post_created_idx
  on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;

drop policy if exists "comments are readable" on public.post_comments;
create policy "comments are readable"
  on public.post_comments for select to authenticated
  using (true);

drop policy if exists "comment as myself" on public.post_comments;
create policy "comment as myself"
  on public.post_comments for insert to authenticated
  with check (author_id = auth.uid());

-- The comment's author, or the owner of the post it sits under. Both are
-- reasonable people to remove a comment, and neither can remove anyone else's
-- comment from anyone else's post.
drop policy if exists "delete my comment or one on my post" on public.post_comments;
create policy "delete my comment or one on my post"
  on public.post_comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_comments.post_id and p.author_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Saves
-- ---------------------------------------------------------------------------

-- Private in a way likes are not: saving is a bookmark, and a bookmark nobody
-- else can see is the only kind worth having. The select policy is therefore
-- restricted to the saver, not open like `post_likes`.
create table if not exists public.post_saves (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_saves enable row level security;

drop policy if exists "see only my saves" on public.post_saves;
create policy "see only my saves"
  on public.post_saves for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "save as myself" on public.post_saves;
create policy "save as myself"
  on public.post_saves for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "unsave my own save" on public.post_saves;
create policy "unsave my own save"
  on public.post_saves for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

-- Only the blocker sees the row. Telling someone they have been blocked is a
-- product decision nobody has made, and a readable table makes it for them.
drop policy if exists "see only my blocks" on public.blocks;
create policy "see only my blocks"
  on public.blocks for select to authenticated
  using (blocker_id = auth.uid());

drop policy if exists "block as myself" on public.blocks;
create policy "block as myself"
  on public.blocks for insert to authenticated
  with check (blocker_id = auth.uid());

drop policy if exists "unblock my own block" on public.blocks;
create policy "unblock my own block"
  on public.blocks for delete to authenticated
  using (blocker_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  subject_user_id uuid references auth.users (id) on delete cascade,
  subject_post_id uuid references public.posts (id) on delete cascade,
  reason text not null,
  details text,
  created_at timestamptz not null default now(),

  constraint reports_reason
    check (reason in ('spam', 'harassment', 'nudity', 'hate', 'scam', 'other')),
  constraint reports_details_length
    check (details is null or char_length(details) <= 1000),
  -- A report about nothing is a row nobody can act on.
  constraint reports_has_subject
    check (subject_user_id is not null or subject_post_id is not null)
);

alter table public.reports enable row level security;

drop policy if exists "report as myself" on public.reports;
create policy "report as myself"
  on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

-- No select policy, on purpose. Reports are for moderation, which happens with
-- the service key; nothing in the app reads them back, not even the reporter.
-- So the client must insert *without* `.select()`, or postgrest returns nothing
-- and the write looks like it failed.

-- ---------------------------------------------------------------------------
-- Profile statistics
-- ---------------------------------------------------------------------------

/*
 * The three numbers under a profile: posts, friends, groups.
 *
 * `security definer` because two of the three are invisible under RLS when the
 * target is someone else — their group memberships are theirs, and `follows`
 * only returns rows involving the caller. Without it every profile but your own
 * would read "0 friends, 0 groups", which is worse than not showing the row.
 *
 * It returns counts and nothing else. A caller learns *how many* people someone
 * is friends with, which is what the profile already displays, and never who
 * they are.
 */
create or replace function public.profile_stats(target uuid)
returns table (posts integer, friends integer, groups integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.posts p where p.author_id = target)::int,
    (
      select count(*)
      from public.follows a
      join public.follows b
        on b.follower_id = a.followee_id and b.followee_id = a.follower_id
      where a.follower_id = target
        and a.status = 'accepted'
        and b.status = 'accepted'
    )::int,
    (
      select count(*)
      from public.conversation_members m
      join public.conversations c on c.id = m.conversation_id
      where m.user_id = target and c.kind in ('group', 'community')
    )::int;
$$;

revoke all on function public.profile_stats(uuid) from public;
grant execute on function public.profile_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Shared with you
-- ---------------------------------------------------------------------------

/*
 * The history between the caller and one other person.
 *
 * Only ever about `auth.uid()` and the person passed in — it takes one id, not
 * two, so it cannot be used to inspect a relationship the caller is not half of.
 *
 * `friends_since` is the later of the two accepts, because that is the moment
 * the pair actually became mutual; the earlier one was still a pending request.
 * Null means they are not friends, which the caller shows as an absent row
 * rather than as a date of nothing.
 *
 * `photos_shared` counts photo messages either of them sent in any conversation
 * they are both in — direct and group alike. Photos in a group you happen to
 * share are genuinely photos you have shared with each other, and excluding
 * them would make the number quietly wrong for anyone who mostly talks in
 * groups.
 */
create or replace function public.shared_with(other uuid)
returns table (
  friends_since timestamptz,
  mutual_groups integer,
  photos_shared integer
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (
      select max(greatest(
        coalesce(a.responded_at, a.created_at),
        coalesce(b.responded_at, b.created_at)
      ))
      from public.follows a
      join public.follows b
        on b.follower_id = a.followee_id and b.followee_id = a.follower_id
      where a.follower_id = auth.uid()
        and a.followee_id = other
        and a.status = 'accepted'
        and b.status = 'accepted'
    ),
    (
      select count(*)
      from public.conversation_members mine
      join public.conversation_members theirs
        on theirs.conversation_id = mine.conversation_id
      join public.conversations c on c.id = mine.conversation_id
      where mine.user_id = auth.uid()
        and theirs.user_id = other
        and c.kind in ('group', 'community')
    )::int,
    (
      select count(*)
      from public.messages m
      where m.photo_path is not null
        and m.sender_id in (auth.uid(), other)
        and m.conversation_id in (
          select mine.conversation_id
          from public.conversation_members mine
          join public.conversation_members theirs
            on theirs.conversation_id = mine.conversation_id
          where mine.user_id = auth.uid() and theirs.user_id = other
        )
    )::int;
$$;

revoke all on function public.shared_with(uuid) from public;
grant execute on function public.shared_with(uuid) to authenticated;
