/*
 * The wrap that reaches a message, without touching the message.
 *
 * ## Why this is not in the envelope
 *
 * The obvious place for a late-added wrap is `messages.envelope->'keys'`,
 * beside the wraps written at send time. That was the first design, and it was
 * wrong for a reason that only shows up at this scale.
 *
 * `messages_touch_updated_at` sets `updated_at := now()` on every update, and
 * `updated_at` is the delta-sync cursor - `chat-service.ts` pages changes with
 * `gt('updated_at', since)`. Adding a wrap to 36,753 envelopes would therefore
 * mark 36,753 messages as changed, across 21 conversations shared with 18
 * people, and every device any of them own would re-download 136 MB of rows
 * that did not actually change. Worst case measured on 2026-09-10: 2,455 MB
 * against a 5 GB monthly egress allowance that has been exceeded once already.
 *
 * The alternative was to teach the trigger to stay quiet for envelope-only
 * writes, which means changing shared behaviour to make room for a one-off
 * repair. Writing the wraps beside the messages instead costs one small table
 * and leaves `messages` - ciphertext, envelope, `updated_at` and all - byte for
 * byte as it was. It also makes the rollback a `delete`.
 *
 * ## What a row is
 *
 * The same three fields an envelope wrap holds, for the same content key, made
 * to this account's current key. `epk` is not optional here the way it is in
 * the envelope: a wrap made after the fact never shares the message's original
 * ephemeral, because that private half was discarded when the message was
 * sealed. See `rewrapContentKey` in `crypto/envelope.ts`.
 *
 * The server still never sees a content key or a body. It sees a wrap that is
 * already encrypted to a public key, which is the same thing it has always
 * stored.
 */

create table if not exists public.message_account_wraps (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id)      on delete cascade,

  iv  text not null,
  key text not null,
  epk text not null,

  created_at timestamptz not null default now(),

  primary key (message_id, user_id),

  /*
   * Shape, not correctness. A wrap that is the wrong *value* simply fails to
   * open for the one account that can read it, which is survivable; a wrap that
   * is megabytes long is not, so the bound is here rather than in a check the
   * client could skip. Base64 of 12 bytes is 16 characters, of a 32-byte key
   * plus its GCM tag 64, and of an SPKI P-256 public key 124.
   */
  constraint message_account_wraps_shape check (
    length(iv)  between 1 and 32
    and length(key) between 1 and 256
    and length(epk) between 1 and 256
  )
);

comment on table public.message_account_wraps is
  'Account-key wraps added after the fact, so history reaches a device that did not exist when it was sent. Never modifies messages.';

alter table public.message_account_wraps enable row level security;

/*
 * Read your own, and nothing else. There is deliberately no client-facing
 * insert, update or delete policy: writes go through `attach_account_wraps`, so
 * conversation membership is checked once, server-side, and the owning user id
 * comes from `auth.uid()` rather than from the request.
 */
create policy "read my own account wraps" on public.message_account_wraps
  for select using (user_id = auth.uid());

revoke all on table public.message_account_wraps from anon;
grant select on table public.message_account_wraps to authenticated;

/*
 * Messages this device can open that this account has no wrap for yet.
 *
 * Paged by `id` rather than by `created_at` on purpose. The primary key is the
 * only index covering the whole table, and ordering by it lets the scan stop as
 * soon as it has a page - which matters because `envelope->'keys' ? ...` has to
 * detoast the envelope to answer, and the envelopes are 149 MB of TOAST. A
 * predicate-only scan would read all of that for every batch.
 *
 * `wrap` is the caller's own wrap and nothing else. Returning the whole
 * envelope would be 3.7 kB a message where 300 bytes will do, which over 36,753
 * messages is the difference between 10 MB of egress and 131 MB.
 */
create or replace function public.account_wrap_candidates(
  my_device text,
  after_id uuid default null,
  batch integer default 250
) returns table(id uuid, epk text, wrap jsonb)
language sql stable security definer set search_path to 'public' as $fn$
  select m.id,
         m.envelope->>'epk',
         m.envelope->'keys'->my_device
    from public.messages m
   where m.envelope is not null
     and m.envelope->'keys' ? my_device
     and m.id > coalesce(after_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and public.is_conversation_member(m.conversation_id)
     and not exists (
           select 1 from public.message_account_wraps w
            where w.message_id = m.id and w.user_id = auth.uid()
         )
   order by m.id
   limit least(greatest(coalesce(batch, 250), 1), 250);
$fn$;

/*
 * Store a page of wraps, for the caller, in the caller's own conversations.
 *
 * Three things make this safe to hand to a client:
 *
 *   - `user_id` is `auth.uid()`, never a field in the request, so a caller can
 *     only ever write a wrap for themselves;
 *   - membership is re-checked here, so a message id lifted from somebody
 *     else's conversation is simply not inserted;
 *   - `on conflict do nothing` makes a second run a no-op rather than an
 *     overwrite, which is what makes the backfill resumable and a failed batch
 *     safe to retry.
 *
 * Nothing in `public.messages` is read for its content, or written at all.
 */
create or replace function public.attach_account_wraps(wraps jsonb)
returns table(message_id uuid, status text)
language plpgsql security definer set search_path to 'public' as $fn$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = 'RC001';
  end if;

  if jsonb_typeof(wraps) <> 'array' then
    raise exception 'Expected an array of wraps.' using errcode = 'RC005';
  end if;

  -- Bounded so one call cannot become an unbounded transaction. The client
  -- pages anyway; this is the floor under a client that stops doing so.
  if jsonb_array_length(wraps) > 250 then
    raise exception 'At most 250 wraps per call.' using errcode = 'RC005';
  end if;

  return query
  with items as (
    select (e->>'id')::uuid as mid, e->>'iv' as iv, e->>'key' as k, e->>'epk' as epk
      from jsonb_array_elements(wraps) e
  ),
  allowed as (
    select i.*
      from items i
      join public.messages m on m.id = i.mid
     where public.is_conversation_member(m.conversation_id)
  ),
  added as (
    insert into public.message_account_wraps (message_id, user_id, iv, key, epk)
    select a.mid, me, a.iv, a.k, a.epk from allowed a
        on conflict (message_id, user_id) do nothing
      returning public.message_account_wraps.message_id as mid
  )
  select i.mid,
         case
           when i.mid in (select added.mid from added)       then 'added'
           when i.mid in (select allowed.mid from allowed)   then 'skipped'
           else 'denied'
         end
    from items i;
end;
$fn$;

revoke all on function public.account_wrap_candidates(text, uuid, integer) from public, anon;
revoke all on function public.attach_account_wraps(jsonb)                  from public, anon;
grant execute on function public.account_wrap_candidates(text, uuid, integer) to authenticated;
grant execute on function public.attach_account_wraps(jsonb)                  to authenticated;
