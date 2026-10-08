# pingo-saavn

PINGO Music's catalogue: everything JioSaavn has, in one small API. The routes
are listed at the top of `src/index.ts`; the shapes are in `src/normalize.ts`
(mirrored for the app in `apps/web/src/features/music/saavn/types.ts`).

It is the one music backend the app uses: the PINGO Music screen, and the
song pickers in chat, stories, the camera and profile (`catalogue.tsx`). The
old `pingo-music` Worker (`workers/music`) is no longer called by the app;
songs already shared in chats still play, since their links point straight at
JioSaavn's own audio.

## Downloads (offline)

Downloads do not go through this Worker. The app fetches the audio straight
from JioSaavn's CDN (`aac.saavncdn.com` allows any origin) and keeps it in its
own IndexedDB database, `pingo-music` (`apps/web/src/features/music/saavn/downloads.ts`).
Nothing is stored on Cloudflare or Supabase, so downloads cost nothing here.
Opened with no internet and songs on the phone, the app shows the downloads
page first (`OfflineMusic.tsx`).

## How it reaches JioSaavn

Straight to JioSaavn's own `api.php`, through the `saavn-proxy` Edge Function
pinned to Mumbai (`workers/music/README.md` says why). Stream addresses come
from `encrypted_media_url`, decrypted in `src/des.ts` (checked by
`pnpm verify:music` against an address the old Worker produced).

Languages: JioSaavn reads them from a cookie, so the Worker sends
`x-saavn-lang` and the proxy turns it into that cookie. Until the proxy with
that change is deployed, `/home`, `/new` and `/featured` answer in the default
language mix; `/trending?lang=` works either way.

## Radio that keeps the sound

JioSaavn's radio follows language and label more than sound: a small label's
gym phonk got no station, or a Hindi-tagged one got the day's Bollywood hits.
`/songs/:id/radio` now reads the seeds' sound from their names (`src/sound.ts`:
phonk, lofi, slowed, bhajan...) and seeds the station with one or two
well-played songs of that sound as well, which keeps JioSaavn's own station in
it, refills included. A singer with no JioSaavn station gets that radio built
from their own songs (`/stations/artist`). Film songs and anything else with no
sound in its name get JioSaavn's radio unchanged.

## Deploy (from the PC)

```sh
# 1. the proxy, with the language cookie
npx supabase functions deploy saavn-proxy --project-ref gpijpmepzowwhvgkriqu --use-api --no-verify-jwt

# 2. the Worker
cd workers/saavn && npx wrangler deploy
curl https://pingo-saavn.dubesminecraft.workers.dev/search?q=kesriya   # must find Kesariya

# 3. the library tables (liked songs, plays, follows, playlists)
# already applied on 2026-10-07 (Supabase MCP, version 20261007100655); nothing to run
```

If the Worker comes up at a different address, set `VITE_SAAVN_URL` to it in
the Cloudflare Pages build env.

## Test locally

`pnpm verify:music` covers the DES, the normaliser, the queue and taste with
no network. To hit JioSaavn for real, bundle `src/index.ts` with esbuild and
call its `fetch` from Node (it needs no bindings).
