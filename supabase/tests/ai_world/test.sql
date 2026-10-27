\set ON_ERROR_STOP 0
insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333'),('44444444-4444-4444-4444-444444444444'),('55555555-5555-5555-5555-555555555555');
insert into profiles (id,username,display_name,bio,work,location,is_private) values
 ('11111111-1111-1111-1111-111111111111','me','Me','my bio',null,null,false),
 ('22222222-2222-2222-2222-222222222222','baani','Baani','chai lover','Designer','Delhi',false),
 ('33333333-3333-3333-3333-333333333333','rohit','Rohit','gym','Dev','Pune',true),
 ('44444444-4444-4444-4444-444444444444','eddy','Eddy','x',null,null,false),
 ('55555555-5555-5555-5555-555555555555','outsider','Out Sider','y',null,null,false);
-- me<->baani friends; me follows rohit (private, accepted one way); eddy follows me; outsider blocked by me
insert into follows values
 ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','accepted'),
 ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','accepted'),
 ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','accepted'),
 ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','accepted'),
 ('11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','accepted');
insert into blocks values ('11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555');
insert into posts (author_id, caption) values ('22222222-2222-2222-2222-222222222222','baani post'),('33333333-3333-3333-3333-333333333333','rohit private post'),('44444444-4444-4444-4444-444444444444','eddy post'),('11111111-1111-1111-1111-111111111111','my post');
insert into conversations (id,kind,title,description) values ('c0000000-0000-0000-0000-000000000001','group','College','batch 24'),('c0000000-0000-0000-0000-000000000002','group','Secret','not mine'),('c0000000-0000-0000-0000-000000000003','direct',null,null);
insert into conversation_members (conversation_id,user_id,role) values
 ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','member'),
 ('c0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','admin'),
 ('c0000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444','member'),
 ('c0000000-0000-0000-0000-000000000002','44444444-4444-4444-4444-444444444444','admin'),
 ('c0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','member');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
\echo 1 people: baani friend, rohit following, eddy follower; outsider (blocked) absent
select username, relation from ai_people();
\echo 2 search "ba": only baani
select username from ai_people('ba');
\echo 3 a % in a search is just a character: none
select username from ai_people('%');
\echo 4 person baani: friend, Designer, Delhi
select username, work, location, relation from ai_person('@Baani');
\echo 5 blocked person: nothing
select * from ai_person('outsider');
\echo 6 my posts
select author, caption from ai_posts();
\echo 7 baani posts visible
select author, caption from ai_posts('baani');
\echo 8 rohit private account: I follow him, so allowed (1)
select author, caption from ai_posts('rohit');
\echo 9 groups: only College (not Secret, not direct), 3 members, my role member
select title, members, my_role from ai_groups();
\echo 10 group members of College: baani admin first
select username, role from ai_group_members('c0000000-0000-0000-0000-000000000001');
\echo 11 members of a group I am not in: none
select * from ai_group_members('c0000000-0000-0000-0000-000000000002');
\echo 12 as eddy: rohit private post NOT visible (eddy does not follow rohit)
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false) \gset
select author, caption from ai_posts('rohit');
\echo 13 anon cannot call
reset role; set role anon;
select * from ai_people();
