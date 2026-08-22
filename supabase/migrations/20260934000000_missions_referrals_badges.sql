/*
 * Missions, referrals and earned badges - the server's own copy.
 *
 * ## Why this is not the badge system that already exists
 *
 * PINGO already has a badge library (`features/badges/registry.ts`) and a place
 * to publish what you have earned (`journey_public.badge_ids`). That system is
 * built on a promise: Journey is counted on your own device from your own
 * cached messages, and nobody else can see those. The server therefore cannot
 * check any of it, and does not try - the owner publishes a summary and it is
 * taken at its word.
 *
 * That is right for "sent a hundred messages", which only costs the owner their
 * own honesty. It is wrong for a badge you get for bringing five people to the
 * product, where the client asserting `I invited five friends` is the entire
 * attack. So this half lives here, where the count is derived from rows the
 * client cannot write and constraints it cannot argue with.
 *
 * Both systems coexist. A badge earned here is a fact about the account; a
 * badge earned there is a fact about the device. The UI shows them together.
 *
 * ## The shape, and why each constraint is load-bearing
 *
 * · `referrals` is keyed on the *referred* account, not on a pair. One row per
 *   person joined, for ever: rejoining, re-opening a link, logging out and back
 *   in, or opening somebody else's link later all collide with the same primary
 *   key and change nothing. That single choice is what makes the count
 *   un-inflatable and the inviter immutable.
 *
 * · `user_badges` is keyed on (user, badge). Processing the same completion
 *   twice writes the same row twice, which is once.
 *
 * · `missions.required_count` is the only place the number five exists.
 */

-- ---------------------------------------------------------------------------
-- 1. Missions, as configuration rather than code
-- ---------------------------------------------------------------------------

create table if not exists public.missions (
  id text primary key,
  title text not null,
  description text not null,
  /* The badge handed over on completion. Text rather than a foreign key: the
     badge library is a client-side registry, and a second copy of it here would
     be a source of truth that drifts the first time one is renamed. */
  badge_id text not null,
  /* What kind of thing is being counted. One value today; the column exists so
     the second mission does not need a schema change to be a different shape. */
  kind text not null check (kind in ('referral')),
  required_count integer not null check (required_count > 0),
  enabled boolean not null default true,
  /*
   * Nothing before this instant counts.
   *
   * An account that already existed cannot be somebody's referral, and a
   * mission switched on today cannot be won with last month's arrivals. The
   * check is against the *referred profile's* creation time, so the only way to
   * earn this is to bring somebody who was not here before.
   */
  counts_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.missions enable row level security;

drop policy if exists "anyone signed in reads missions" on public.missions;
create policy "anyone signed in reads missions"
  on public.missions for select
  to authenticated
  using (true);

/* Written from the Controlling screen, by the operator, exactly like the splash
   and the intro slides. Same pattern, same account. */
drop policy if exists "operator writes missions" on public.missions;
create policy "operator writes missions"
  on public.missions for all
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.username = 'piuxxh')
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.username = 'piuxxh')
  );

