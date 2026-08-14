-- Stop sending every reader fifteen other people's wrapped keys.
--
-- ## The measurement
--
-- 17,001 messages occupy 37 MB of row data, and 35 MB of that - **95%** - is
-- the `envelope` column. The average envelope holds **15.46** wrapped content
-- keys, one per device that could ever open the message. A client needs exactly
-- **one**: its own.
--
-- Every read path used `select('*')`, so opening a conversation shipped all
-- fifteen. Measured on a device that already held the whole thread: 253 kB for
-- a page of fifty, where the useful payload was nearer 25 kB.
--
-- ## What this is not
--
-- It is not a change to the encryption. The same ciphertext, the same
-- ephemeral public key, the same iv, the same wrapped key for the device
-- asking. `openEnvelope` has only ever read `envelope.keys[thisDevice]` - the
-- other fourteen were never used by the client that received them, and
-- wrapping still happens at send time against a fresh read of `device_keys`.
--
-- What is removed is the part of the payload that was addressed to somebody
-- else's phone.
--
-- ## Why jsonb rather than `setof messages`
--
-- A `setof public.messages` function has to name every column in order, so the
-- next migration that adds one silently breaks the page. `to_jsonb(m)` with the
-- envelope replaced survives that, and PostgREST hands the client the same
-- array of objects it was already parsing.
--
-- ## One function, three reads
--
-- The newest page, the page before a cursor, and the delta since a timestamp
-- were three near-identical queries. They are one function with three optional
-- arguments, because the interesting part - the trim - must be identical in all
-- three or the saving quietly does not apply to whichever was forgotten.
--
-- `security invoker`, deliberately: the select inside runs as the caller, so
-- row-level security decides what is visible exactly as it did before.

create or replace function public.messages_page(
  conv uuid,
  device uuid,
  page_limit integer default 50,
  before_at timestamptz default null,
  since timestamptz default null
)
returns setof jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  /*
   * The device has to be one of yours.
   *
   * Not because the wrapped key is a secret - it is useless without a private
   * key that never leaves the device that made it - but because a function that
   * accepts any id at all invites being called with a list of them, and the
   * answer would say which devices a message was addressed to.
   */
  if not exists (
    select 1 from public.device_keys d where d.device_id = device and d.user_id = me
  ) then
    raise exception 'unknown device';
  end if;

  if since is not null then
    -- Delta: what changed, oldest first, so a partial page still advances the
    -- cursor honestly.
    return query
      select public.trim_envelope(to_jsonb(m), device)
      from public.messages m
      where m.conversation_id = conv
        and m.updated_at > since
      order by m.updated_at asc
      limit page_limit;
    return;
  end if;

  return query
    select public.trim_envelope(to_jsonb(m), device)
    from public.messages m
    where m.conversation_id = conv
      and (before_at is null or m.created_at < before_at)
    order by m.created_at desc
    limit page_limit;
end;
$$;

/*
 * The trim itself, so the three reads above cannot disagree about it.
 *
 * A message with no envelope (plaintext: system notices, AI threads) passes
 * through untouched. A message whose envelope holds no wrap for this device -
 * one sent before the device existed - keeps an empty `keys` object rather than
 * losing the key entirely, so the client still sees a well-formed envelope and
 * reports "sent before you added this device" instead of failing to parse.
 */
create or replace function public.trim_envelope(row_json jsonb, device uuid)
returns jsonb
language sql
immutable
as $$
  select case
    when row_json->'envelope' is null or jsonb_typeof(row_json->'envelope') <> 'object'
      then row_json
    else jsonb_set(
      row_json,
      '{envelope}',
      jsonb_build_object(
        'epk', row_json->'envelope'->'epk',
        'iv', row_json->'envelope'->'iv',
        'keys', case
          when row_json->'envelope'->'keys' ? device::text
            then jsonb_build_object(
              device::text,
              row_json->'envelope'->'keys'->(device::text)
            )
          else '{}'::jsonb
        end
      )
    )
  end;
$$;

revoke all on function public.trim_envelope(jsonb, uuid) from public;
revoke all on function public.messages_page(uuid, uuid, integer, timestamptz, timestamptz) from public;
grant execute on function public.messages_page(uuid, uuid, integer, timestamptz, timestamptz) to authenticated;

comment on function public.messages_page is
  'A page of a conversation with each envelope trimmed to the calling device''s own wrapped key. Same rows RLS would return; roughly a tenth of the bytes.';
