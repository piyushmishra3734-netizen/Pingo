-- Turning Secure Backup off has to be able to remove the package.
--
-- `recovery_packages` had policies for insert, update and select and none for
-- delete, so RLS refused every removal. That is not a safe default here, it is
-- a stuck one: senders read `public_key` to decide whether to add a recovery
-- wrap, so a package left behind keeps every future message wrapped for a key
-- the user has deliberately discarded. The switch would say off while the
-- behaviour it controls stayed on.
--
-- Deleting the package is not the same as destroying history. Messages already
-- sent keep their existing wrap and stay readable with the code the user holds
-- -- retiring a key is not the same as revoking it, which is the distinction
-- the recovery architecture draws.

create policy "delete own package"
  on public.recovery_packages for delete
  to authenticated
  using (user_id = auth.uid());
