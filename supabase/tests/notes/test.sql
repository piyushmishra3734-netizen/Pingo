\set ON_ERROR_STOP 0
insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333');
insert into profiles values ('11111111-1111-1111-1111-111111111111','ann','Ann',null),('22222222-2222-2222-2222-222222222222','bob','Bob',null),('33333333-3333-3333-3333-333333333333','cy','Cy',null);
-- ann and bob follow each other; cy follows nobody
insert into follows values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','accepted'),('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','accepted');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
\echo 1 set a note with a song: ok
select note_set('hello', '{"name":"x","artist":"y","img":"","url":"u","secs":10}', 'friends');
\echo 2 101 chars refused, 100 is fine
select note_set(repeat('a',101), null, 'friends');
select note_set(repeat('a',100), null, 'friends');
select note_set(repeat('😀',100), null, 'friends');
echo 2b an unknown background is refused, a known one is kept
select note_set('x', null, 'friends', 'neon');
select note_set('x', null, 'friends', 'rose');
select bg from notes;
\echo 3 empty note and no song refused
select note_set('   ', null, 'friends');
\echo 4 song only is fine
select note_set('', '{"name":"x"}', 'friends');
\echo 5 writing again replaces (1 row)
select note_set('second', null, 'friends');
select count(*) from notes;
\echo 6 direct insert refused
insert into notes (user_id, body) values ('11111111-1111-1111-1111-111111111111','x');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false) \gset
\echo 7 bob (mutual) sees ann note: second
select body from notes_feed();
\echo 8 bob cannot read the table directly (0)
select count(*) from notes;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false) \gset
\echo 9 cy (not mutual) sees none (0)
select count(*) from notes_feed();
reset role;
insert into close_friends values ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
select note_set('close one', null, 'close');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false) \gset
\echo 10 bob is not close: none (0)
select count(*) from notes_feed();
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false) \gset
\echo 11 cy is close friend: sees it (1)
select body from notes_feed();
reset role;
update notes set expires_at = now() - interval '1 minute';
set role authenticated;
\echo 12 expired not listed (0)
select count(*) from notes_feed();
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
select note_clear();
reset role;
\echo 13 cleared (0)
select count(*) from notes;
\echo 14 anon cannot call
set role anon;
select note_set('x', null);
