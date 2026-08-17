-- `20260927000000` lowered the ceiling from thirty days to seven and stopped
-- there, which fixed nothing that already existed.
--
-- The ceiling is not read at collection time. `messages_stamp_media_expiry`
-- writes `now() + media_max_retention()` into the row on insert, so every
-- message already on the server carries the thirty-day date it was stamped
-- with. Changing the function moves the ceiling for messages nobody has sent
-- yet. 351 of the 374 live media rows were still due in mid-September.
--
-- So the stamps have to be rewritten too.

/*
 * Pull every stamp back to what the current ceiling would have produced.
 *
 * `greatest(..., now() + 24 hours)` is the same grace the legacy rows got: a
 * message from three weeks ago would otherwise be due the instant this runs,
 * and a recipient with the chat open should get a day to write its receipt and
 * keep its own copy first.
 *
 * Only ever earlier - the `where` makes this a reduction, so a row already
 * inside the new ceiling is left alone rather than pushed out to it.
 */
update public.messages
   set media_expires_at = greatest(
         created_at + public.media_max_retention(),
         now() + interval '24 hours'
       )
 where coalesce(photo_path, file_path, voice_path) is not null
   and media_purged_at is null
   and media_expires_at > greatest(
         created_at + public.media_max_retention(),
         now() + interval '24 hours'
       );
