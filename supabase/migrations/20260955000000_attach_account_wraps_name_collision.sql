/*
 * A function that could not run, caught before it wrote anything.
 *
 * `returns table(message_id uuid, ...)` declares an OUT variable called
 * `message_id`, and the insert in the body names a column of the same name.
 * PL/pgSQL resolves that at run time, calls it ambiguous, and refuses the whole
 * call - so `attach_account_wraps` raised 42702 the first time it was asked to
 * store a wrap, rather than the first time somebody looked at it.
 *
 * It was found by the rehearsal rather than by the migration: the whole
 * behaviour was exercised inside a transaction that ends in a deliberate
 * `raise`, so the bug surfaced with nothing committed. That rehearsal is worth
 * keeping for any future change here - it covers added, skipped, denied, the
 * candidate filter, and the batch cap in one pass, and cannot leave a row
 * behind.
 *
 * Renaming the output is the fix. A `#variable_conflict use_column` pragma
 * would also work and would leave the reader to work out which side won.
 */

drop function if exists public.attach_account_wraps(jsonb);

create function public.attach_account_wraps(wraps jsonb)
returns table(id uuid, status text)
language plpgsql security definer set search_path to 'public' as $fn$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = 'RC001';
  end if;

  if jsonb_typeof(wraps) <> 'array' then
    raise exception 'Expected an array of wraps.' using errcode = 'RC005';
  end if;

  -- Bounded so one call cannot become an unbounded transaction. The client
  -- pages anyway; this is the floor under a client that stops doing so.
  if jsonb_array_length(wraps) > 250 then
    raise exception 'At most 250 wraps per call.' using errcode = 'RC005';
  end if;

  return query
  with items as (
    select (e->>'id')::uuid as mid, e->>'iv' as iv, e->>'key' as k, e->>'epk' as epk
      from jsonb_array_elements(wraps) e
  ),
  allowed as (
    select i.*
      from items i
      join public.messages m on m.id = i.mid
     where public.is_conversation_member(m.conversation_id)
  ),
  added as (
    insert into public.message_account_wraps (message_id, user_id, iv, key, epk)
    select a.mid, me, a.iv, a.k, a.epk from allowed a
        on conflict (message_id, user_id) do nothing
      returning public.message_account_wraps.message_id as mid
  )
  select i.mid,
         case
           when i.mid in (select added.mid from added)     then 'added'
           when i.mid in (select allowed.mid from allowed) then 'skipped'
           else 'denied'
         end
    from items i;
end;
$fn$;

revoke all on function public.attach_account_wraps(jsonb) from public, anon;
grant execute on function public.attach_account_wraps(jsonb) to authenticated;
