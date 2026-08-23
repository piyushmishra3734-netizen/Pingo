-- The one fact about a backup that Google is not allowed to hold.
--
-- ## The hole this closes
--
-- `docs/backup-security-review.md` recorded two gaps and proposed fixing them
-- with client-side cryptography: MAC the HEAD pointer, and refuse a generation
-- older than one already seen. Building it showed why that cannot work.
--
-- In Simple mode the archive's private key lives in the user's Drive
-- `appDataFolder`, in the clear, beside the archive it opens - that is the
-- deliberate trade `archive-key.ts` documents. So anybody who can write that
-- folder can also read that key, and therefore can:
--
--   * seal a complete, well-formed archive of their own choosing that opens
--     cleanly on restore, because the key that opens it is the key they took;
--   * compute any MAC derived from that key, so signing HEAD proves nothing;
--   * put HEAD back to an older genuine generation, which needs no key at all.
--
-- Every one of those defences lives inside the blast radius of the attacker it
-- is defending against. The only anchor outside it is one the attacker has no
-- credentials for, and that is this table. PINGO's server cannot read the
-- archive - it never sees the key - but it can remember two non-secret numbers
-- about it, and that turns out to be enough.
--
-- ## What is stored, and why it gives nothing away
--
-- A counter and a SHA-256 of the manifest. The manifest is already plaintext in
-- Drive; its hash reveals nothing that Drive does not already hold, and reveals
-- nothing at all to us, since we have never seen the manifest. Notably absent:
-- message counts, sizes, conversation names. §9.4 keeps those off the server and
-- this does not reopen it.
--
-- ## Monotonic, because that is the whole defence
--
-- `set_backup_anchor` refuses a generation that is not strictly greater than the
-- one recorded. That single rule is what makes a rollback impossible: the
-- attacker can rewrite Drive freely, and the number they have to beat is not in
-- Drive.
--
-- The escape hatch is `clear_backup_anchor`, for the user who disconnects Drive
-- and starts a new backup lineage at generation 1. It needs the account's own
-- session, which an attacker holding only the Drive folder does not have.

create table if not exists public.backup_anchor (
  user_id uuid primary key references auth.users (id) on delete cascade,
  generation integer not null check (generation > 0),
  manifest_hash text not null check (char_length(manifest_hash) between 1 and 128),
  updated_at timestamptz not null default now()
);

comment on table public.backup_anchor is
  'One row per account: which backup generation is current, and the SHA-256 of its manifest. The only part of a backup Google cannot rewrite.';

alter table public.backup_anchor enable row level security;

/*
 * Readable by its owner, writable by nobody directly.
 *
 * There is no insert or update policy on purpose. Every write goes through
 * `set_backup_anchor`, which is where the monotonic rule lives - a direct
 * update would be a way around the one check the table exists to make.
 */
create policy "read own backup anchor"
  on public.backup_anchor for select
  using (auth.uid() = user_id);

/*
 * `revoke all` first, and from `authenticated` too.
 *
 * Supabase's default privileges hand every new table in `public` the full set
 * to both roles, so granting select on top of that changes nothing - measured
 * here after applying it: `authenticated` still held INSERT, UPDATE, DELETE and
 * TRUNCATE. RLS covers the first three, and TRUNCATE is not an RLS-governed
 * operation at all. Taking the grants away and putting back only the one that
 * is wanted is the difference between a policy and a hope.
 */
revoke all on table public.backup_anchor from anon, authenticated;
grant select on table public.backup_anchor to authenticated;

-- ---------------------------------------------------------------------------
-- Advancing it
-- ---------------------------------------------------------------------------

/*
 * Called after the chunks and manifest are uploaded and *before* HEAD is
 * committed.
 *
 * That order is what makes the invariant hold: every generation a restore can
 * reach through HEAD was anchored first. So a HEAD pointing past the anchor is
 * not a race, it is evidence, and the client refuses it.
 *
 * The reverse order was considered and is worse. Anchoring after the commit
 * leaves a window where HEAD is genuinely ahead of the anchor, which is
 * indistinguishable from forgery - forcing the client to either refuse honest
 * backups or accept forged ones.
 *
 * Crashing between the anchor and the commit leaves the anchor one ahead. The
 * client handles that by taking the next generation from
 * `max(head, anchor) + 1`, so the following backup lands above it and the state
 * heals itself. Two devices backing up at once resolve here too: the second
 * one's number is not greater, it is refused, and it abandons the attempt
 * before touching the committed pointer.
 */
create or replace function public.set_backup_anchor(
  p_generation integer,
  p_manifest_hash text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_current integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select generation into v_current from public.backup_anchor where user_id = v_user;

  if v_current is not null and p_generation <= v_current then
    raise exception 'backup generation % is not newer than %', p_generation, v_current
      using errcode = '55000';
  end if;

  insert into public.backup_anchor (user_id, generation, manifest_hash, updated_at)
  values (v_user, p_generation, p_manifest_hash, now())
  on conflict (user_id) do update
    set generation = excluded.generation,
        manifest_hash = excluded.manifest_hash,
        updated_at = now();

  return p_generation;
end;
$$;

revoke all on function public.set_backup_anchor(integer, text) from public, anon;
grant execute on function public.set_backup_anchor(integer, text) to authenticated;

/*
 * Starting over.
 *
 * Disconnecting Drive abandons the lineage: the next connection may be a
 * different folder, whose HEAD starts again at generation 1, which the
 * monotonic rule would otherwise refuse for ever.
 */
create or replace function public.clear_backup_anchor()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.backup_anchor where user_id = auth.uid();
$$;

revoke all on function public.clear_backup_anchor() from public, anon;
grant execute on function public.clear_backup_anchor() to authenticated;
