-- Account recovery: the encrypted package, and the gate in front of it.
--
-- The server stores a blob it cannot read and enforces who may fetch it. Those
-- are two different jobs and only the second one needs trusting: the package is
-- AES-GCM under a key derived from a code that never leaves the user, so a
-- server that hands the blob to the wrong person has still handed them
-- ciphertext. The gate exists to make that mistake expensive rather than free.

create table if not exists public.recovery_packages (
  user_id     uuid primary key references auth.users on delete cascade,
  -- Bumped on every re-upload. A server replaying an older package cannot make
  -- it decrypt to anything useful, but it can strand a user on a key they have
  -- rotated away from, and the client refuses a version it has already passed.
  version     integer     not null default 1,
  -- Named rather than assumed, so Argon2id can replace PBKDF2 later without
  -- orphaning every package already written.
  kdf         text        not null,
  salt        text        not null,
  iv          text        not null,
  -- The wrapped recovery private key. Opaque here, forever.
  package     text        not null,
  -- SPKI base64. Senders wrap the content key to this, so it must be readable
  -- by people who are not its owner -- a public key is public.
  public_key  text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.recovery_packages enable row level security;

/*
 * Column privileges, done the long way round.
 *
 * A column-level revoke cannot carve an exception out of a table-level grant --
 * PostgreSQL takes the table grant as sufficient and never consults the column
 * list. So the table privilege goes first and the readable columns come back
 * individually. This bit the group role column earlier in the project; the
 * shape of the mistake is identical and so is the fix.
 */
revoke select on public.recovery_packages from authenticated, anon;
grant select (user_id, public_key, version) on public.recovery_packages to authenticated;

-- Anyone may read a public key. Nobody reaches `package` through this path:
-- the column is not granted, so the policy never gets the chance to allow it.
create policy "recovery public keys are readable"
  on public.recovery_packages for select
  to authenticated
  using (true);

-- Only you write your own package, and only from a device already trusted with
-- your account. Setting up recovery from an unrecognised device would let
-- somebody who briefly held a session install a key of their own choosing.
create policy "own package, from a known device"
  on public.recovery_packages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.device_keys d where d.user_id = auth.uid())
  );

create policy "update own package"
  on public.recovery_packages for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- Pending recoveries: the delay, the approval, and the cancel.
-- --------------------------------------------------------------------------

create table if not exists public.recovery_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users on delete cascade,
  -- The device asking. Recorded before it is trusted, which is the entire
  -- point: the log has to show attempts that were never approved.
  device_id     uuid        not null,
  device_label  text,
  requested_at  timestamptz not null default now(),
  /*
   * When this becomes claimable without anybody approving it.
   *
   * Configurable rather than a constant: an account under active attack wants
   * a long window and somebody who has genuinely lost their only phone wants a
   * short one, and neither answer is right for both. The client proposes, the
   * column records what was actually used, and the audit entry keeps it.
   */
  matures_at    timestamptz not null,
  approved_at   timestamptz,
  approved_by   uuid,
  cancelled_at  timestamptz,
  cancelled_by  uuid,
  claimed_at    timestamptz
);

create index if not exists recovery_requests_user_idx
  on public.recovery_requests (user_id, requested_at desc);

alter table public.recovery_requests enable row level security;

-- Readable by the account, which is what lets every existing device show a
-- pending recovery and offer to cancel it.
create policy "see your own recovery requests"
  on public.recovery_requests for select
  to authenticated
  using (user_id = auth.uid());

-- Written only through the functions below, never directly. A client that can
-- insert its own row could set `matures_at` to the past.
revoke insert, update, delete on public.recovery_requests from authenticated, anon;

-- --------------------------------------------------------------------------
-- The gate.
-- --------------------------------------------------------------------------

/*
 * Open a recovery request.
 *
 * `search_path` is pinned to `public, extensions` because pgcrypto lives in
 * `extensions` on Supabase and `gen_random_uuid` is unreachable from a
 * definer function pinned to `public` alone.
 */
