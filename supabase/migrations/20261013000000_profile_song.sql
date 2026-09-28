-- PINGO: a song on your profile, Telegram's way.
--
-- Picked in Edit Profile from the same catalogue as chat and stories, and shown
-- on the profile as a card anybody looking at it can play. Public like the bio.
--
-- Stored as the few fields the card draws (name, artist, cover, audio address,
-- length), not as an id to look up, so showing a profile asks the music
-- service nothing. Kept small and object-shaped by the check, so the column
-- cannot become a place to park anything else.

alter table public.profiles
  add column if not exists song jsonb;

alter table public.profiles drop constraint if exists profiles_song_shape;
alter table public.profiles
  add constraint profiles_song_shape check (
    song is null
    or (jsonb_typeof(song) = 'object' and octet_length(song::text) <= 2048)
  );

-- Added to the column grant, like work and location in 20261009000000.
grant update (song) on public.profiles to authenticated;
