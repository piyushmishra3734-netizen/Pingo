\set ON_ERROR_STOP 0
insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333');
insert into conversations (id, kind) values ('aaaaaaaa-0000-0000-0000-000000000001','direct'),('aaaaaaaa-0000-0000-0000-000000000002','direct'),('aaaaaaaa-0000-0000-0000-000000000003','ai'),('aaaaaaaa-0000-0000-0000-000000000004','community');
insert into conversation_members values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',null),('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',null),
 ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',null),('aaaaaaaa-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333',null),
 ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',null),('aaaaaaaa-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',null);
insert into blocks values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111');

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

\echo --- 1 off by default: propose must fail
select master_propose('send_message','{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000001","text":"hi"}');
\echo --- 2 turn on
select master_configure(true,true,true);
\echo --- 3 ai chat and community refused
select master_propose('send_message','{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000003","text":"hi"}');
select master_propose('send_message','{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000004","text":"hi"}');
\echo --- 4 blocked person refused
select master_propose('send_message','{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000002","text":"hi"}');
\echo --- 5 a chat I am not in refused (user 2 has no chat 2 membership)
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select master_configure(true,true,true);
select master_propose('send_message','{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000002","text":"hi"}');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
\echo --- 6 bad setting refused, good accepted
select master_propose('set_setting','{"key":"readReceipts","value":"false"}');
select master_propose('set_setting','{"key":"theme","value":"neon"}');
select (master_propose('set_setting','{"key":"theme","value":"dark"}')).status;
\echo --- 7 propose message for later, nothing sent yet
select (master_propose('send_message','{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000001","text":"happy birthday!"}', now() + interval '1 hour')).status;
reset role;
select count(*) as messages_before from messages;
select id as mid from ai_actions where kind='send_message' \gset
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
\echo --- 8 another user cannot approve mine
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select master_approve(:'mid');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
\echo --- 9 approve schedules and takes 5 credits
select (master_approve(:'mid')).status;
select credits_left from ai_allowance();
\echo --- 10 cancel refunds
select master_cancel(:'mid');
select credits_left from ai_allowance();
select status from ai_actions where id = :'mid';
\echo --- 11 approve twice refused
select master_approve(:'mid');
reset role;
\echo --- 12 due task sent by the clock, tagged
insert into ai_actions (user_id, kind, params, params_hash, status, run_at, credits_taken)
select '11111111-1111-1111-1111-111111111111','send_message', p, md5('send_message'||(now() - interval '1 minute')::text||p::text),'scheduled', now() - interval '1 minute', false
from (select '{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000001","text":"on time"}'::jsonb p) x;
select master_tick();
select body, meta, sender_id from messages;
\echo --- 13 tampered row is refused at run time
insert into ai_actions (user_id, kind, params, params_hash, status, run_at)
values ('11111111-1111-1111-1111-111111111111','send_message','{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000001","text":"evil"}','bogus','scheduled', now() - interval '1 minute');
select master_tick();
select result from ai_actions where params->>'text'='evil';
\echo --- 14 kill switch cancels scheduled and refunds
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select id as mid2 from ai_actions limit 0;
select (master_propose('send_message','{"conversation_id":"aaaaaaaa-0000-0000-0000-000000000001","text":"later"}', now() + interval '2 hours')).id as p2 \gset
select (master_approve(:'p2')).status;
select credits_left from ai_allowance();
select master_configure(false,true,true);
select credits_left from ai_allowance();
select status from ai_actions where id = :'p2';
\echo --- 15 users cannot write tables directly
insert into ai_actions (user_id, kind, params, params_hash) values ('11111111-1111-1111-1111-111111111111','send_message','{}','x');
update ai_master_settings set enabled = true;
select master_run(:'p2');
select master_check('11111111-1111-1111-1111-111111111111','set_setting','{}');
reset role;
update ai_master_settings set enabled = true where user_id = '11111111-1111-1111-1111-111111111111';
update conversations set title = 'Family' , kind='group' where id='aaaaaaaa-0000-0000-0000-000000000004';
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
\echo --- 16 find chat
select * from master_find_chat('rohit');
select * from master_find_chat('fam');
select * from master_find_chat('zzz');
