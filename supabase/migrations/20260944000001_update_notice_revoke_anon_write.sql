/*
 * Recovered from the database - see the note in
 * `20260932000001_device_key_seen_column_privilege.sql`.
 *
 * The project's default privileges hand anon insert/update/delete on every new
 * public table; RLS is what actually stops it, and here no anon policy exists.
 * Revoked anyway, so the table does not depend on a policy staying correct.
 */

revoke insert, update, delete on public.update_notice from anon;
