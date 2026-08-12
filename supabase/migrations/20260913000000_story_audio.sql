-- Sound laid on a story, as pieces rather than as one soundtrack.
--
-- A story could carry a clip's own audio and nothing else: a photo was silent
-- by definition, and a video could only ever sound like the room it was shot
-- in. This is the column that lets somebody put a piece of music, a recording
-- of their own voice, or the sound lifted out of another clip onto either kind.
--
-- Pieces, because that is what people do with sound: one thing under the first
-- few seconds, another after it, and a gap where the clip should speak for
-- itself. A single file with a start offset cannot say that, and a timeline
-- with one track per piece can.
--
-- Shape:
--   [ { "path": "<uid>/<uuid>.wav", "at": 0, "duration": 7.4, "volume": 0.8 } ]
--
-- `path` is in the same private story bucket as the media and is signed on
-- read, exactly like `media_path`. `at` is seconds from the start of the story.
-- Each piece is uploaded already cut to length, so there are no trim marks
-- here: the file *is* the piece. That is the opposite of `video_edit`, and for
-- a reason - cutting audio is a few hundred kilobytes of arithmetic in a
-- worker, while cutting video is a re-encode that costs the picture.
--
-- Null means a story with no added sound, which is every story written before
-- this migration and most of them after it. No backfill.

alter table public.stories
  add column if not exists audio jsonb;

comment on column public.stories.audio is
  'Pieces of sound laid on the story: [{path, at, duration, volume}]. Paths live in the private story bucket and are signed on read.';
