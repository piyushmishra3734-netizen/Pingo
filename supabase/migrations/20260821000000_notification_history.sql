-- Notification history: three columns, no new table.
--
-- `read_at` already existed and answers "has this been seen in the app". The
-- two new ones answer the questions it cannot:
--
--   opened_at     somebody acted on it - tapped through to the thing itself
--   dismissed_at  somebody swiped it away
--
-- Read and opened are genuinely different. Scrolling past a row marks it read;
-- only a tap says the notification did its job. Keeping them apart is what
-- makes an open rate mean anything - with one column, every notification that
-- was ever seen would look like a success.
--
-- ## Dismissed, not deleted
--
-- Swiping a notification away hides it. The row stays, because a notification
-- is the only record that something happened at a moment - a call that was
-- missed, a request that was accepted - and deleting it deletes the history
-- somebody may come back for. After thirty days it stops appearing anyway.
--
-- ## Why no `notification_events` table
--
-- Delivered, opened and ignored are three states of one row, not three rows.
-- An events table would mean a join and a group-by to answer "was this opened",
-- and the same answer is already a column comparison.

alter table public.notifications
  add column if not exists opened_at timestamptz,
  add column if not exists dismissed_at timestamptz;

-- The history query: this person's notifications, newest first, hiding the
-- dismissed and anything past the window.
create index if not exists notifications_history_idx
  on public.notifications (user_id, created_at desc)
  where dismissed_at is null;

/**
 * Marks a notification opened, and read along with it.
 *
 * One call rather than two, because an open implies a read and letting a client
 * set them separately invites the combination that makes no sense - opened but
 * unread - which would quietly corrupt every rate computed from them.
 */
create or replace function public.notification_opened(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
  set opened_at = coalesce(opened_at, now()),
      read_at = coalesce(read_at, now())
  where id = target
    and user_id = auth.uid();
end;
$$;

/** Swipe-away. Hides the row from history without destroying it. */
create or replace function public.notification_dismissed(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
  set dismissed_at = coalesce(dismissed_at, now()),
      read_at = coalesce(read_at, now())
  where id = target
    and user_id = auth.uid();
end;
$$;

/**
 * Delivered, opened, ignored - per kind.
 *
 * "Ignored" is delivered and not opened, which is only meaningful once a
 * notification has had time to be acted on; anything from the last hour is
 * excluded rather than counted as a failure it has not had the chance to be.
 *
 * Operator only, same allowlist as `push_health`. Open rates per kind are a
 * fact about everybody's behaviour, not about the person asking.
 */
create or replace function public.notification_engagement()
returns table (
  kind text,
  delivered bigint,
  opened bigint,
  ignored bigint,
  open_rate_percent numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and username in ('kashish_', 'piuxxh')
  ) then
    raise exception 'not allowed';
  end if;

  return query
  select
    n.kind::text,
    count(*)::bigint as delivered,
    count(n.opened_at)::bigint as opened,
    (count(*) - count(n.opened_at))::bigint as ignored,
    case when count(*) = 0 then null
         else round(100.0 * count(n.opened_at) / count(*), 1)
    end as open_rate_percent
  from public.notifications n
  where n.created_at < now() - interval '1 hour'
    and n.created_at > now() - interval '30 days'
  group by n.kind
  order by count(*) desc;
end;
$$;

revoke all on function public.notification_engagement() from public;
grant execute on function public.notification_engagement() to authenticated;
