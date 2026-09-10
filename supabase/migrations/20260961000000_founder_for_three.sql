-- FOUNDER for three more accounts, by id for the reason 20260943000000 gives:
-- a username can change hands, an id cannot.
--
-- Worn straight away only if the account has not already chosen a badge to
-- show - the same guard as the first grant, so no choice is overwritten.

insert into public.user_badges (user_id, badge_id, mission_id)
values
  ('063d24e9-d216-4362-889f-546cd2c9e169', 'founder', null),  -- shruti
  ('24e9223a-0321-4776-9bbf-5c72effe58f7', 'founder', null),  -- dravidian
  ('899a58d6-04c4-46b6-8722-9264d5652787', 'founder', null)   -- harshhh
on conflict (user_id, badge_id) do nothing;

update public.user_badges u
   set displayed = true
 where u.badge_id = 'founder'
   and u.user_id in (
     '063d24e9-d216-4362-889f-546cd2c9e169',
     '24e9223a-0321-4776-9bbf-5c72effe58f7',
     '899a58d6-04c4-46b6-8722-9264d5652787'
   )
   and not exists (
     select 1 from public.user_badges d
      where d.user_id = u.user_id and d.displayed
   );
