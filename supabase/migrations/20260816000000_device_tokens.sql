-- Push notification device tokens.
--
-- ## One table, every platform
--
-- An FCM registration token identifies *an install on a device*, not a person
-- and not a platform. Android gets one from Firebase Messaging; a browser gets
-- one from the same Firebase project once a VAPID key exists. They are the same
-- kind of string, sent the same way, so they live in the same table and the
-- send path never asks which platform it is talking to. `platform` is recorded
-- for diagnostics and for nothing else.
--
-- ## Why the token is the primary key
--
-- FCM reissues tokens - on reinstall, on restore to a new phone, when a browser
-- clears storage. The same token can also move between accounts: sign out, sign
-- in as somebody else on the same handset, and Firebase hands back the token it
-- already had. If `user_id` owned the row, that second person's messages would
-- go to the first person's notification tray.
--
-- Keying on the token makes the upsert say the true thing: *this device now
-- belongs to this user*. The previous owner's row is replaced rather than
-- duplicated, and there is no window where one token maps to two accounts.
--
-- ## Nothing here identifies a conversation
--
-- The table holds a token, an owner, a platform and two timestamps. What a
-- notification is *about* is looked up at send time and never stored, so this
-- table cannot become a record of who talks to whom.

create table if not exists public.device_tokens (
  -- The FCM registration token. See above for why this, and not a uuid.
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  created_at timestamptz not null default now(),
  -- Bumped on every re-registration, which is how a dead device is recognised.
  -- FCM tokens do not expire on a schedule, so age is the only signal there is.
  last_seen_at timestamptz not null default now()
);

-- Send fans out per recipient, so that is the index.
create index if not exists device_tokens_user_idx
  on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

/*
 * A device may only ever speak for its own owner.
 *
 * Read is restricted to your own rows too. That is not paranoia about a token
 * being secret - it is that a readable table would let any signed-in user count
 * how many devices somebody has and when they last opened the app, which is
 * presence data by another name and exactly what this product refuses to leak.
 *
 * The send path does not use these policies. It runs in an Edge Function with
 * the service role, which bypasses RLS - the only code that ever reads another
 * user's token is code that never reaches the browser.
 */
drop policy if exists "users read their own device tokens" on public.device_tokens;
create policy "users read their own device tokens"
  on public.device_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "users register their own device tokens" on public.device_tokens;
create policy "users register their own device tokens"
  on public.device_tokens for insert
  with check (auth.uid() = user_id);

/*
 * Update carries no `with check` on the old row by design: claiming a token
 * away from a previous owner is the whole point of the upsert described above.
 * What it cannot do is assign the token to somebody else - `with check` pins
 * the new owner to the caller.
 */
drop policy if exists "users claim device tokens" on public.device_tokens;
create policy "users claim device tokens"
  on public.device_tokens for update
  using (true)
  with check (auth.uid() = user_id);

drop policy if exists "users remove their own device tokens" on public.device_tokens;
create policy "users remove their own device tokens"
  on public.device_tokens for delete
  using (auth.uid() = user_id);
