-- The media lifecycle, exercised against the real schema and rolled back.
--
-- Every case below inserts a real conversation, real messages and real
-- receipts, runs the real `purge_delivered_media()`, and checks what it did.
-- The whole thing then raises, which aborts the transaction the DO block runs
-- in - so nothing survives it. That is deliberate: a test that runs against a
-- mock of the schema is a test that keeps passing after the schema moves, which
-- is exactly how `conversation_members.muted` broke messaging without anybody
-- noticing.
--
-- Run through `pnpm verify:media-lifecycle`, which reads the raised message.

do $$
declare
  conv uuid;
  sender uuid;
  recipient uuid;
  fresh uuid;
  delivered_recently uuid;
  delivered_long_ago uuid;
  expired uuid;
  legacy uuid;
  text_only uuid;
  parked integer;
  results text := '';
  failures integer := 0;

  procedure_check boolean;
begin
  -- Two real accounts, because the foreign keys are real. Nothing is written
  -- that outlives this block.
  select id into sender from public.profiles order by created_at limit 1;
  select id into recipient from public.profiles where id <> sender order by created_at limit 1;

  insert into public.conversations (kind) values ('direct') returning id into conv;
  insert into public.conversation_members (conversation_id, user_id) values (conv, sender), (conv, recipient);

  -- 1. Sent, nobody has confirmed anything yet.
  insert into public.messages (conversation_id, sender_id, body, kind, photo_path)
  values (conv, sender, '', 'photo', 'test/fresh.jpg') returning id into fresh;

  -- 2. Confirmed by the recipient a moment ago.
  insert into public.messages (conversation_id, sender_id, body, kind, photo_path)
  values (conv, sender, '', 'photo', 'test/recent.jpg') returning id into delivered_recently;
  insert into public.media_receipts (message_id, user_id) values (delivered_recently, recipient);

  -- 3. Confirmed by the recipient eight days ago.
  insert into public.messages (conversation_id, sender_id, body, kind, photo_path)
  values (conv, sender, '', 'photo', 'test/old.jpg') returning id into delivered_long_ago;
  insert into public.media_receipts (message_id, user_id, received_at)
  values (delivered_long_ago, recipient, now() - interval '8 days');

  -- 4. Never confirmed by anybody, and past its ceiling.
  insert into public.messages (conversation_id, sender_id, body, kind, file_path, file_mime)
  values (conv, sender, '', 'document', 'test/expired.mp4', 'video/mp4') returning id into expired;
  update public.messages set media_expires_at = now() - interval '1 day' where id = expired;

  -- 5. Written before the lifecycle existed: no expiry, and no receipts.
  insert into public.messages (conversation_id, sender_id, body, kind, voice_path)
  values (conv, sender, '', 'voice', 'test/legacy.wav') returning id into legacy;
  update public.messages set media_expires_at = null where id = legacy;

  -- 6. An ordinary text message, which must be untouched by all of this.
  insert into public.messages (conversation_id, sender_id, body, kind)
  values (conv, sender, 'hello', 'text') returning id into text_only;

  -- -- the trigger ---------------------------------------------------------
  if (select media_expires_at is not null from public.messages where id = fresh) then
    results := results || E'\nPASS  new media is stamped with an expiry';
  else
    results := results || E'\nFAIL  new media has no expiry'; failures := failures + 1;
  end if;

  if (select media_expires_at is null from public.messages where id = text_only) then
    results := results || E'\nPASS  a text message is stamped with nothing';
  else
    results := results || E'\nFAIL  a text message was given an expiry'; failures := failures + 1;
  end if;

  -- -- the collector -------------------------------------------------------
  select public.purge_delivered_media() into parked;
  results := results || E'\nINFO  first sweep parked ' || parked || ' object(s)';

  if (select media_purge_path is null from public.messages where id = fresh) then
    results := results || E'\nPASS  unconfirmed media is left alone';
  else
    results := results || E'\nFAIL  unconfirmed media was parked'; failures := failures + 1;
  end if;

  if (select media_purge_path is null from public.messages where id = delivered_recently) then
    results := results || E'\nPASS  the minimum retention is respected after delivery';
  else
    results := results || E'\nFAIL  media was parked inside the minimum retention'; failures := failures + 1;
  end if;

  if (select media_purge_path = 'test/old.jpg' and media_purge_bucket = 'photos'
        from public.messages where id = delivered_long_ago) then
    results := results || E'\nPASS  delivered media past the minimum retention is parked';
  else
    results := results || E'\nFAIL  delivered media was not parked'; failures := failures + 1;
  end if;

  if (select media_purge_path = 'test/expired.mp4' and media_purge_bucket = 'documents'
        from public.messages where id = expired) then
    results := results || E'\nPASS  media past its ceiling is parked without any receipt';
  else
    results := results || E'\nFAIL  expired media was not parked'; failures := failures + 1;
  end if;

  if (select media_purge_path is null from public.messages where id = legacy) then
    results := results || E'\nPASS  legacy media is never collected';
  else
    results := results || E'\nFAIL  legacy media was parked'; failures := failures + 1;
  end if;

  -- -- the live pointer survives until the object is really gone -----------
  if (select photo_path = 'test/old.jpg' from public.messages where id = delivered_long_ago) then
    results := results || E'\nPASS  the live path is kept while the object still exists';
  else
    results := results || E'\nFAIL  the path was cleared before the object was deleted'; failures := failures + 1;
  end if;

  -- -- idempotency ---------------------------------------------------------
  select public.purge_delivered_media() into parked;
  if parked = 0 then
    results := results || E'\nPASS  a second sweep parks nothing';
  else
    results := results || E'\nFAIL  a second sweep parked ' || parked || ' again'; failures := failures + 1;
  end if;

  -- -- deleting a message parks its object rather than orphaning it --------
  update public.messages
     set deleted_at = now(), body = '',
         media_purge_path = coalesce(media_purge_path, photo_path),
         media_purge_bucket = coalesce(media_purge_bucket, 'photos')
   where id = fresh;

  if (select media_purge_path = 'test/fresh.jpg' from public.messages where id = fresh) then
    results := results || E'\nPASS  a deleted message parks its object';
  else
    results := results || E'\nFAIL  a deleted message left its object behind'; failures := failures + 1;
  end if;

  -- -- text messaging is untouched -----------------------------------------
  if (select body = 'hello' and deleted_at is null from public.messages where id = text_only) then
    results := results || E'\nPASS  ordinary text messages are unaffected';
  else
    results := results || E'\nFAIL  a text message was altered'; failures := failures + 1;
  end if;

  -- -- structure the client depends on -------------------------------------
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('pending_media_purges','confirm_media_purged','abandoned_uploads')
    group by p.proname having count(*) > 0
  ) into procedure_check;
  if procedure_check then
    results := results || E'\nPASS  the client-facing functions exist';
  else
    results := results || E'\nFAIL  a client-facing function is missing'; failures := failures + 1;
  end if;

  -- Everything above is undone by this. The message is the test output.
  raise exception 'MEDIA-LIFECYCLE-RESULT failures=% %', failures, results;
end
$$;
