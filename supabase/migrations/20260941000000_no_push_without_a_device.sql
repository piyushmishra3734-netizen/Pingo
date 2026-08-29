-- Do not start a push for somebody who has no device to push to.
--
-- ## The outage this comes from
--
-- 2026-08-29, 13:21-13:40 UTC. Every request to the API returned 503 for about
-- six minutes and nobody could send a message. Nothing had been deployed; a
-- nine-person group simply received 226 messages in forty-five minutes.
--
-- The fan-out is one row in `notifications` per member, and `notifications_push`
-- fires one `push-send` invocation per row. So 226 messages became 1,672
-- notifications became 1,573 Edge Function invocations, each averaging 1.16
-- seconds and three or four PostgREST round trips of its own. Postgres crossed
-- its statement timeout at 13:21, `conversation_previews` started failing,
-- message inserts followed, and by 13:34 the pooler had nothing left to give.
-- It recovered on its own when the burst stopped. Nothing was lost - the retry
-- queue is empty and there are no dead letters.
--
-- ## Why most of that work could never have done anything
--
-- Of those 1,573 invocations, 384 sent a notification. The rest ran three
-- queries to discover that the recipient has no device token, and returned.
--
-- That group has nine members and three registered tokens. Six of every eight
-- invocations per message were doomed before they started - not because
-- anything is broken, but because most people never granted notification
-- permission, so there is no address to send to. Across the whole project it is
-- six tokens for thirty-two accounts.
--
-- ## The fix
--
-- Ask before spending. The check goes first, ahead of the vault read, the
-- preference lookup, the profile lookup and the unread `count(*)` - all of
-- which this trigger was running for people who could not be reached either
-- way. `device_tokens_user_idx` makes it an index probe.
--
-- Deliberately *not* recorded as a failure. `push-send` already treats "no
-- devices" as something that must never be retried - a queue entry for somebody
-- who has not installed the app would sit there for twenty-four hours - and
-- this is the same condition, found one step earlier.
--
-- The race it accepts: a token registered in the moment between the
-- notification row and this check means that one push is not sent. The message,
-- the in-app notification and the unread badge are all unaffected, and the next
-- notification finds the token. That is a better trade than the alternative,
-- which is what just took the API down.

create or replace function public.on_notification_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  secret text;
  actor_name text;
  unread_count integer;
  chosen_preview text;
  base_url text := 'https://lppzoqgvshhmxqsvggug.supabase.co/functions/v1/push-send';
begin
  if not public.push_allowed(new.user_id, new.kind) then
    return new;
  end if;

  /*
   * Nothing to push to, so nothing to prepare.
   *
   * First, before the four lookups below, because the whole point is to not do
   * them. Not a failure and never queued: see the header.
   */
  if not exists (
    select 1 from public.device_tokens where user_id = new.user_id
  ) then
    return new;
  end if;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'push_trigger_secret';

  if secret is null then
    insert into public.push_failures (notification_id, user_id, reason)
    values (new.id, new.user_id, 'push_trigger_secret missing from vault')
    on conflict (notification_id) do nothing;
    return new;
  end if;

  select coalesce(preview, 'sender_only') into chosen_preview
  from public.notification_prefs where user_id = new.user_id;
  chosen_preview := coalesce(chosen_preview, 'sender_only');

  select display_name into actor_name
  from public.profiles
  where id = new.actor_id;

  select count(*) into unread_count
  from public.notifications
  where user_id = new.user_id
    and kind = new.kind
    and actor_id is not distinct from new.actor_id
    and read_at is null;

  perform net.http_post(
    url := base_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pingo-push-secret', secret
    ),
    body := jsonb_build_object(
      'notificationId', new.id,
      'userId', new.user_id,
      'kind', new.kind,
      'actorId', new.actor_id,
      'actorName', coalesce(actor_name, 'Someone'),
      'subjectId', new.subject_id,
      'count', unread_count,
      'preview', chosen_preview
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    insert into public.push_failures (notification_id, user_id, reason, kind, actor_id)
    values (new.id, new.user_id, left(sqlerrm, 500), new.kind, new.actor_id)
    on conflict (notification_id) do nothing;
    return new;
end;
$function$;
