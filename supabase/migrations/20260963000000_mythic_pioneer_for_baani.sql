-- MYTHIC PIONEER for baani, by id: a username can change hands, an id cannot.
--
-- Written exactly as the mission writes it for somebody who earns it -
-- mission_id set, not displayed - so the mission screen reads it as unlocked
-- and the lead-badge rule shows it beside her name the way it does for every
-- other holder.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as
-- `mythic_pioneer_for_baani`.

insert into public.user_badges (user_id, badge_id, mission_id)
values ('401a4049-1776-44e1-b44e-723ce2382ca2', 'mythic_pioneer', 'mythic_pioneer')  -- baani
on conflict (user_id, badge_id) do nothing;
