-- Writing a recovery package needs a function, not table privileges.
--
-- The package column is deliberately unreadable: `select` is revoked on the
-- table and granted back for `user_id`, `public_key` and `version` only, so no
-- client can fetch the blob that opens an account's history. That is the point
-- of the design and it stays.
--
-- The cost of it showed up the first time enrolment ran against the real
-- database rather than a stand-in:
--
--   403  42501  permission denied for table recovery_packages
--
-- PostgREST's upsert wants table-level privileges that the column-grant dance
-- removed, and granting them back would expose `package` to every signed-in
-- client. So the write moves behind a definer function instead, which is
-- already how `recovery_requests` is written -- "written only through the
-- functions below, never directly" -- and for the same reason.
--
-- The checks the RLS policies made are re-stated here, because a definer
-- function runs past them: it is yours only, and only from a device this
-- account has already published a key for. Setting up recovery from an
-- unrecognised session would let somebody who briefly held it install a key of
-- their own choosing.

create or replace function public.upsert_recovery_package(
  new_kdf        text,
  new_salt       text,
  new_iv         text,
  new_package    text,
  new_public_key text,
  new_version    integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  seen integer;
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = 'RC001';
  end if;

  if not exists (select 1 from public.device_keys d where d.user_id = me) then
    raise exception 'This device has not published a key yet.' using errcode = 'RC002';
  end if;

  /*
   * A package may move forward or be replaced, never backwards. The client
   * refuses a version it has already passed; this refuses one the server has,
   * so a stale tab cannot reinstall an older key over a rotation.
   */
  select version into seen from public.recovery_packages where user_id = me;
  if seen is not null and new_version < seen then
    raise exception 'A newer recovery package already exists.' using errcode = 'RC003';
  end if;

  insert into public.recovery_packages (user_id, kdf, salt, iv, package, public_key, version)
  values (me, new_kdf, new_salt, new_iv, new_package, new_public_key, new_version)
  on conflict (user_id) do update
    set kdf        = excluded.kdf,
        salt       = excluded.salt,
        iv         = excluded.iv,
        package    = excluded.package,
        public_key = excluded.public_key,
        version    = excluded.version,
        updated_at = now();
end;
$$;

revoke all on function public.upsert_recovery_package(text, text, text, text, text, integer) from public, anon;
grant execute on function public.upsert_recovery_package(text, text, text, text, text, integer) to authenticated;

-- Deleting has the same problem and the same answer.
create or replace function public.delete_recovery_package()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'RC001';
  end if;
  delete from public.recovery_packages where user_id = auth.uid();
end;
$$;

revoke all on function public.delete_recovery_package() from public, anon;
grant execute on function public.delete_recovery_package() to authenticated;
