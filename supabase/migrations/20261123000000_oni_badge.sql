-- ONI, the third badge (the red oni crest), for luffy and greg - by id,
-- for the reason 20260943000000 gives: a username can change hands, an id cannot.
--
-- Worn straight away only if the account has not already chosen a badge to
-- show, the same guard as the FOUNDER grants, so no choice is overwritten.

insert into public.user_badges (user_id, badge_id, mission_id)
values
  ('8106f7fa-9b1c-42dc-9366-538fdefe1c90', 'oni', null),  -- luffy
  ('39f8d9ce-f76c-4a99-a04c-e25147988e8d', 'oni', null)   -- greg
on conflict (user_id, badge_id) do nothing;

update public.user_badges u
   set displayed = true
 where u.badge_id = 'oni'
   and u.user_id in (
     '8106f7fa-9b1c-42dc-9366-538fdefe1c90',
     '39f8d9ce-f76c-4a99-a04c-e25147988e8d'
   )
   and not exists (
     select 1 from public.user_badges d
      where d.user_id = u.user_id and d.displayed
   );
