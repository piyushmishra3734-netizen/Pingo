-- Authors must always be able to read their own stories (live and expired).
--
-- Post uses `insert(...).select().single()`. PostgREST applies the SELECT
-- policy to RETURNING rows. Live stories previously only passed through
-- `can_see_story(id)`, which works for authors in theory, but any failure in
-- that path turns a successful insert into "That did not post" after the
-- media was already uploaded (and then removed on error cleanup).
--
-- Own-row access is the correct product rule: you always see what you posted.

drop policy if exists "live stories are readable" on public.stories;
create policy "live stories are readable"
  on public.stories for select to authenticated
  using (
    author_id = auth.uid()
    or (expires_at > now() and public.can_see_story(id))
  );
