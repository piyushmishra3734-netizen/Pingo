-- The chat list's previews were the other `select('*')`.
--
-- `messages_page` fixed the thread. The list has its own read: the preview row
-- names each conversation's newest message id, and `#hydrate` then fetched
-- those rows to decrypt one line of text out of each. Twenty ids, `select('*')`,
-- **54 kB** - measured after the thread itself had come down to 1.2 kB, which
-- is what made it the largest thing left.
--
-- It is the same waste for the same reason: nineteen of the twenty wrapped keys
-- in every envelope belong to somebody else's phone, and the list needs one
-- line of plaintext.
--
-- Rather than a second function, `messages_page` grows an id list. The trim has
-- to be identical in every read or the saving quietly fails to apply to
-- whichever one was written last - which is exactly how this one was missed.

create or replace function public.messages_page(
  conv uuid,
  device uuid,
  page_limit integer default 50,
  before_at timestamptz default null,
  since timestamptz default null,
  ids uuid[] default null
)
returns setof jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  if not exists (
    select 1 from public.device_keys d where d.device_id = device and d.user_id = me
  ) then
    raise exception 'unknown device';
  end if;

  /*
   * By id, for the conversation list.
   *
   * No `conversation_id` filter - these ids span every conversation the reader
   * is in, which is the point. RLS is what decides they may see them, exactly
   * as it does below; `security invoker` means that check is not skipped here.
   */
  if ids is not null then
    return query
      select public.trim_envelope(to_jsonb(m), device)
      from public.messages m
      where m.id = any(ids);
    return;
  end if;

  if since is not null then
    return query
      select public.trim_envelope(to_jsonb(m), device)
      from public.messages m
      where m.conversation_id = conv
        and m.updated_at > since
      order by m.updated_at asc
      limit page_limit;
    return;
  end if;

  return query
    select public.trim_envelope(to_jsonb(m), device)
    from public.messages m
    where m.conversation_id = conv
      and (before_at is null or m.created_at < before_at)
    order by m.created_at desc
    limit page_limit;
end;
$$;

/*
 * The old five-argument signature is dropped rather than left beside the new
 * one: two overloads differing only by a defaulted array is exactly the shape
 * PostgREST cannot resolve, and the error it gives says nothing useful.
 */
drop function if exists public.messages_page(uuid, uuid, integer, timestamptz, timestamptz);

revoke all on function public.messages_page(uuid, uuid, integer, timestamptz, timestamptz, uuid[])
  from public;
grant execute on function public.messages_page(uuid, uuid, integer, timestamptz, timestamptz, uuid[])
  to authenticated;
