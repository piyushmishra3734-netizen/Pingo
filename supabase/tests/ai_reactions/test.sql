insert into conversations values ('c0000000-0000-0000-0000-000000000001','ai'),('c0000000-0000-0000-0000-000000000002','group');
insert into ai_profiles values ('11111111-1111-1111-1111-111111111111');
insert into messages (id, conversation_id, sender_id, body, created_at) values
 ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','thanks!', now()),
 ('a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','@pingoai birthday today', now() - interval '1 minute'),
 ('a0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','just chatting, no tag', now());
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
\echo 1 dm react
select ai_react('c0000000-0000-0000-0000-000000000001','🙏');
\echo 2 group: only the tagged message, not the newer untagged one
select ai_react('c0000000-0000-0000-0000-000000000002','🎉');
\echo 3 bad emoji refused
select ai_react('c0000000-0000-0000-0000-000000000001','💩');
\echo 4 second react does not change it
select ai_react('c0000000-0000-0000-0000-000000000001','🔥');
reset role;
select message_id, emoji from message_reactions order by emoji;
update ai_profiles set reactions_enabled = false;
delete from message_reactions;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
\echo 5 switched off
select ai_react('c0000000-0000-0000-0000-000000000001','🙏');
