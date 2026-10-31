-- A switch that turns outdated app versions off.
--
-- An APK carries its own copy of the app, so a build already on a phone cannot
-- be sent a new screen; the only thing that reaches it is the server. So every
-- build from this one on sends `x-pingo-gen` (a generation number, `1` now)
-- with each database request, and when the operator sets `app_gate.min_gen`,
-- PostgREST refuses requests from a browser or app that sends less - which is
-- every build before this one. The new builds see `PINGO_UPDATE_REQUIRED` and
-- show "a new version is out, you are on an outdated one" with the download;
-- old builds simply stop working, and their own Update prompt (update_notice)
-- is what tells them why.
--
-- Off by default (`min_gen = 0`). Turned on from Settings > Controlling once the
-- new APK is out. To retire this generation later, a future build sends `2` and
-- the switch is set to 2.
--
-- Only browsers and app web views are checked (a `Mozilla` user agent): edge
-- functions, the dashboard and the CLI are servers and pass. Anything that goes
-- wrong reading the request lets it through - a gate that fails closed would
-- take the whole app down with it.

create table if not exists public.app_gate (
  id boolean primary key default true check (id),
  min_gen integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.app_gate (id, min_gen) values (true, 0) on conflict (id) do nothing;

alter table public.app_gate enable row level security;
drop policy if exists "anyone reads the app gate" on public.app_gate;
create policy "anyone reads the app gate" on public.app_gate for select to anon, authenticated using (true);
drop policy if exists "operator sets the app gate" on public.app_gate;
create policy "operator sets the app gate" on public.app_gate for update to authenticated
  using (public.is_operator()) with check (public.is_operator());
grant select on public.app_gate to anon, authenticated;
grant update (min_gen, updated_at) on public.app_gate to authenticated;

create or replace function public.pingo_client_gate()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  need integer;
  headers json;
  agent text;
  got integer := 0;
begin
  select min_gen into need from public.app_gate where id;
  if coalesce(need, 0) <= 0 then
    return;
  end if;

  begin
    headers := nullif(current_setting('request.headers', true), '')::json;
    agent := coalesce(headers ->> 'user-agent', '');
    got := coalesce(nullif(regexp_replace(coalesce(headers ->> 'x-pingo-gen', ''), '\D', '', 'g'), '')::integer, 0);
  exception when others then
    return;
  end;

  if agent not like 'Mozilla%' or got >= need then
    return;
  end if;

  raise exception 'PINGO_UPDATE_REQUIRED'
    using errcode = 'P0001',
          hint = 'A new version of PINGO is out and this one is outdated. Update to keep using PINGO.';
end;
$$;

grant execute on function public.pingo_client_gate() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request to 'public.pingo_client_gate';
notify pgrst, 'reload config';
