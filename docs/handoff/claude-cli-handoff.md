# PINGO handoff for the Claude CLI

Read this first. It says what was built in the cloud sessions up to 29 Sep 2026, what is live on `main`, what is still only on a branch, and the jobs that only the PC can do: Supabase, Cloudflare, the Android APK.

Repo: `piyushmishra3734-netizen/Pingo`. Work from `main` (`git checkout main && git pull`).

## How the owner works

- Reply in Hinglish.
- Icons come from Lucide only (`lucide-react`, or the Lucide-backed icons in `@pingo/ui`).
- No em dashes in any copy the user sees.
- Check every UI change in a browser before calling it done. Demo mode is `?demo`, and the dev labs are under `/dev/*`.
- Never post or send anything from the live account.
- Never print or paste secrets (keys, keystore passwords, env values).
- For design work, show samples first. Push to `main` only when the owner says so.
- Checks before any push: `pnpm check` from the repo root, and `node apps/web/scripts/check-provider-order.mjs`.

## Stack in one paragraph

A pnpm monorepo. The app is `apps/web` (React, TypeScript, Vite, Tailwind v4), and the Android app is Capacitor in `apps/web/android`. Shared code lives in `packages/core`, `packages/ui` and `packages/tokens`. The backend is Supabase (project ref `gpijpmepzowwhvgkriqu`), with migrations in `supabase/migrations` and edge functions in `supabase/functions`. Cloudflare Pages deploys `main` to pingochat.pages.dev by itself on every push. Cloudflare Workers live in `workers/` (R2 bucket `pingo`). The Windows app (Electron) lives in `desktop/`.

## What is live on `main` (newest first)

| Commit | What |
| --- | --- |
| *(this push)* | **PINGO AI voice call, new UI ("Captions").** Same feature, new look in `apps/web/src/features/ai/VoiceCall.tsx`. The line being said is shown large, like subtitles, and PINGO's words light up one by one as it speaks. The last two lines of the call sit faint above it. A row of voice bars (`VoiceBars.tsx`, which replaces the deleted `VoiceWave.tsx`) is driven by the real mic or audio level. The header has the PINGO mark and a call timer. The keys are photo, a wide ink hang-up key, and keyboard. The status line is in Hinglish (`sun raha hoon` / `soch raha hoon…` / `bol raha hoon`). Colours come from theme tokens. |
| `46b3d8b` | **QR tree: voxel kitten.** The profile QR scene (`features/profile/VoxelQr.tsx`) uses the artist's voxel cat sprite (`public/qr/garden-cat.webp`) in place of the drawn cat. The tree and lawn are unchanged. |
| `1fc1fa2` | **Nicknames.** You can only give the other person a nickname, never yourself. `ChatInfo.tsx` has one field, and `nicknames.ts` ignores old nicknames people set for themselves. |
| `6aa18a7`, `09f4946` | **QR invite card.** `QrCodeSheet.tsx` is built on the sakura artwork (`public/qr/sakura-invite.webp`). The live photo, name, handle, official PINGO mark and QR are placed at the artwork's own pixel positions (979x1606), with touch areas over the drawn Share, Save, Copy link and menu buttons. |
| `32975fe` | **Uploads music shelf.** Users upload their own songs. The Worker lives in `workers/songs`, and the client in `features/music/uploads.ts` and `UploadsShelf.tsx`. It needs the Worker deployed (see below). |
| `8c0b1f5` | **Profile song**, Telegram style. It needs the migration `20261013000000_profile_song.sql`. |
| `782710d`, `65b2a68` | **Music.** Send songs in chat, a song card, background play, a mini player, and short previews in the chat list. |
| `eb93541` | Fixes "That screen did not open" after deploys: a retry window and new-build detection. |
| `c9ab243` | Video links open full screen on the first tap. |
| `60e7634` | Chat flash on delete/info fixed, Story settings screen filled in, shared story card in chat. |
| `adcd1f4` | Badges and daily missions count for real. |
| `c83db80` | Camera, share, phone and update fixes, and the Controlling update notice image. |
| `5d6d7a1`, `6c16a61` | Call UI, and a call rings a phone whose app is closed (needs a migration and a function, below). |
| `608b65f` | Android v2.26.40.1 was released from the PC. |

