-- push_allowed, restored - pushes had been dead since 11 September.
--
-- 20260965000000 (live streams) rewrote `push_allowed` to add the 'live' kind
-- from a stale copy that read `p.social` - a column `notification_prefs` has
-- never had. PL/pgSQL resolves record fields when the line runs, so every call
-- raised `record "p" has no field "social"`. 20261002000000 (live hardening)
-- put the DND clause back into that same broken body.
--
-- What that did, end to end: `on_notification_push` failed on every
-- notification, its error handler then failed too (the push_failures conflict
-- target - fixed in 20261004000000), and `on_message_insert` swallows errors,
-- so from 12 September no message created a notification and no push was
-- sent. The stale copy had also dropped the new-device bypass, the voice /
-- mention / call / AI / journey / marketing switches and the call exception to
-- quiet hours.
--
-- This is the 20260960000000 (presence_dnd) body - the last correct one - with
-- 'live' added under the Stories switch, the social thing a live is.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as
-- `push_allowed_restored`.

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
  -- A security notification is not silenced by preferences (see presence_dnd).
  if event_kind = 'new_device' then
    return true;
  end if;

  select * into p from public.notification_prefs where user_id = target;

  if not found then
    return true;
  end if;

  if p.muted or p.dnd then
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
    when 'live' then if not p.stories then return false; end if;
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

    -- A call is not silenced by quiet hours.
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
