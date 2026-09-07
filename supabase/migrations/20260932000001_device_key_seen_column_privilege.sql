/*
 * Recovered from the database, where it was the only copy.
 *
 * This ran against production on 2026-08-19 and was never written to disk -
 * found while preparing the move to a new project, by comparing the 122 rows in
 * `supabase_migrations.schema_migrations` against the 115 files in this folder.
 * Replaying this folder onto a fresh database would have produced a schema that
 * did not match the one it was replacing, quietly.
 *
 * ## What it does
 *
 * `key_seen_at` is when this device's *key* was last published, which is a
 * different question from `last_seen_at` and one nobody else is entitled to ask:
 * it is what `prune_stale_device_keys` orders by, and reading it across accounts
 * would say how recently each of somebody's devices had opened the app whether
 * or not they show activity status.
 *
 * The rest of the table stays readable, deliberately - `device keys are public`
 * is the SELECT policy, because a sender has to fetch every recipient device's
 * public key to encrypt to it. So the column is removed from the grant rather
 * than the row from the policy.
 */

revoke select on public.device_keys from authenticated;

grant select (device_id, user_id, public_key, created_at, last_seen_at, label, build)
  on public.device_keys to authenticated;
