/*
 * Claiming a push token from a previous owner, without handing everybody a
 * presence feed.
 *
 * ## What was broken
 *
 * `POST /rest/v1/device_tokens` returned 403 for anybody whose browser or
 * handset had ever been signed into a second account. Reproduced against this
 * database by impersonating one user and upserting a token owned by another:
 *
 *     42501: new row violates row-level security policy
 *            (USING expression) for table "device_tokens"
 *
 * The client sends `on_conflict=token`, which is `INSERT ... ON CONFLICT DO
 * UPDATE`. Postgres applies *both* the SELECT `USING` and the UPDATE `USING`
 * to the conflicting row before it will update it. The UPDATE policy was
 * deliberately `using (true)` so a claim could work - the migration that added
 * it says as much - but SELECT stayed `auth.uid() = user_id`, and the row being
 * claimed belongs to somebody else by definition. So the one case the loose
 * UPDATE policy existed to allow was the one case that could never happen.
 *
 * The damage is quiet and large: 43 accounts and 74 registered devices, against
 * 6 push tokens. Registration fails, `on_notification_push` reads "no device
 * row" as a normal skip, and the client discarded the error - so nothing was
 * logged anywhere and push simply did not arrive.
 *
 * ## Why a function rather than a looser policy
 *
 * Relaxing SELECT to `using (true)` is a one-line fix and the wrong one: that
 * policy is what stops any signed-in user reading everybody else's device count
 * and `last_seen_at`, which is a presence feed nobody consented to. The
 * original migration says so, and it is right.
 *
 * `security definer` puts the claim inside the database instead, where it can
 * touch the conflicting row without granting anyone the ability to read it. The
 * read policy is untouched.
 *
 * ## The client no longer says who it is
 *
 * `user_id` is not a parameter. It is `auth.uid()`, taken from the caller's own
 * token, so a client cannot register a token against somebody else's account
 * even by accident. That was possible before - the INSERT policy checked it,
 * but the value still travelled from the browser.
 */

create or replace function public.register_device_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = 'DT001';
  end if;

  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'A push token is required.' using errcode = 'DT002';
  end if;

  insert into public.device_tokens (token, user_id, platform, last_seen_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = auth.uid(),
        platform = excluded.platform,
        last_seen_at = now();
end;
$$;

comment on function public.register_device_token(text, text) is
  'Registers or claims a push token for the calling account. Exists because an upsert from the client cannot claim a token owned by another user: the conflict path also applies the SELECT policy, which that row fails.';

revoke all on function public.register_device_token(text, text) from public, anon;
grant execute on function public.register_device_token(text, text) to authenticated;
