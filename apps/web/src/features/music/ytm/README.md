# PINGO Music — the YouTube Music path

Read this before changing anything under `features/music/ytm/`.

## What is here

| File | Role |
|---|---|
| `innertube.ts` | InnerTube client: shelves (search, home, up next) as `WEB_REMIX`; audio addresses as `ANDROID_VR` |
| `pot.ts` | BotGuard attestation — mints a PO token so a challenged track still plays |
| `source.ts` | Which catalogue Music uses (JioSaavn or YouTube Music), and the pause after repeated failures |
| `diagnose.ts` | The self-check the settings row runs |
| `page.ts` | Page-shaped helpers |

The rest of the feature (`api.ts`, `player.ts`, sheets) is catalogue-agnostic and should stay
that way: YouTube is a second source, not a second app.

## The one thing that keeps breaking

YouTube answers some tracks with `LOGIN_REQUIRED` — *"Sign in to confirm you're not a bot"*.

**Measured, not assumed.** The same video:

| Client | Track A | Track B |
|---|---|---|
| `ANDROID_VR` | plays (26 urls) | `LOGIN_REQUIRED` |
| `TVHTML5` | — | `LOGIN_REQUIRED`, same wording |

So it follows the **requesting address**, not the client. Swapping clients to dodge it does
nothing — that was tried and the code comment in `innertube.ts` records the measurement so
nobody spends another afternoon on it.

## What `pot.ts` does

The same flow Flow and PipePipe ship (their credits name *BotGuard / PoToken attestation*),
in TypeScript:

1. ask Google's Web Anti-Abuse API for a challenge — through `CapacitorHttp`, because a
   browser tab is refused by CORS and the app is not
2. run the challenge's interpreter in the WebView, take a snapshot
3. mint a PO token bound to the visitor id
4. retry the player with `serviceIntegrityDimensions.poToken`

Proven in a real Chromium before it was written here: challenge → snapshot → **1200-char
token**. The step that costs an afternoon if you do not know it: BotGuard returns its
integrity token as `$` + base64url, and the minter wants plain base64 (see `asBase64`).

## Invariants

- **Nothing here is load-bearing.** No token, no attestation, a changed challenge — every
  failure returns `null` and the song falls back to JioSaavn. A worse picture is acceptable;
  a broken screen is not.
- **Native only.** `poTokenSupported()` is false in a browser, because the network steps
  cannot pass CORS there. Do not "fix" that by moving the call into a browser path.
- **Token per visitor, cached 4h**, shared through `inFlight` — ten songs in a queue must
  run BotGuard once, not ten times.
- **A slow source is not a dead one.** The same rule as the TV player: a timeout is not
  evidence of failure.

## Testing on a device

```bash
cd apps/web
pnpm build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Then, on the phone: Music → source *YouTube Music* → play a track that was challenged.
First play costs 2–3s (attestation); after that it is instant for four hours.

If it still fails, the three suspects are, in order: the WebView refusing `new Function`
(the interpreter has to run), the WAA `requestKey` having rotated, and a visitor id that
does not match between mint and player.

## Risks worth stating plainly

- This is YouTube's platform, used outside its terms — the same category as the rest of
  PINGO TV's sources. It can break without notice, and accounts or addresses that look
  automated can be limited.
- BotGuard is deliberately obfuscated and changes. Treat `pot.ts` as a best-effort layer
  with a fallback, never as the thing playback depends on.
- `bgutils-js` is dynamically imported so the web bundle does not carry it. Keep it that way.
