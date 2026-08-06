-- The kinds a notification is allowed to be.
--
-- Five were allowed: follow_request, follow_accepted, message, snap, story.
-- Everything else in the product happened silently - a missed call, a voice
-- note, a like, a mention. `push_allowed()` already had branches for `call` and
-- `ai` and they could never run, because no row of that kind could exist to
-- reach them.
--
-- ## Why a voice note is its own kind
--
-- It is a message, and the notification could say "sent you a message" and be
-- true. But the reply is different: text can be read at a glance on a lock
-- screen and answered with a thumb, a voice note has to be listened to. Telling
-- somebody which one is waiting is what lets them decide whether to pick the
-- phone up now or later, and that decision is the whole purpose of a
-- notification.
--
-- ## Why `call` is here before call notifications are built
--
-- A missed call is a notification the product owes people and does not send.
-- The kind has to exist before anything can create one, and adding it now means
-- the preference gate, the copy and the grouping are all ready when the caller
-- side lands - rather than a migration blocking a feature that is otherwise
-- finished.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
    check (
      kind in (
        'follow_request',
        'follow_accepted',
        'message',
        -- A voice note. Distinct from `message` because answering one costs
        -- more than answering text, and that is worth knowing before opening.
        'voice',
        -- The column still says `snap`; the product says Ping. Renamed on the
        -- way out in `listNotifications` rather than migrating live rows.
        'snap',
        -- Both already exist in live rows: somebody opened or replayed your Ping.
        -- Left out of the first draft of this list, which is how a widening
        -- constraint managed to fail - the new set has to be a superset of what
        -- is already stored, not of what the code happens to send today.
        'ping_opened',
        'ping_replayed',
        'story',
        -- Somebody replied to a story of yours, rather than posting their own.
        'story_reply',
        'call',
        'mention',
        'like',
        'comment',
        -- PINGO AI answering in the AI thread.
        'ai',
        -- From PINGO itself. Both default to off in notification_prefs.
        'journey',
        'marketing'
      )
    );

/**
 * `on_message_insert`, taught the difference between kinds of message.
 *
 * The trigger already fanned out one notification per recipient. It called all
 * of them `message` except a Ping, so a voice note arrived looking exactly like
 * a line of text.
 */
create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member record;
  event_kind text;
begin
  event_kind := case new.kind
    when 'snap' then 'snap'
    when 'voice' then 'voice'
    when 'call' then 'call'
    else 'message'
  end;

  for member in
    select user_id from public.conversation_members
    where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.notify_user(member.user_id, new.sender_id, event_kind, new.conversation_id);
  end loop;

  return new;
end;
$$;

/**
 * The preference gate, extended to the kinds that now exist.
 *
 * A voice note follows the Messages switch, because it is a message and
 * somebody who silenced messages did not mean "except the spoken ones". A story
 * reply follows Stories for the same reason.
 */
create or replace function public.push_allowed(target uuid, event_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.notification_prefs%rowtype;
  local_minute integer;
begin
  select * into p from public.notification_prefs where user_id = target;

  if not found then
    return true;
  end if;

  if p.muted then
    return false;
  end if;

  case event_kind
    when 'message' then if not p.messages then return false; end if;
    when 'voice' then if not p.messages then return false; end if;
    when 'snap' then if not p.messages then return false; end if;
    when 'mention' then if not p.messages then return false; end if;
    when 'story' then if not p.stories then return false; end if;
    when 'story_reply' then if not p.stories then return false; end if;
    when 'like' then if not p.stories then return false; end if;
    when 'comment' then if not p.stories then return false; end if;
    when 'follow_request' then if not p.friend_requests then return false; end if;
    when 'follow_accepted' then if not p.friend_requests then return false; end if;
    when 'call' then if not p.calls then return false; end if;
    when 'ai' then if not p.ai then return false; end if;
    when 'journey' then if not p.journey then return false; end if;
    when 'marketing' then if not p.marketing then return false; end if;
    else null;
  end case;

  if p.quiet_enabled then
    local_minute := (
      extract(hour from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes)) * 60
      + extract(minute from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes))
    )::integer;

    /*
     * A call is not silenced by quiet hours.
     *
     * Everything else here can wait until morning; somebody ringing you at
     * three in the morning is usually the reason quiet hours have an exception
     * at all. If that turns out to be wrong it becomes its own switch, not a
     * silent rule.
     */
    if event_kind <> 'call' then
      if p.quiet_start_minute > p.quiet_end_minute then
        if local_minute >= p.quiet_start_minute or local_minute < p.quiet_end_minute then
          return false;
        end if;
      else
        if local_minute >= p.quiet_start_minute and local_minute < p.quiet_end_minute then
          return false;
        end if;
      end if;
    end if;
  end if;

  return true;
end;
$$;
