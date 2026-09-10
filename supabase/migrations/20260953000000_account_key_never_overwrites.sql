/*
 * A key that already exists is never replaced by a first-run mint.
 *
 * ## What went wrong
 *
 * `20260949000000_account_key.sql` gave every account a key on first run. Its
 * only guard was `new_version < seen`, which stops a stale tab reinstalling an
 * older key over a rotation. It does not stop the case that actually happened.
 *
 * A package made under the old opt-in Secure Backup has no `unlock_secret`, so
 * `claim_account_key()` hands the client nothing it can open and `account-key.ts`
 * falls through to `mint()`. That mint generates a *fresh* keypair - and because
 * the old package is also `version = 1`, `1 < 1` is false and the upsert
 * replaced it: new `public_key`, new `package`, and the old private key gone
 * from the database entirely.
 *
 * Every `recovery:<uid>` wrap written before that moment was made to the public
 * key that was just discarded. Measured on 2026-09-10, one account: 36,753
 * messages wrapped to the replaced key, 146 to the new one. Two accounts had
 * already been through it. Two more still hold a secret-less package and would
 * have gone the same way on their next launch.
 *
 * Nothing was lost with it - the ciphertext is intact and the account's other
 * devices still hold openable device wraps - but the one key that would have
 * let a *new* device read that history was destroyed by the code meant to
 * guarantee it.
 *
 * ## Why the guard is here and not in the client
 *
 * `mint()` is the only caller, so a client check would be the smaller diff. It
 * would also be the wrong one: installed APKs and service-worker-cached PWA
 * shells keep calling this function for weeks after a web deploy, and each of
 * them still carries the version that overwrites. The function is where every
 * caller meets, so the function is where this belongs.
 *
 * A refusal is safe for the client as it already ships: `mint()` treats any
 * error as "no key", returns undefined, and sealing falls back to device wraps -
 * exactly the behaviour of every build from before the account key existed.
 *
 * ## What this does not do
 *
 * It does not recover the two packages already replaced. Those need the wraps
 * re-made from a device that can still open the history, which is a separate
 * piece of work. This only stops the bleeding.
 */

create or replace function public.upsert_account_key(
  new_kdf text, new_salt text, new_iv text, new_package text,
  new_public_key text, new_secret text, new_version integer
) returns void language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := auth.uid();
  seen integer;
  had_secret boolean;
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = 'RC001';
  end if;

  select version, unlock_secret is not null
    into seen, had_secret
    from public.recovery_packages
   where user_id = me;

  if seen is not null and new_version < seen then
    raise exception 'A newer account key already exists.' using errcode = 'RC003';
  end if;

  /*
   * The row exists and cannot be opened by its owner's client. That is a
   * package from before this feature - wrapped under a twelve-word code its
   * owner may still have - and it is the key every earlier message in this
   * account is wrapped to. Refuse rather than mint over it.
   */
  if seen is not null and not had_secret then
    raise exception 'An account key already exists and must not be replaced.'
      using errcode = 'RC004';
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

revoke all on function public.upsert_account_key(text,text,text,text,text,text,integer) from public, anon;
grant execute on function public.upsert_account_key(text,text,text,text,text,text,integer) to authenticated;
