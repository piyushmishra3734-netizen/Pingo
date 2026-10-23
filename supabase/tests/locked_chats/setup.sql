create schema if not exists auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.conversations (id uuid primary key, kind text);
create table public.conversation_members (conversation_id uuid, user_id uuid, deleted_at timestamptz);
create function public.is_conversation_member(conv uuid) returns boolean language sql security definer as $$ select exists (select 1 from public.conversation_members m where m.conversation_id = conv and m.user_id = auth.uid()) $$;
create function public.is_chat_notification(k text) returns boolean language sql as $$ select true $$;
create function public.push_allowed(u uuid, k text) returns boolean language sql as $$ select true $$;
create schema if not exists extensions; create schema if not exists vault; create schema if not exists net;
grant usage on schema public, auth to authenticated;
