-- Allow log_ai_user_turn for groups that include PINGO AI.
create or replace function public.log_ai_user_turn(
  target_conversation uuid,
  turn_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  k text;
  bot uuid := public.pingo_ai_user_id();
  bot_in boolean := false;
begin
  if me is null then return; end if;

  select c.kind into k
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id
  where c.id = target_conversation and m.user_id = me;

  if k is null then return; end if;

  if k = 'ai' then
    null;
  elsif k in ('group', 'community') then
    select exists (
      select 1 from public.conversation_members m
      where m.conversation_id = target_conversation
        and m.user_id = bot
        and m.deleted_at is null
    ) into bot_in;
    if not bot_in then return; end if;
  else
    return;
  end if;

  insert into public.ai_processing_log (user_id, conversation_id, role, body)
  values (me, target_conversation, 'user', left(coalesce(turn_body, ''), 4000));
end;
$$;
