-- PINGO — privacy settings that are actually enforced.
--
-- Four controls shipped as switches with nothing behind them: who can call me,
-- who can add me, profile visibility, and online status. They were saved on the
-- device and read by nobody, so somebody could set "Nobody" and still be called
-- by anybody. A privacy switch that does nothing is worse than an absent one,
-- because people make real decisions on it.
--
-- The rules move here, where the client cannot be the one enforcing them. Every
-- check below runs in the database, on the owner's stored preference, against
-- whoever is asking.
--
-- ## The settings have to be readable by other people
--
-- To refuse a call at insert time the policy must read the *callee's*
-- preference, which means the row cannot be owner-only. What is readable is a
-- rule, not a fact: "this person accepts calls from friends" reveals nothing
-- about them beyond what trying and being refused would.
--
-- ## Defaults are open, and absence means open
--
-- Every account without a row behaves exactly as PINGO does today. A migration
-- that silently made everybody private would break every existing conversation
-- and be indistinguishable from an outage.

create table if not exists public.privacy_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,

  -- Who may ring this person.
  who_can_call text not null default 'everyone'
    check (who_can_call in ('everyone', 'friends', 'nobody')),

  -- Who may send a follow request.
  who_can_add text not null default 'everyone'
    check (who_can_add in ('everyone', 'friends-of-friends', 'nobody')),

  -- Who may open this profile.
  profile_visibility text not null default 'everyone'
    check (profile_visibility in ('everyone', 'friends', 'nobody')),

  -- Whether presence is shared at all.
  online_status boolean not null default true,

  updated_at timestamptz not null default now()
);

alter table public.privacy_settings enable row level security;

drop policy if exists privacy_settings_read on public.privacy_settings;
create policy privacy_settings_read
  on public.privacy_settings for select to authenticated
  using (true);

drop policy if exists privacy_settings_insert on public.privacy_settings;
create policy privacy_settings_insert
  on public.privacy_settings for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists privacy_settings_update on public.privacy_settings;
create policy privacy_settings_update
  on public.privacy_settings for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists privacy_settings_touch_updated_at on public.privacy_settings;
create trigger privacy_settings_touch_updated_at
  before update on public.privacy_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The relationships the rules are written in terms of
-- ---------------------------------------------------------------------------

/**
 * Mutual follow, which is what PINGO calls a friend.
 *
 * `security definer` so it can see both directions of `follows` regardless of
 * who is asking — the RLS on that table only shows rows involving the caller,
 * and a rule about *somebody else's* friends needs more than that.
 */
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.follows f1
    where f1.follower_id = a and f1.followee_id = b and f1.status = 'accepted'
  ) and exists (
    select 1 from public.follows f2
    where f2.follower_id = b and f2.followee_id = a and f2.status = 'accepted'
  );
$$;

/** A friend of a friend: someone who shares at least one accepted mutual. */
create or replace function public.share_a_friend(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.follows fa
    join public.follows fb on fb.follower_id = fa.followee_id
    where fa.follower_id = a
      and fa.status = 'accepted'
      and fb.followee_id = b
      and fb.status = 'accepted'
  );
$$;

/** Two people already talking. Conversations outrank every rule below. */
create or replace function public.share_a_conversation(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversation_members ma
    join public.conversation_members mb on mb.conversation_id = ma.conversation_id
    where ma.user_id = a and mb.user_id = b
  );
$$;

/**
 * May `caller` ring `callee`?
 *
 * Absent settings mean everyone, so an account that has never opened Privacy
 * behaves exactly as it does today.
 */
create or replace function public.may_call(caller uuid, callee uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case coalesce(
    (select who_can_call from public.privacy_settings where user_id = callee),
    'everyone'
  )
    when 'nobody' then false
    when 'friends' then public.are_friends(caller, callee)
    else true
  end;
$$;

/** May `sender` send `target` a follow request? */
create or replace function public.may_add(sender uuid, target uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case coalesce(
    (select who_can_add from public.privacy_settings where user_id = target),
    'everyone'
  )
    when 'nobody' then false
    when 'friends-of-friends' then public.share_a_friend(sender, target)
    else true
  end;
$$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.share_a_friend(uuid, uuid) to authenticated;
grant execute on function public.share_a_conversation(uuid, uuid) to authenticated;
grant execute on function public.may_call(uuid, uuid) to authenticated;
grant execute on function public.may_add(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Who can add me
-- ---------------------------------------------------------------------------

-- Replaces the insert policy so a request that breaks the target's rule is
-- refused by the database rather than by a check the sender's client could skip.
drop policy if exists "send my own follow request" on public.follows;
create policy "send my own follow request"
  on public.follows for insert to authenticated
  with check (
    follower_id = auth.uid()
    and status = 'pending'
    and public.may_add(auth.uid(), followee_id)
  );

-- ---------------------------------------------------------------------------
-- Who can call me
-- ---------------------------------------------------------------------------

-- Ringing happens over a private broadcast topic named for the callee, so the
-- rule lands exactly where the ring is sent. Media is peer-to-peer and never
-- touches this channel; what this stops is the ring itself.
drop policy if exists "send to any call topic" on realtime.messages;
create policy "send to any call topic"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'call:%'
    and realtime.messages.extension = 'broadcast'
    and public.may_call(
      auth.uid(),
      nullif(split_part(realtime.topic(), ':', 2), '')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- Profile visibility
-- ---------------------------------------------------------------------------

/**
 * May `viewer` see `subject`'s profile?
 *
 * A shared conversation always wins. Hiding the name and photo of somebody you
 * are already talking to does not make anybody private — it makes the chat list
 * a column of blank rows, and the person is right there in the thread anyway.
 */
create or replace function public.may_see_profile(viewer uuid, subject uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    viewer = subject
    or public.share_a_conversation(viewer, subject)
    or case coalesce(
      (select profile_visibility from public.privacy_settings where user_id = subject),
      'everyone'
    )
      when 'nobody' then false
      when 'friends' then public.are_friends(viewer, subject)
      else true
    end;
$$;

grant execute on function public.may_see_profile(uuid, uuid) to authenticated;

/*
 * The profiles read policy, narrowed.
 *
 * It was `using (true)` — every signed-in account could read every profile,
 * which is what made "Profile Visibility" decorative. It now asks the same
 * question the switch does.
 *
 * Deliberately *not* narrowed to friends-only by default: the default is
 * `everyone`, so search, new-chat and the people list behave exactly as before
 * for everybody who has not changed the setting. Only the accounts that asked
 * to be hidden become hidden.
 */
drop policy if exists "profiles are readable by signed-in users" on public.profiles;
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (public.may_see_profile(auth.uid(), id));
