-- An edit has to re-seal the body, or it writes plaintext into an encrypted row.
--
-- `edit_message` took only the new text and wrote it straight into
-- `messages.body`, leaving `encryption = 'v1'` and the original envelope
-- untouched. Every reader then saw a row claiming to be encrypted, tried to
-- decrypt plaintext, failed, and rendered "Sent before you added this device."
-- over a message that had been edited seconds earlier. The message was not
-- lost and no key was missing -- the row simply described itself wrongly.
--
-- The server cannot fix this on its own: it has no keys and never will, which
-- is the point of the design. So the new ciphertext and the new envelope have
-- to arrive from the client that made the edit, exactly as they do on send.

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

  -- Still yours only, and still not a deleted one.
  if m is null or m.sender_id <> auth.uid() or m.deleted_at is not null then
    return;
  end if;

  update public.messages
     set body = new_body,
         encryption = new_encryption,
         envelope = new_envelope,
         edited_at = now()
   where id = target;
end;
$$;

/*
 * The two-argument form stays, because a tab loaded before this deploy will
 * still call it, but it may no longer touch an encrypted row.
 *
 * Refusing is the whole point. Writing plaintext into an encrypted message is
 * the defect being removed, and an old client succeeding at it quietly is worse
 * than an edit that visibly does not happen.
 */
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

  if m is null or m.sender_id <> auth.uid() or m.deleted_at is not null then
    return;
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

/*
 * Repair for anything the old path already broke.
 *
 * A row edited while the defect was live holds plaintext in `body` but still
 * claims `encryption = 'v1'`, so it can never be decrypted by anyone -- the
 * ciphertext it names does not exist any more. The body is readable text and
 * the honest description of it is an unencrypted row, so the row is corrected
 * to say what it actually contains rather than left permanently unreadable.
 *
 * This declassifies nothing that was still secret: the plaintext was written to
 * the server by the old client at edit time. The migration stops the row lying
 * about it. Bounded to edits made before this migration so a correctly sealed
 * edit can never be caught by it.
 */
update public.messages
   set encryption = null,
       envelope = null
 where encryption is not null
   and edited_at is not null
   and edited_at < now();
