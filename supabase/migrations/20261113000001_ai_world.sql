-- PINGO AI can look at the person's own world: their people, their posts, their groups.
--
-- Until now the assistant could see the chat it was in and nothing else, so
-- "who are my friends", "what did Baani post" or "who is in my college group"
-- were answers it had to invent or refuse. These are the reads that fix that.
--
-- ## Nothing here is a new power
--
-- Every function is SECURITY INVOKER: it runs as the person asking, with their
-- login, so row-level security answers exactly as it does in the app. A private
-- account's posts are not returned to somebody who may not see them, and a group
-- the person is not in does not exist as far as these are concerned. There is no
-- definer function in this file, because a definer function is where a read
-- quietly becomes more than the person could do themselves.
--
-- ## Where they are offered
--
-- Only in the person's own chat with PINGO AI, and only while PINGO Master is on
-- (see ai-chat/luna.ts). Never in a group: what comes back is private to the
-- person asking, and a group reply is read by everybody in it.
--
-- Results are capped, and names are matched by position() rather than ilike so
-- a "%" or "_" in a search is just a character.

-- The people around me: friends (a follow both ways), people I follow, people who follow me.
create or replace function public.ai_people(p_query text default null, p_limit integer default 25)
returns table (username text, display_name text, bio text, relation text)
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select f.followee_id as id from public.follows f
    where f.follower_id = auth.uid() and f.status = 'accepted'
  ),
  theirs as (
    select f.follower_id as id from public.follows f
    where f.followee_id = auth.uid() and f.status = 'accepted'
  ),
  everyone as (
    select id from mine union select id from theirs
  )
  select p.username, p.display_name, p.bio,
         case
           when p.id in (select id from mine) and p.id in (select id from theirs) then 'friend'
           when p.id in (select id from mine) then 'following'
           else 'follower'
         end as relation
  from everyone e
  join public.profiles p on p.id = e.id
  where auth.uid() is not null
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
    and (
      coalesce(btrim(p_query), '') = ''
      or position(lower(btrim(p_query)) in lower(p.username)) > 0
      or position(lower(btrim(p_query)) in lower(p.display_name)) > 0
    )
  order by (case
              when p.id in (select id from mine) and p.id in (select id from theirs) then 0
              when p.id in (select id from mine) then 1
              else 2
            end),
           lower(p.display_name)
  limit least(greatest(coalesce(p_limit, 25), 1), 50);
$$;

-- One person, as their profile shows them, and how they are connected to me.
create or replace function public.ai_person(p_handle text)
returns table (username text, display_name text, bio text, work text, location text, song text, relation text, posts integer)
language sql
stable
security invoker
set search_path = public
as $$
  select p.username, p.display_name, p.bio, p.work, p.location, p.song ->> 'name',
         case
           when p.id = auth.uid() then 'you'
           when exists (select 1 from public.follows a where a.follower_id = auth.uid() and a.followee_id = p.id and a.status = 'accepted')
            and exists (select 1 from public.follows b where b.follower_id = p.id and b.followee_id = auth.uid() and b.status = 'accepted') then 'friend'
           when exists (select 1 from public.follows a where a.follower_id = auth.uid() and a.followee_id = p.id and a.status = 'accepted') then 'following'
           when exists (select 1 from public.follows b where b.follower_id = p.id and b.followee_id = auth.uid() and b.status = 'accepted') then 'follower'
           else 'not connected'
         end,
         (select count(*)::integer from public.posts x where x.author_id = p.id)
  from public.profiles p
  where auth.uid() is not null
    and lower(p.username) = lower(regexp_replace(btrim(coalesce(p_handle, '')), '^@', ''))
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  limit 1;
$$;

-- Recent posts: mine when no handle is given, otherwise that person's, as far as I am allowed to see them.
create or replace function public.ai_posts(p_handle text default null, p_limit integer default 5)
returns table (author text, caption text, posted_at timestamptz, likes integer)
language sql
stable
security invoker
set search_path = public
as $$
  select p.username, x.caption, x.created_at,
         (select count(*)::integer from public.post_likes l where l.post_id = x.id)
  from public.posts x
  join public.profiles p on p.id = x.author_id
  where auth.uid() is not null
    and (
      (coalesce(btrim(p_handle), '') = '' and x.author_id = auth.uid())
      or lower(p.username) = lower(regexp_replace(btrim(coalesce(p_handle, '')), '^@', ''))
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = x.author_id)
         or (b.blocker_id = x.author_id and b.blocked_id = auth.uid())
    )
  order by x.created_at desc
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;

-- The groups I am in.
create or replace function public.ai_groups(p_query text default null, p_limit integer default 25)
returns table (conversation_id uuid, title text, description text, members integer, my_role text, last_active timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.title, c.description,
         (select count(*)::integer from public.conversation_members x
           where x.conversation_id = c.id and x.deleted_at is null),
         m.role,
         c.last_message_at
  from public.conversations c
  join public.conversation_members m
    on m.conversation_id = c.id and m.user_id = auth.uid() and m.deleted_at is null
  where c.kind in ('group', 'community')
    and (
      coalesce(btrim(p_query), '') = ''
      or position(lower(btrim(p_query)) in lower(coalesce(c.title, ''))) > 0
    )
  order by c.last_message_at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 50);
$$;

-- Who is in one of my groups.
create or replace function public.ai_group_members(p_conversation uuid)
returns table (username text, display_name text, role text, joined_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select p.username, p.display_name, m.role, m.joined_at
  from public.conversation_members m
  join public.profiles p on p.id = m.user_id
  where m.conversation_id = p_conversation
    and m.deleted_at is null
    and exists (
      select 1 from public.conversation_members me
      where me.conversation_id = p_conversation and me.user_id = auth.uid() and me.deleted_at is null
    )
  order by (m.role is distinct from 'admin'), lower(p.display_name)
  limit 100;
$$;

revoke all on function public.ai_people(text, integer) from public, anon;
revoke all on function public.ai_person(text) from public, anon;
revoke all on function public.ai_posts(text, integer) from public, anon;
revoke all on function public.ai_groups(text, integer) from public, anon;
revoke all on function public.ai_group_members(uuid) from public, anon;
grant execute on function public.ai_people(text, integer) to authenticated;
grant execute on function public.ai_person(text) to authenticated;
grant execute on function public.ai_posts(text, integer) to authenticated;
grant execute on function public.ai_groups(text, integer) to authenticated;
grant execute on function public.ai_group_members(uuid) to authenticated;
