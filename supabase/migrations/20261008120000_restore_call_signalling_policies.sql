-- Calls stopped connecting: realtime.messages had RLS on and no policies at
-- all, so every private `call:<user>` channel was refused - no ring, no offer,
-- no answer. The two policies from 20260726140000_call_signalling.sql (the
-- insert one as 20260813000000_privacy_enforced.sql left it) are put back as
-- they were.

drop policy if exists "receive on own call topic" on realtime.messages;
create policy "receive on own call topic"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() = 'call:' || auth.uid()::text
    and realtime.messages.extension = 'broadcast'
  );

drop policy if exists "send to any call topic" on realtime.messages;
create policy "send to any call topic"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'call:%'
    and realtime.messages.extension = 'broadcast'
    and public.may_call(
      auth.uid(),
      nullif(split_part(realtime.topic(), ':', 2), '')::uuid
    )
  );