## Only on the branch `claude/sweet-hopper-0fus0w` (not on `main`)

- **QR cat that just sits and makes faces** (commit `1512843`). The cat sits beside the tree and only its face moves, on a 10-second loop: it breathes, blinks, tilts its head, and smiles with a blush and a heart popping out. The owner saw it in a live preview but has not said to ship it. To ship it, bring `apps/web/src/features/profile/VoxelQr.tsx` and `apps/web/public/qr/garden-cat.webp` from that branch onto `main`. The webp was cut down to one pose, 13 KB.
- **Artist-drawn tree** (blossom plus bare, for the tree-into-QR transition). The owner generated these images but chose to keep the live tree. They are not in the repo.

## Jobs only the PC can do

Run these from the repo root. The PC has the Supabase login, the keystore and the env files.

### 1. Supabase

```bash
supabase db push
```
This applies the pending migrations:
- `20261010000000_private_accounts.sql`: without it, the private account switch keeps turning itself off.
- `20261012000000_call_ring_push.sql`: a call rings a phone whose app is closed.
- `20261013000000_profile_song.sql`: saving a song in Edit Profile fails until this runs.

```bash
supabase functions deploy send-sms    # fixes the error when adding a phone under "Secure your account"
supabase functions deploy push-send   # the "Calling you on PINGO" push
```
Check first whether these were already done (`supabase migration list`) before running them again.

### 2. Cloudflare: songs Worker (the Uploads shelf)

```bash
cd workers/songs
npx wrangler deploy
npx wrangler secret put SUPABASE_ANON_KEY   # paste the public anon key from apps/web/.env (VITE_SUPABASE_ANON_KEY)
curl https://pingo-songs.dubesminecraft.workers.dev/mine   # must answer 401 "Sign in to PINGO first."
```
If the Worker comes up at a different address, set `VITE_SONGS_URL` to it in the Cloudflare Pages build env and redeploy.

### 3. Android APK

The current release is **v2.26.40.1** (versionCode `2604001`). The next one is **v2.26.40.2** (`2604002`). Version scheme: `major.YY.week.build`, and versionCode is `YYWWBB`. Bump the week if a new week has started.

1. Bump `versionCode` and `versionName` in `apps/web/android/app/build.gradle`.
2. From `apps/web`:
   ```bash
   node scripts/release-android.mjs v2.26.40.2
   ```
   The script builds the web bundle, runs `cap sync`, builds the signed release APK with the portable JDK in `.tools`, copies it to `.tools/release/PINGO.apk`, and uploads it to GitHub Releases. The website links to `/releases/latest/download/PINGO.apk`, so the file name must stay `PINGO.apk`.
3. Verify it: check the APK signature (`apksigner verify --print-certs`), install it on a phone, open the app, and check the new voice call screen and the QR card. If the app also serves the APK from R2, check that the upload there is the new file.
4. Only after step 3: in the app, go to **Settings → Controlling**, open the Update card, set the build to the new versionCode, and pick the update image. This shows the "update available" notice to people on older builds.

## Useful places in the code

- PINGO AI voice call: `apps/web/src/features/ai/VoiceCall.tsx` (logic is unchanged: live transcript, echo filter, streaming TTS, photo via the `vision` function) and `VoiceBars.tsx`.
- Profile QR: `features/profile/QrCodeSheet.tsx` (the card) and `VoxelQr.tsx` (the tree that becomes the QR, and the cat). Scan colours live in `features/profile/qr.ts` (`GARDEN`); leave them alone unless you re-run `apps/web/scripts/measure-qr-contrast.mjs`.
- Music: `features/music/*` (player, uploads, song share).
- Nicknames: `features/chat/nicknames.ts` and `ChatInfo.tsx`.
- Dev labs (dev build only): `/dev/qr-lab`, `/dev/story-lab`, `/dev/camera-lab`, and others in `App.tsx`.
- Local dev without a backend, from `apps/web`: `VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=lab-dummy npx vite --port 5190`, then open `/chats?demo`.
