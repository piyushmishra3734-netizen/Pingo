-- A story's trim, kept beside the file rather than burnt into it.
--
-- Trimming a video in a browser means re-encoding it, and re-encoding costs the
-- quality the uploader chose - PINGO uploads the file the camera wrote and
-- nothing on that path touches it. So the marks travel as data and the player
-- applies them: start here, end there, begin silent.
--
-- The same shape a chat message carries, except a message already had a `meta`
-- column to put it in and a story does not. Rather than invent a general `meta`
-- for one field, this is the field.
--
-- Nullable, and null means "play the whole thing" - which is what every story
-- written before this migration meant, and still means afterwards. No backfill.
--
-- Shape:
--   { "trimStart": 2.4, "trimEnd": 11.8, "muted": true }
--
-- Every key optional. A story nobody trimmed stores nothing at all rather than
-- a row of zeroes, so the absent case stays cheap and obviously absent.

alter table public.stories
  add column if not exists video_edit jsonb;

comment on column public.stories.video_edit is
  'Playback marks for a video story: trimStart / trimEnd in seconds, muted. Never applied to the stored file.';

/*
 * Only a video can carry one.
 *
 * A photo with trim marks is not a thing that can happen through the app, so
 * it is a thing that happened through a mistake - and a constraint is how a
 * mistake gets caught here rather than in a player that quietly ignores it.
 */
alter table public.stories
  drop constraint if exists stories_video_edit_only_on_video;

alter table public.stories
  add constraint stories_video_edit_only_on_video
  check (video_edit is null or kind = 'video');
