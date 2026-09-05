/*
 * The key follows the account, so the history does too.
 *
 * ## What was wrong
 *
 * Every message was wrapped to *devices*. A new phone mints a new keypair, so
 * nothing sent before it existed had a wrap it could open, and the whole thread
 * read "Sent before you added this device." The ciphertext was still on the
 * server - 159 MB of it - simply unreadable by the only person entitled to it.
 *
 * The per-user key that fixes this already existed: `recovery_packages` holds
 * one, and 33,705 of the 35,644 sealed messages already carry a `recovery:`
 * wrap for it. It was unreachable for two reasons, and this migration removes
 * the second one:
 *
 *   1. it was opt-in behind Secure Backup, so 37 of 41 accounts never made one;
 *   2. claiming it needed a recovery *request* - a maturity delay and an
 *      approval from another device, which is precisely the device somebody
 *      replacing a lost phone does not have.
 *
 * ## What replaces the passphrase
 *
 * `unlock_secret`: 32 random bytes, generated with the key and stored beside
 * it. Like `package`, `salt` and `iv`, it is granted to no client role and is
 * returned only by `claim_account_key()`, to the account that owns it.
 *
 * State the consequence plainly rather than dressing it up: PINGO now holds
 * material that can open a user's message bodies. Bodies stay encrypted, so an
 * RLS mistake still cannot leak them and neither can a dump of the message
 * table alone - but "operators see ciphertext, not readable chat text" is no
 * longer true, and the privacy policy is being changed to say so. That is the
 * price of a chat history that survives a lost phone without asking anybody to
 * keep a twelve-word phrase safe for the rest of their life.
 */

alter table public.recovery_packages
  add column if not exists unlock_secret text;

comment on column public.recovery_packages.unlock_secret is
  'Random secret the package is wrapped under. Selectable by no client role; returned only by claim_account_key() to its owner.';

-- Matches how salt/iv/package/kdf are already handled: never selectable.
revoke select (unlock_secret) on public.recovery_packages from authenticated, anon;

/*
 * Store the key. Same rules as `upsert_recovery_package`, plus the secret.
 *
 * The version check is kept exactly as it was: a package may move forward or be
 * replaced, never backwards, so a stale tab cannot reinstall an older key over
 * a rotation.
 */
create or replace function public.upsert_account_key(
  new_kdf text, new_salt text, new_iv text, new_package text,
  new_public_key text, new_secret text, new_version integer
) returns void language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := auth.uid();
  seen integer;
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = 'RC001';
  end if;

  select version into seen from public.recovery_packages where user_id = me;
  if seen is not null and new_version < seen then
    raise exception 'A newer account key already exists.' using errcode = 'RC003';
  end if;

  insert into public.recovery_packages
    (user_id, kdf, salt, iv, package, public_key, unlock_secret, version)
  values (me, new_kdf, new_salt, new_iv, new_package, new_public_key, new_secret, new_version)
  on conflict (user_id) do update
    set kdf           = excluded.kdf,
        salt          = excluded.salt,
        iv            = excluded.iv,
        package       = excluded.package,
        public_key    = excluded.public_key,
        unlock_secret = excluded.unlock_secret,
        version       = excluded.version,
        updated_at    = now();
end;
$$;

/*
 * Hand the account its own key. No request, no delay, no second device.
 *
 * Signing in is the authorisation, which is the whole point: the person who
 * lost their phone still has their account, and that has to be enough or the
 * history is gone.
 *
 * Returns no row rather than raising when there is no key yet - a fresh account
 * is the normal case, not an error.
 */
create or replace function public.claim_account_key()
returns table(kdf text, salt text, iv text, package text, secret text, version integer)
language sql security definer set search_path to 'public' as $$
  select p.kdf, p.salt, p.iv, p.package, p.unlock_secret, p.version
    from public.recovery_packages p
   where p.user_id = auth.uid();
$$;

revoke all on function public.upsert_account_key(text,text,text,text,text,text,integer) from public, anon;
revoke all on function public.claim_account_key() from public, anon;
grant execute on function public.upsert_account_key(text,text,text,text,text,text,integer) to authenticated;
grant execute on function public.claim_account_key() to authenticated;
