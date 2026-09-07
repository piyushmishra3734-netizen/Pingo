/*
 * Recovered from the database - see the note in
 * `20260932000001_device_key_seen_column_privilege.sql`.
 *
 * The anchor is the server-side value a restore is checked against, so a client
 * that could write it could authorise its own restore. RLS already refused, but
 * the grant is what makes that refusal not depend on a policy staying correct.
 */

revoke all on table public.backup_anchor from anon, authenticated;
grant select on table public.backup_anchor to authenticated;
