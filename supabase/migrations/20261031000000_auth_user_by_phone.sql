-- firebase-phone-login found the account on a number by paging through
-- auth.admin.listUsers, which fails outright ("Database error finding users")
-- on this project's auth.users. This answers the one question it needs, for
-- the service role only.
create or replace function public.auth_user_by_phone(p_phone text)
returns table (id uuid, email text, user_metadata jsonb)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, u.raw_user_meta_data
  from auth.users u
  where u.phone = p_phone and u.deleted_at is null
  order by u.created_at
  limit 1;
$$;
revoke all on function public.auth_user_by_phone(text) from public, anon, authenticated;
grant execute on function public.auth_user_by_phone(text) to service_role;
