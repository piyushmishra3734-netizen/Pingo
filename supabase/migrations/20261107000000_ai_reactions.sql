-- PINGO AI reacts to your message with an emoji.
--
-- One narrow door. The AI cannot pick a message, a chat or a person: it can put
-- one emoji from a short list on the message that just called it, the caller's
-- own newest message in that chat. In a group that is only a message that
-- tagged @pingoai; a message nobody tagged it on is out of reach.

alter table public.ai_profiles
  add column if not exists reactions_enabled boolean not null default true;

create or replace function public.ai_react(target_conversation uuid, symbol text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  bot uuid := public.pingo_ai_user_id();
  k text;
  target uuid;
  chosen text := btrim(coalesce(symbol, ''));
  on_ boolean;
  n integer;
begin
  -- Membership, and in a group that PINGO AI is a member too.
  perform public.ai_may_post(target_conversation);

  select reactions_enabled into on_ from public.ai_profiles where user_id = me;
  if on_ is false then return null; end if;

  -- The list of emoji it may use. Anything else is refused, not guessed at.
  if chosen not in ('❤️', '❤', '😂', '👍', '🔥', '😮', '😢', '🙏', '🎉', '💯', '👏', '😍', '🤝', '🫡', '😊', '🥹') then
    return null;
  end if;

  select c.kind into k from public.conversations c where c.id = target_conversation;

  select m.id into target
  from public.messages m
  where m.conversation_id = target_conversation
    and m.sender_id = me
    and m.deleted_at is null
    and m.created_at > now() - interval '3 minutes'
    -- In a group only the message that tagged PINGO AI.
    and (k not in ('group', 'community') or m.body ~* '@pingo_?ai\y')
  order by m.created_at desc
  limit 1;

  if target is null then return null; end if;

  -- One reaction from PINGO AI per message; it does not change its mind.
  insert into public.message_reactions (message_id, user_id, emoji)
  values (target, bot, chosen)
  on conflict (message_id, user_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return null; end if;

  return chosen;
end;
$$;

revoke all on function public.ai_react(uuid, text) from public;
grant execute on function public.ai_react(uuid, text) to authenticated;

notify pgrst, 'reload schema';