create or replace function public.request_recovery(
  device uuid,
  label text default null,
  delay_seconds integer default 86400
)
returns public.recovery_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  trusted boolean;
  wait integer;
  row public.recovery_requests;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'RC001';
  end if;

  -- Clamped server-side. A client asking for a zero delay is either confused
  -- or hostile, and the difference does not matter here.
  wait := least(greatest(coalesce(delay_seconds, 86400), 0), 30 * 86400);

  -- A device already trusted with this account is not recovering, it is simply
  -- signed in, and making it wait a day would be theatre.
  select exists (
    select 1 from public.device_keys d
    where d.user_id = auth.uid() and d.device_id = device
  ) into trusted;

  insert into public.recovery_requests (user_id, device_id, device_label, matures_at, approved_at, approved_by)
  values (
    auth.uid(),
    device,
    label,
    now() + make_interval(secs => case when trusted then 0 else wait end),
    case when trusted then now() end,
    case when trusted then auth.uid() end
  )
  returning * into row;

  return row;
end;
$$;

/*
 * Approve a pending recovery from a device that is already trusted.
 *
 * This is the fast path and the safe one: somebody holding a working device
 * says yes, so there is nothing to wait for.
 */
create or replace function public.approve_recovery(request uuid, approver uuid)
returns public.recovery_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.recovery_requests;
begin
  if not exists (
    select 1 from public.device_keys d
    where d.user_id = auth.uid() and d.device_id = approver
  ) then
    raise exception 'Only a device already signed in can approve a recovery.'
      using errcode = 'RC002';
  end if;

  update public.recovery_requests
     set approved_at = now(), approved_by = approver
   where id = request
     and user_id = auth.uid()
     and cancelled_at is null
     and claimed_at is null
  returning * into row;

  if row.id is null then
    raise exception 'That recovery request is not open.' using errcode = 'RC003';
  end if;

  return row;
end;
$$;

/*
 * Cancel it.
 *
 * The counterweight to the delay. A delay that nobody can act on is just a
 * slower compromise -- what makes the window useful is that every existing
 * device is told and any of them can stop it.
 */
create or replace function public.cancel_recovery(request uuid)
returns public.recovery_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row public.recovery_requests;
begin
  update public.recovery_requests
     set cancelled_at = now(), cancelled_by = auth.uid()
   where id = request
     and user_id = auth.uid()
     and claimed_at is null
  returning * into row;

  if row.id is null then
    raise exception 'That recovery request cannot be cancelled.' using errcode = 'RC004';
  end if;

  return row;
end;
$$;

/*
 * Hand over the encrypted package, if the gate allows it.
 *
 * The only route to `package`, because the column is not granted to
 * `authenticated` at all. Approved, or matured and never cancelled -- and the
 * claim is recorded, so a package fetched twice is visible afterwards.
 */
create or replace function public.claim_recovery_package(request uuid)
returns table (kdf text, salt text, iv text, package text, version integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  req public.recovery_requests;
begin
  select * into req
    from public.recovery_requests r
   where r.id = request and r.user_id = auth.uid();

  if req.id is null then
    raise exception 'No such recovery request.' using errcode = 'RC005';
  end if;

  if req.cancelled_at is not null then
    raise exception 'That recovery was cancelled from another device.'
      using errcode = 'RC006';
  end if;

  if req.approved_at is null and req.matures_at > now() then
    raise exception 'This recovery is still waiting. It can be completed after %.', req.matures_at
      using errcode = 'RC007';
  end if;

  update public.recovery_requests set claimed_at = now() where id = req.id;

  return query
    select p.kdf, p.salt, p.iv, p.package, p.version
      from public.recovery_packages p
     where p.user_id = auth.uid();
end;
$$;

grant execute on function public.request_recovery(uuid, text, integer) to authenticated;
grant execute on function public.approve_recovery(uuid, uuid) to authenticated;
grant execute on function public.cancel_recovery(uuid) to authenticated;
grant execute on function public.claim_recovery_package(uuid) to authenticated;

-- Every device watches for a recovery being opened against its account, which
-- is what turns the delay into a warning somebody can act on.
alter publication supabase_realtime add table public.recovery_requests;
