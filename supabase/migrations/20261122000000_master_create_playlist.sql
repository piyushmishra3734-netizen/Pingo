-- PINGO Master: a fourth kind of task, create_playlist.
--
-- PINGO AI can build a whole playlist for a mood or a trip. It only proposes
-- one (the same Approve card as every other task, 5 credits). The playlist
-- itself is saved by the app on approval, into the person's own PINGO Music
-- library, the way a setting is - the library is local-first and mirrors to
-- music_playlists, so writing it from here would only put a copy beside it.
-- The database checks and records the task; what the app saves is the row that
-- was approved.
--
-- params = { name, songs: [{ id, name, artists, album, image, secs, language }] }

alter table public.ai_actions drop constraint if exists ai_actions_kind_check;
alter table public.ai_actions
  add constraint ai_actions_kind_check check (kind in ('send_message', 'set_setting', 'mute_chat', 'create_playlist'));

-- The existing checks stay as they are, under a new name; this one only adds
-- its own kind and hands everything else on.
do $$
begin
  if to_regprocedure('public.master_check_base(uuid, text, jsonb, uuid)') is null then
    alter function public.master_check(uuid, text, jsonb, uuid) rename to master_check_base;
  end if;
end $$;
revoke all on function public.master_check_base(uuid, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.master_check(p_user uuid, p_kind text, p_params jsonb, p_self uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  s record;
  nm text;
  n integer;
begin
  if p_kind <> 'create_playlist' then
    return public.master_check_base(p_user, p_kind, p_params, p_self);
  end if;

  select * into s from public.ai_master_settings where user_id = p_user;
  if s is null or not s.enabled then return 'PINGO Master is switched off.'; end if;

  nm := btrim(coalesce(p_params->>'name', ''));
  if char_length(nm) < 1 or char_length(nm) > 80 then return 'The playlist needs a name.'; end if;
  if jsonb_typeof(p_params->'songs') is distinct from 'array' then return 'The playlist has no songs.'; end if;
  n := jsonb_array_length(p_params->'songs');
  if n < 1 or n > 30 then return 'A playlist needs between 1 and 30 songs.'; end if;
  if pg_column_size(p_params) > 24000 then return 'That playlist is too large.'; end if;
  return null;
end;
$$;
revoke all on function public.master_check(uuid, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.master_propose(p_kind text, p_params jsonb, p_run_at timestamptz default null)
returns public.ai_actions language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  problem text;
  made integer;
  row public.ai_actions;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_kind not in ('send_message', 'set_setting', 'mute_chat', 'create_playlist') then raise exception 'Unknown task.'; end if;

  select count(*) into made from public.ai_actions
  where user_id = me and created_at > now() - interval '1 day';
  if made >= public.master_day_cap() then raise exception 'That is plenty for one day. Try again tomorrow.'; end if;

  problem := public.master_check(me, p_kind, p_params);
  if problem is not null then raise exception '%', problem; end if;

  if p_run_at is not null and (p_run_at > now() + interval '30 days') then
    raise exception 'That is too far ahead. 30 days at most.';
  end if;

  insert into public.ai_actions (user_id, kind, params, params_hash, run_at, credits)
  values (
    me, p_kind, p_params,
    md5(p_kind || coalesce(p_run_at::text, '') || p_params::text),
    case when p_run_at is not null and p_run_at > now() then p_run_at end,
    5
  )
  returning * into row;
  return row;
end;
$$;
