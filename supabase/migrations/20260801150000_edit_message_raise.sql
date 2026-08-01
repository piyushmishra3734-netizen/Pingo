-- Edit must fail loudly when it cannot run.
--
-- Both overloads used to `return` on ownership / deleted checks. PostgREST
-- reported success, the client re-fetched an unchanged row, and the user saw
-- "edit did nothing" with no error. Raise so the UI can surface the truth.

create or replace function public.edit_message(
  target uuid,
  new_body text,
  new_encryption text,
  new_envelope jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select sender_id, deleted_at into m from public.messages where id = target;

  if m is null then
    raise exception 'That message is no longer available.';
  end if;

  if m.sender_id <> auth.uid() then
    raise exception 'You can only edit your own messages.';
  end if;

  if m.deleted_at is not null then
    raise exception 'Deleted messages cannot be edited.';
  end if;

  update public.messages
     set body = new_body,
         encryption = new_encryption,
         envelope = new_envelope,
         edited_at = now()
   where id = target;
end;
$$;

create or replace function public.edit_message(target uuid, new_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select sender_id, deleted_at, encryption into m
  from public.messages where id = target;

  if m is null then
    raise exception 'That message is no longer available.';
  end if;

  if m.sender_id <> auth.uid() then
    raise exception 'You can only edit your own messages.';
  end if;

  if m.deleted_at is not null then
    raise exception 'Deleted messages cannot be edited.';
  end if;

  if m.encryption is not null then
    raise exception 'This copy of PINGO cannot edit an encrypted message. Please reload.';
  end if;

  update public.messages
     set body = new_body, edited_at = now()
   where id = target;
end;
$$;

revoke all on function public.edit_message(uuid, text, text, jsonb) from public;
grant execute on function public.edit_message(uuid, text, text, jsonb) to authenticated;

revoke all on function public.edit_message(uuid, text) from public;
grant execute on function public.edit_message(uuid, text) to authenticated;