insert into public.missions (id, title, description, badge_id, kind, required_count)
values (
  'mythic_pioneer',
  'MYTHIC PIONEER',
  'Refer 5 friends to PINGO.',
  'mythic_pioneer',
  'referral',
  5
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. A referral code for every account
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists referral_code text;

/*
 * Unambiguous by construction.
 *
 * No O/0, no I/1: these codes are read off a screen and typed by hand, and the
 * two pairs that people get wrong are the two pairs that are not here. Eight
 * characters from an alphabet of thirty-two is 2^40 - large enough that
 * guessing one is not a way in, and short enough to fit in a message.
 */
create or replace function public.new_referral_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i integer;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    -- Collision is vanishingly unlikely and cheap to survive, so it is handled
    -- rather than assumed away.
    exit when not exists (select 1 from public.profiles where referral_code = candidate);
  end loop;
  return candidate;
end;
$$;

create unique index if not exists profiles_referral_code_key
  on public.profiles (referral_code)
  where referral_code is not null;

/* Stable for the life of the account: issued once, on the way in, and never
   rewritten. A link somebody has already shared keeps working. */
create or replace function public.profiles_issue_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.referral_code is null then
    new.referral_code := public.new_referral_code();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_issue_referral_code on public.profiles;
create trigger profiles_issue_referral_code
  before insert on public.profiles
  for each row execute function public.profiles_issue_referral_code();

/* Everybody who was already here gets one too - having a link is not the same
   as having earned anything, and an account without one simply cannot invite. */
update public.profiles
   set referral_code = public.new_referral_code()
 where referral_code is null;

-- ---------------------------------------------------------------------------
-- 3. Who brought whom
-- ---------------------------------------------------------------------------

create table if not exists public.referrals (
  /* The primary key, and the whole anti-abuse design. See the header. */
  referred_id uuid primary key references public.profiles (id) on delete cascade,
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  mission_id text not null references public.missions (id),
  created_at timestamptz not null default now(),
  constraint referrals_no_self check (referred_id <> referrer_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

alter table public.referrals enable row level security;

/*
 * Readable only by the two people in the row, and writable by nobody.
 *
 * Every write goes through `redeem_referral`, which is `security definer` and
 * applies the rules. A table that clients could insert into directly would make
 * every rule below decorative.
 */
drop policy if exists "read own referrals" on public.referrals;
create policy "read own referrals"
  on public.referrals for select
  to authenticated
  using (referrer_id = auth.uid() or referred_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Badges the server itself vouches for
-- ---------------------------------------------------------------------------

create table if not exists public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_id text not null,
  mission_id text references public.missions (id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

alter table public.user_badges enable row level security;

/*
 * Public, deliberately.
 *
 * The badge is meant to be seen - beside a name in a chat list, on a profile,
 * in a group. It carries no count, no progress and no referral: only that this
 * account has this badge. Nobody learns who was invited, or how close anybody
 * else is.
 */
drop policy if exists "earned badges are public" on public.user_badges;
create policy "earned badges are public"
  on public.user_badges for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 5. Awarding, which the client is never part of
-- ---------------------------------------------------------------------------

/*
 * Count, compare, award. Idempotent at every step.
 *
 * Separate from `redeem_referral` because completion has two triggers and only
 * one of them is a redemption: an operator lowering `required_count` completes
 * missions for people who never touch the app again that day.
 */
create or replace function public.evaluate_referral_mission(subject uuid, mission text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.missions%rowtype;
  earned integer;
begin
  select * into m from public.missions where id = mission and enabled;
  if not found then
    return false;
  end if;

  select count(*) into earned
    from public.referrals r
    join public.profiles p on p.id = r.referred_id
   where r.referrer_id = subject
     and r.mission_id = m.id
     -- The referred account itself has to be new. See `counts_from`.
     and p.created_at >= m.counts_from;

  if earned < m.required_count then
    return false;
  end if;

  insert into public.user_badges (user_id, badge_id, mission_id)
  values (subject, m.badge_id, m.id)
  on conflict (user_id, badge_id) do nothing;

  return true;
end;
$$;

/*
 * "Somebody invited me, and here is their code."
 *
 * Everything the client says is treated as a claim about *who invited them* -
 * never as a claim about a count, which is the only thing worth lying about.
 * The count is derived here, from rows this function alone can write.
 *
 * Returns a reason rather than raising, because every outcome except a genuine
 * error is an ordinary thing that happens: opening your own link, opening a
 * second link after already being someone's referral, typing a code wrong.
 */
create or replace function public.redeem_referral(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.missions%rowtype;
  inviter uuid;
  cleaned text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  /*
   * The account has to exist as an account.
   *
   * A session without a profile is somebody part-way through signup - they have
   * authenticated and not yet chosen a username. Counting them would count a
   * signup that can still be abandoned, which is exactly what "valid account"
   * is meant to exclude.
   */
  if not exists (select 1 from public.profiles where id = me) then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;

  select * into m from public.missions where kind = 'referral' and enabled order by created_at limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_mission');
  end if;

  if not exists (select 1 from public.profiles where id = me and created_at >= m.counts_from) then
    return jsonb_build_object('ok', false, 'reason', 'account_predates_mission');
  end if;

  select id into inviter from public.profiles where referral_code = cleaned;
  if inviter is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_code');
  end if;

  if inviter = me then
    return jsonb_build_object('ok', false, 'reason', 'self_referral');
  end if;

  /*
   * The one write. `do nothing` rather than `do update`: an account already
   * attributed keeps the inviter it arrived with, and opening a different link
   * afterwards is not a way to change it.
   */
  insert into public.referrals (referred_id, referrer_id, mission_id)
  values (me, inviter, m.id)
  on conflict (referred_id) do nothing;

  -- Whoever actually owns this referral - which may be an earlier inviter.
  select referrer_id into inviter from public.referrals where referred_id = me;

  perform public.evaluate_referral_mission(inviter, m.id);

  return jsonb_build_object('ok', true, 'reason', 'recorded');
end;
$$;

revoke all on function public.redeem_referral(text) from public, anon;
grant execute on function public.redeem_referral(text) to authenticated;
revoke all on function public.evaluate_referral_mission(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. What the mission screen reads
-- ---------------------------------------------------------------------------

/*
 * One round trip for the whole screen: the link to share, how far along, and
 * whether it is already done.
 *
 * `security definer` so it can count referrals without the caller being able to
 * read anybody else's, and so the numbers come from the same place the award
 * does - a screen that computed its own progress would eventually disagree with
 * the badge.
 */
create or replace function public.referral_progress()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.missions%rowtype;
  earned integer := 0;
  code text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select referral_code into code from public.profiles where id = me;
  select * into m from public.missions where kind = 'referral' and enabled order by created_at limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_mission');
  end if;

  select count(*) into earned
    from public.referrals r
    join public.profiles p on p.id = r.referred_id
   where r.referrer_id = me
     and r.mission_id = m.id
     and p.created_at >= m.counts_from;

  return jsonb_build_object(
    'ok', true,
    'missionId', m.id,
    'title', m.title,
    'description', m.description,
    'badgeId', m.badge_id,
    'referralCode', code,
    'count', earned,
    'required', m.required_count,
    'unlocked', exists (
      select 1 from public.user_badges
       where user_id = me and badge_id = m.badge_id
    )
  );
end;
$$;

revoke all on function public.referral_progress() from public, anon;
grant execute on function public.referral_progress() to authenticated;
