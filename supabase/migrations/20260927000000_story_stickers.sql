-- Stickers on a story, as data rather than pixels.
--
-- Until now the editor flattened everything onto the picture: text, emoji and
-- drawings were baked into the file. That is fine for decoration and useless
-- for anything a viewer should be able to use - a poll nobody can vote on is a
-- picture of a poll. So stickers are now stored next to the media and drawn
-- live over it, which is what makes the interactive ones interactive.
--
-- `decor` shape (the client owns it; the database only bounds its size):
--   { "v": 1,
--     "filter": "<css filter>",            -- a video's look (photos bake it in)
--     "bg": "<css background>",            -- behind a shared post
--     "stickers": [ { "id": "k3x9", "type": "poll", "x": .5, "y": .6,
--                     "s": 1, "r": -4, "style": 0, "d": { ... } } ] }
--
-- Null means a story without stickers: every story written before this, and
-- plenty after. No backfill.

alter table public.stories
  add column if not exists decor jsonb;

alter table public.stories drop constraint if exists stories_decor_size;
alter table public.stories
  add constraint stories_decor_size
  check (decor is null or pg_column_size(decor) <= 65536);

comment on column public.stories.decor is
  'Stickers drawn over the media, plus a video''s filter: {v, filter, bg, stickers:[{id,type,x,y,s,r,style,d}]}.';

-- What viewers did with the interactive stickers: a vote, a quiz pick, a slider
-- position, an answer to a question, a reminder.
--
--   poll / quiz   { "choice": 1 }
--   slider        { "slide": 0.82 }
--   question      { "text": "where to?" }
--   countdown     { "remind": true }
--
-- One answer per person per sticker, and final, as on Instagram: there is no
-- update or delete policy.
create table if not exists public.story_sticker_answers (
  story_id uuid not null references public.stories (id) on delete cascade,
  sticker_id text not null check (char_length(sticker_id) between 1 and 40),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  value jsonb not null check (pg_column_size(value) <= 2048),
  created_at timestamptz not null default now(),
  primary key (story_id, sticker_id, user_id)
);

alter table public.story_sticker_answers enable row level security;
revoke all on public.story_sticker_answers from anon;

-- The answerer sees their own; the author sees everyone's (that is the point of
-- asking). Nobody else sees who answered what.
drop policy if exists "sticker answers are readable by answerer and author" on public.story_sticker_answers;
create policy "sticker answers are readable by answerer and author"
  on public.story_sticker_answers for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_sticker_answers.story_id and s.author_id = auth.uid()
    )
  );

drop policy if exists "answer a story you can see, as yourself" on public.story_sticker_answers;
create policy "answer a story you can see, as yourself"
  on public.story_sticker_answers for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_story(story_id));

create index if not exists story_sticker_answers_story on public.story_sticker_answers (story_id);

/*
 * The results a viewer is shown after answering: how many picked each option,
 * and the average slider position. Counts only - never who, and never the text
 * of an answer.
 *
 * `security definer` because the table's own policy hides other people's rows,
 * and a percentage is made of other people's rows. The audience check is the
 * same one the story itself is read through.
 */
create or replace function public.story_sticker_results(target uuid)
returns table (sticker_id text, choice int, votes bigint, average double precision)
language sql
stable
security definer
set search_path = public
as $$
  select a.sticker_id,
         (a.value ->> 'choice')::int,
         count(*),
         avg((a.value ->> 'slide')::double precision)
  from public.story_sticker_answers a
  where a.story_id = target
    and public.can_see_story(target)
    and (a.value ? 'choice' or a.value ? 'slide')
  group by a.sticker_id, (a.value ->> 'choice')::int;
$$;

revoke all on function public.story_sticker_results(uuid) from public, anon;
grant execute on function public.story_sticker_results(uuid) to authenticated;
