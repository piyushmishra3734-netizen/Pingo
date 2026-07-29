-- Delta synchronisation needs a second cursor.
--
-- A creation cursor -- "everything newer than the last message I stored" --
-- cannot see a message whose `created_at` is old but whose text has just
-- changed. Edits, deletions and restores all move nothing that a
-- `created_at > ?` query looks at, so a client would keep showing the old body
-- indefinitely and only notice on a full refetch. That is precisely the full
-- refetch milestone 3 exists to stop doing.
--
-- So rows carry when they last changed, and the client asks two cheap indexed
-- questions instead of one expensive unconditional one.

alter table public.messages
  add column if not exists updated_at timestamptz not null default now();

/*
 * Backfilled from what is already known rather than stamped with now().
 *
 * Setting every existing row to the migration's timestamp would tell every
 * client that all 1,900 messages had just changed, and the first delta sync
 * after deploy would download the entire history -- the exact behaviour being
 * removed, triggered by the change meant to remove it.
 */
update public.messages
   set updated_at = greatest(created_at, coalesce(edited_at, created_at), coalesce(deleted_at, created_at))
 where updated_at is not null;

create index if not exists messages_conversation_updated_idx
  on public.messages (conversation_id, updated_at);

/*
 * Maintained by the database, not by callers.
 *
 * A client that forgets to set it would go unnoticed until somebody's edit
 * stopped propagating, and the column is only worth having if it is always
 * right. `pg_trigger_depth()` is not needed here because nothing else updates
 * this table from a trigger.
 */
create or replace function public.touch_message_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists messages_touch_updated_at on public.messages;
create trigger messages_touch_updated_at
  before update on public.messages
  for each row
  execute function public.touch_message_updated_at();

-- The column is readable by anyone who can already read the row; it carries no
-- information the row does not. No policy change is required.
