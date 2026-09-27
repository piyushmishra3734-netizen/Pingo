# Handoff: Stories + Snap camera (as of 2026-09-27, commit 5130cea)

The goal is for PINGO's stories and camera to match the samples in `sample/` 100%.

The flow is one path:

1. **Snap camera.** Uses Camera Kit lenses, music, timer and so on.
2. **Instagram story editor.**
3. **Snapchat "Send to".** The sheet lists My story, then Close friends, then friends.

## Rules from the owner

- Finished work gets committed and pushed to `main`. The push *is* the deploy: Cloudflare Pages deploys `pingochat.pages.dev`.
- Verify in a real browser before saying something works. Measure, don't guess CSS.
- Don't push the **chat-list** sample (`sample/chats.html`) into the app until the owner asks. It is here as reference only.
- Don't build an Android APK unless asked.
- Every UI icon comes from Lucide; no emoji icons.
- Keep replies short and lead with the answer. The owner writes Hinglish.
- Never post stories or send messages from the owner's live account while testing.

## The samples (`sample/`)

On the owner's PC these were served on `localhost:5177`. Run them anywhere with `cd docs/handoff/stories-camera/sample && python -m http.server 5177`.

| File | What it is |
|---|---|
| `story.html` + `story.css`, `story.js`, `editor.js`, `stickers.js`, `post.js`, `ui.js` | **The reference.** It has the Instagram stories tray, viewer, editor, stickers, viewers list, and "Add to story" from a profile post. |
| `chats.html` | Telegram-style chat list sample. It is **not shipped**; don't port it unasked. |
| `bubbles.html` | Bubble colour options. This is done: sent bubbles are flat pink, received bubbles are liquid glass. |
| `index.html`, `full.html`, `refs.html` | Profile card / profile page samples. |

The camera sample is not included here because it is fully ported. The app's `features/camera/snap/` is now the reference for the camera.

## Where the app code lives (`apps/web/src`)

- **Stories:**
  - `features/stories/`: `StoryEditor.tsx` (the Instagram editor), `StoryViewer.tsx` (cube swipe, hold, footer), `StoryActions.tsx`, `CloseFriendsSheet.tsx`, `useStoryPlayer.ts`.
  - `features/stories/stickers/`: `StickerView.tsx`, `StoryStickerLayer.tsx`, `stickers.css`.
- **Camera:** `features/camera/snap/`:
  - `SnapCamera.tsx`
  - `SnapShotEditor.tsx`, which wraps StoryEditor for a shot
  - `send-to.tsx`, which holds SendTo, drawStickers and noteSends
  - `camera-kit.ts`, which holds the token: Staging, overridable with `VITE_CAMERA_KIT_TOKEN`
- **Screens:**
  - `screens/CameraScreen.tsx`
  - Dev-only labs, which need no login: `screens/dev/StoryLab.tsx` at `/dev/story-lab` and `screens/dev/CameraLab.tsx` at `/dev/camera-lab`.
- **Music:** `features/music/sheets.tsx`. It calls the JioSaavn Worker at `https://pingo-music.dubesminecraft.workers.dev/api`.
- **Core:** `packages/core/src/story-service.ts` has the sticker types, `decor`, and `STORY_AUDIENCES`, which is only `friends` and `close`.
- **Database:**
  - The live Supabase project is `gpijpmepzowwhvgkriqu`.
  - Migration `supabase/migrations/20260927000000_story_stickers.sql` is **already applied**. It covers `stories.decor`, `story_sticker_answers`, and `story_sticker_results`.

## Still to do (in order)

1. **Upload ring after posting.**
   - In the sample, the finished story flies into your ring on the stories row, and the ring spins while it uploads. See `story.js` around the comment "The finished story flies into your ring".
   - The app doesn't do this yet. It belongs in the stories row component, fed by the post call in `StoryComposer.tsx` / `CameraScreen.tsx`.
2. **Profile post → "Add to story".**
   - Open someone's profile, then a post, then Share, then Add to story. That opens the editor with the post as a postcard sticker on a blurred background. See `post.js` and `story.js` (`data-a="story"`).
   - StoryEditor already accepts `initialStickers` and `bg` for this.
   - There is **no home feed**. The owner was explicit: it starts from a profile.
3. **Keep the camera song between shots.**
   - `SnapCamera` keeps `song` in local state.
   - `CameraScreen` unmounts it while `SnapShotEditor` is open, so the song resets after every shot.
   - Fix: lift `song` into `CameraScreen` or keep SnapCamera mounted.
4. **Sticker size in the viewer.** It looked slightly small in one lab screenshot and was never measured. Compare the editor and viewer at the same width. Both use `cqw` units on a 1080×1920 frame.
5. **Phone test** on a real Android device, once the owner connects it. Check real lenses and the chat fixes listed below.

## Chat fixes already shipped (for reference)

- **The thread no longer jumps on "seen" or "typing".** `ChatThread.tsx` only follows the bottom when the content grew, and never while a message menu is open (`isMessageMenuOpen`).
- **Instagram-style typing.** It shows as an avatar with dots above the composer instead of inside the thread.
- **The hold menu stays put.** It closes only on a real wheel or touch, not on programmatic scroll.
- **iPhone-style Edit and Info:** `EditMessageSheet.tsx`, `MessageInfoSheet.tsx`.

## Tests (`tests/`)

These are Playwright scripts that drive real input. They need `playwright-core` with Chromium installed.

- **Where they look for Playwright:** they resolve it next to the script by default. Set `PW_MODULES=/path/to/node_modules/` to point elsewhere.
- **Where screenshots go:** `./out/`.

| Script | Target | Last result |
|---|---|---|
| `story-test.mjs` | the sample, on `http://localhost:5177/story.html` | 70/70 |
| `app-lab2.mjs` | app editor + viewer stickers, on `https://127.0.0.1:5190/dev/story-lab` | 24/24 |
| `app-viewer.mjs` | viewer gestures | 9/9 |
| `app-cam.mjs` | camera → editor → Send to, on `/dev/camera-lab` | 15/15 |

To run the app's dev server: `cd apps/web && npx vite --port 5190 --strictPort --host 127.0.0.1` (it serves https). Add `--force` after new deps.

Camera tests use Chrome's fake camera. Set `FAKE_CAM=/path/face.y4m` to feed a face instead, which is needed for face lenses to do anything. Make one with `ffmpeg -loop 1 -i face.jpg -t 5 -pix_fmt yuv420p face.y4m`.

Camera Kit works with the Staging token. The Production token returns 401 until Snap approves the app, whose app ID is `chat.pingo.app`.
