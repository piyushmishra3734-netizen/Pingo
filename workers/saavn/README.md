# pingo-saavn

PINGO Music's catalogue: everything JioSaavn has, in one small API. The routes
are listed at the top of `src/index.ts`; the shapes are in `src/normalize.ts`
(mirrored for the app in `apps/web/src/features/music/saavn/types.ts`).

It replaces nothing yet. The old `pingo-music` Worker (`workers/music`) keeps
serving the pickers in chat, stories and profile; this one is the backend for
the PINGO Music screen, and has what the old one never had: home, charts,
trending, new releases, editorial playlists, moods and genres, radio stations
that never run dry, lyrics, top searches, full artist pages, link resolving.

## How it reaches JioSaavn

Straight to JioSaavn's own `api.php`, through the `saavn-proxy` Edge Function
pinned to Mumbai (`workers/music/README.md` says why). Stream addresses come
from `encrypted_media_url`, decrypted in `src/des.ts` (checked by
`pnpm verify:music` against an address the old Worker produced).

Languages: JioSaavn reads them from a cookie, so the Worker sends
`x-saavn-lang` and the proxy turns it into that cookie. Until the proxy with
that change is deployed, `/home`, `/new` and `/featured` answer in the default
language mix; `/trending?lang=` works either way.

## Deploy (from the PC)

```sh
# 1. the proxy, with the language cookie
npx supabase functions deploy saavn-proxy --project-ref gpijpmepzowwhvgkriqu --use-api --no-verify-jwt

# 2. the Worker
cd workers/saavn && npx wrangler deploy
curl https://pingo-saavn.dubesminecraft.workers.dev/search?q=kesriya   # must find Kesariya

# 3. the library tables (liked songs, plays, follows, playlists)
npx supabase db push     # applies 20261023000000_music_library.sql
```

If the Worker comes up at a different address, set `VITE_SAAVN_URL` to it in
the Cloudflare Pages build env.

## Test locally

`pnpm verify:music` covers the DES, the normaliser, the queue and taste with
no network. To hit JioSaavn for real, bundle `src/index.ts` with esbuild and
call its `fetch` from Node (it needs no bindings).
