/*
 * Recovered from the database - see the note in
 * `20260932000001_device_key_seen_column_privilege.sql`.
 *
 * A one-off repair, kept for the record rather than because a fresh database
 * needs it: on an empty `ai_profiles` it matches nothing and does nothing.
 *
 * Twelve rows still said "PINGO" while the shared name had moved on to
 * "PINGO AI". That is not a name twelve people picked - it is onboarding's
 * hardcoded fallback, `pub?.displayName ?? 'PINGO'`, written once per account.
 * Same test as the avatars: a name held by more than one row is a copy.
 */

with shared as (
  select display_name from public.ai_profiles where display_name is not null
  group by display_name having count(*) > 1
)
update public.ai_profiles a set display_name = null, updated_at = now()
where a.display_name in (select display_name from shared);
