# pingo-music

The song catalogue the app reads (`MUSIC` in `apps/web/src/features/music/sheets.tsx`):
the unofficial JioSaavn API, [sumitkolhe/jiosaavn-api](https://github.com/sumitkolhe/jiosaavn-api)
at commit `fc6bd13`, deployed as the Worker `pingo-music` with one change (`upstream.patch`).

## Why the patch

JioSaavn answers by the caller's country. Cloudflare's outgoing addresses are not
Indian, so the Worker was served a thin international catalogue: "fairytail" found
10 instrumentals where the JioSaavn app finds 358 songs. The patch sends every
JioSaavn call through the `saavn-proxy` Edge Function
(`supabase/functions/saavn-proxy`) with `x-region: ap-south-1`, so it is asked
from Mumbai. Measured 2026-10-07: ap-south-1 -> 358, ap-southeast-1 / us-east-1 -> 10.
A Workers placement hint (`aws:ap-south-1`) did not help - the addresses still are
not Indian.

## Redeploy

```sh
git clone https://github.com/sumitkolhe/jiosaavn-api && cd jiosaavn-api
git checkout fc6bd13 && git apply ../upstream.patch && cp ../wrangler.toml .
npm install && npx wrangler deploy
```

`saavn-proxy`: `npx supabase functions deploy saavn-proxy --project-ref gpijpmepzowwhvgkriqu --use-api --no-verify-jwt`
