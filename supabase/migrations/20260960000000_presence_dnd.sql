-- Do not disturb: the half of the online / invisible / do-not-disturb choice
-- that only its owner may know.
--
-- Invisible and do not disturb both hide somebody's presence, and that half
-- already has a home: privacy_settings.online_status, which every client and
-- the device_keys trigger honour. It is world-readable by design - a rule about
-- what may be shown has to be knowable by whoever is doing the showing - so it
-- cannot also say which of the two somebody chose without telling everyone.
--
-- The other half is notification_prefs.dnd, on a table only its owner can read.
-- To anybody else invisible and do not disturb are the same thing: offline.
--
-- The push gate treats it exactly like "mute all": nothing is pushed, calls
-- included. A new-device warning still is - it is checked before the
-- preferences are read at all, and a switch that hid break-ins would be a
-- switch nobody should have.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as `presence_dnd`.
-- push_allowed below is the live definition with one clause added.

alter table public.notification_prefs
  add column if not exists dnd boolean not null default false;

comment on column public.notification_prefs.dnd is
  'Do not disturb. Silences every push except new_device, like muted, but is a separate choice so leaving it does not clear somebody''s own mute.';

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
  /*
   * A security notification is not silenced by preferences.
   *
   * Mute and quiet hours exist so a messenger does not wake somebody at 3am
   * about a story. "A device you do not recognise just signed in" is the one
   * message where 3am is the point, and a switch that suppressed it would be a
   * switch that hides break-ins. Checked before the prefs are even read.
   */
  if event_kind = 'new_device' then
    return true;
  end if;

  select * into p from public.notification_prefs where user_id = target;

  if not found then
    return true;
  end if;

  /*
   * Do not disturb is mute all by another name, and a separate column so that
   * leaving it puts back whatever the person's own mute switch said.
   */
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
