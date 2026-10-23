-- Locked chats: you can only lock a chat you are in, only as yourself, and only see your own locks.
\set ON_ERROR_STOP 0
insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');
insert into conversations values ('c0000000-0000-0000-0000-000000000001','direct'),('c0000000-0000-0000-0000-000000000002','direct');
insert into conversation_members values
 ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',null),
 ('c0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',null),
 ('c0000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',null);
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
\echo 1 lock a chat I am in: ok
insert into locked_chats (user_id, conversation_id) values ('11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001');
\echo 2 a chat I am not in: refused
insert into locked_chats (user_id, conversation_id) values ('11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000002');
\echo 3 as somebody else: refused
insert into locked_chats (user_id, conversation_id) values ('22222222-2222-2222-2222-222222222222','c0000000-0000-0000-0000-000000000001');
\echo 4 I see only mine (1 row)
select count(*) from locked_chats;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false) \gset
\echo 5 the other person sees none (0) and cannot unlock mine
select count(*) from locked_chats;
delete from locked_chats;
reset role;
\echo 6 still locked for me (1)
select count(*) from locked_chats;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
delete from locked_chats where conversation_id = 'c0000000-0000-0000-0000-000000000001';
reset role;
\echo 7 unlocked by me (0)
select count(*) from locked_chats;
