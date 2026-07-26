-- Remove the edit and delete windows.
--
-- The 15-minute limit was borrowed from other messengers without asking whether
-- it earns its place here. It does not: the thing that actually protects a
-- reader is *knowing* a message changed, not the change being impossible after
-- a while. WhatsApp marks an edit and leaves a tombstone for a delete, and that
-- is honest in a way a silent deadline is not.
--
-- So the window goes and the marks stay: `edited_at` is already set on every
-- edit, and `deleted_at` leaves a row the thread can render as removed.

create or replace function public.edit_message(target uuid, new_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select sender_id, deleted_at into m from public.messages where id = target;

  -- Still yours only, and still not a deleted one: those are about ownership
  -- and coherence, not about time.
  if m is null or m.sender_id <> auth.uid() or m.deleted_at is not null then
    return;
  end if;

  update public.messages
     set body = new_body, edited_at = now()
   where id = target;
end;
$$;

create or replace function public.delete_message(target uuid, for_everyone boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select sender_id, conversation_id into m from public.messages where id = target;
  if m is null or not public.is_conversation_member(m.conversation_id) then
    return;
  end if;

  if for_everyone then
    -- Your own message, at any age. The tombstone is what makes this safe to
    -- allow indefinitely: nothing disappears silently.
    if m.sender_id <> auth.uid() then
      return;
    end if;
    update public.messages
       set deleted_at = now(), body = '', media_url = null, snap_path = null
     where id = target;
  else
    insert into public.hidden_messages (message_id, user_id)
    values (target, auth.uid())
    on conflict do nothing;
  end if;
end;
$$;
