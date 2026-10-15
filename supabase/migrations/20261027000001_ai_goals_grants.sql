-- ai_goals had its RLS policies but no table grant, and this project gives new
-- tables none by default: every goal PINGO AI tried to save was refused. The
-- policies still keep each person to their own rows.
grant select, insert, update, delete on public.ai_goals to authenticated;
