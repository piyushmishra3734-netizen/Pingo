-- The trigger carries the notification id.
--
-- One field, and the architecture is untouched: same trigger, same funnel, same
-- fire-and-forget call. But `push-send` now writes a delivery ledger keyed on
-- the notification, and it cannot do that without being told which notification
-- it is sending. Without this the trigger's own send would be invisible to the
-- idempotency check, and the first retry would deliver a second copy.

create or replace function public.on_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
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
$$;
