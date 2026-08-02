-- Ensure the fixed AI identity exists in auth.users + profiles.
--
-- The previous seed used bare gen_salt/crypt, which fail on Supabase where
-- pgcrypto lives in the `extensions` schema. Without this row, post_ai_reply
-- cannot insert assistant messages (sender_id → auth.users).

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  bot uuid := public.pingo_ai_user_id();
begin
  if not exists (select 1 from auth.users where id = bot) then
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_sso_user,
      is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000',
      bot,
      'authenticated',
      'authenticated',
      'pingo-ai@system.local',
      extensions.crypt('pingo-ai-no-login', extensions.gen_salt('bf')),
      now(),
      '{"provider":"system","providers":["system"]}'::jsonb,
      '{"display_name":"PINGO"}'::jsonb,
      now(),
      now(),
      false,
      false
    );
  end if;

  insert into public.profiles (id, username, display_name, bio)
  values (bot, 'pingo_ai', 'PINGO', null)
  on conflict (id) do nothing;
exception
  when others then
    raise notice 'pingo_ai bot user seed: %', sqlerrm;
end;
$$;
