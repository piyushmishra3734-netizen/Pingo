-- One-time codes: which way each one goes (SMS or a call), and how many a
-- number has had, so a number gets at most 3 SMS and 2 calls in 12 hours.
--
-- A row is written twice over its life: first as the person's choice
-- (`sent_at` null), by `otp-quota` or `password-recovery`, just before the app
-- asks Auth for a code; then the `send-sms` hook, which Auth calls with the
-- code, reads the newest choice for the number, sends that way, and stamps it.
-- The hook is where the limit is enforced, so a client that skips the choice
-- still gets counted, as an SMS.
--
-- Nobody but the service role touches this table: RLS on, no policies.

create table if not exists public.otp_requests (
  id bigint generated always as identity primary key,
  phone text not null,
  channel text not null check (channel in ('sms', 'call')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists otp_requests_phone_created
  on public.otp_requests (phone, created_at desc);

alter table public.otp_requests enable row level security;
revoke all on public.otp_requests from anon, authenticated;

-- A day is plenty to answer "how many in the last 12 hours".
create or replace function public.otp_requests_prune()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.otp_requests where created_at < now() - interval '1 day';
$$;
revoke all on function public.otp_requests_prune() from public, anon, authenticated;
