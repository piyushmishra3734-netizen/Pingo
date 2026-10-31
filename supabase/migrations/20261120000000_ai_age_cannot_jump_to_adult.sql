-- An AI age under 18 cannot be changed to 18 or over by its owner.
--
-- Spicy is explicit for adults, and the only age it has is the one people give
-- PINGO AI. Since the age can be changed in settings, somebody who said 15 could
-- say 19 a minute later and open it. So the age can always go down, and can be
-- set to anything the first time, but once it is under 18 only the operator can
-- raise it - a support request, for the rare person who mis-tapped.

create or replace function public.ai_profiles_age_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and old.age is not null and old.age < 18
     and new.age is not null and new.age >= 18
     and new.age is distinct from old.age
     and not public.is_operator() then
    raise exception 'Your age was set under 18, so it cannot be changed to 18 or over here. Contact PINGO support if it was a mistake.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_profiles_age_guard on public.ai_profiles;
create trigger ai_profiles_age_guard
before update of age on public.ai_profiles
for each row execute function public.ai_profiles_age_guard();
