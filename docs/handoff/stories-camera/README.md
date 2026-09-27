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

## Done since this handoff was written

1. **Upload ring after posting.** Sharing closes the editor at once; the picture flies from the frame into your circle on the stories row, the ring turns into Instagram's spinning dashes while it uploads, then a toast says "Shared to your story" (or offers Retry). It lives in `StoryContext` (`upload`, `uploading`) and `StoryUpload.tsx`, and is used by `StoryComposer`, `CameraScreen` and the profile post flow. From the camera there is no ring on screen, so it just uploads in the background and toasts.
2. **Profile post → Share → Add to story.** Share on a post (`PostViewer`) opens `SharePostSheet`: search, people, then Add to story · Close friends · Copy link · Share to… · Download. Add to story opens `PostToStory`, which is the editor with the post as a postcard on the photo's own colours. Posting goes home and flies into your ring. The card keeps `postId`/`authorId`, so viewers fetch a fresh signed URL (post URLs expire in an hour, stories last a day). In the viewer the card reads "Tap to see post"; tapping it shows "View post", which opens the profile.
3. **The camera song survives a shot.** `CameraScreen` (and `CameraLab`) own `song`; `SnapCamera` takes `song`/`onSong` and carries on playing it when it comes back.
4. **Sticker size in the viewer.** The real cause was `useContainBox`: it measured with `getBoundingClientRect`, which includes the viewer's grow-from-the-ring scale, and a transform never fires the ResizeObserver. So stickers kept the size of the first frame, anywhere up to 4× too small. It now measures layout size, and the editor and viewer match to the pixel (`app-post.mjs` checks it).

Also: the viewer's sticker tips match the sample: icon, the sample's wording, and tapping the tip does the thing.

### Second pass: the app matched to the sample, screen by screen

Each surface was screenshotted beside the sample at 390×844, and the differences were fixed:

- **Stories row:** the sample's conic ring, 70px circles, the blue `+`, and the dashed ring spinning while the first story loads.
- **Viewer:** the picture fills the frame down to the 64px foot. The header is the sample's: song line, Close friends badge, no "@handle · 1/2". The foot is "Send message", heart and send, or Activity with the highlight ⊕, send and ⋮ on yours. Quick reactions now hide the stickers. It grows out of the ring with the sample's circle clip.
- **Viewer sheets:** Report/Mute/About/Copy link, Delete/Save/Highlight/Send to/Story settings, Send to with per-row Send, and Activity with thumbs, stats and viewers. All menus use one grouped style (icon beside the label, rounded group); the owner preferred it to the sample's centred labels.
- **Editor:** the frame is full height, rounded 16px. More and Discard match the sample. Location is a list. Video gets Boomerang (Off/Echo/Classic/Slowmo/Duo) with a trim bar, played by the viewer.
- **"Add to story":** the sample's gallery. A web page cannot read the camera roll, so the grid is camera, your photos, then photos from your chats. Templates, Music and Collage work; Live sits with them.
- **Post view:** the sample's white "Posts" page.
- **Stickers** are placed in fractions of the frame and sized in its width, in both editor and viewer.

Bugs found on the way: moving to the next person skipped one in dev (a state setter inside another's updater), a text-selection drag cancelled viewer swipes, and the app's `rounded-xl/2xl` tokens are 28/36px, so exact pixels are used where the sample is exact.

The sample's editor More items (Save draft, Add AI label, Turn off replies, Invite collaborator) only show a toast, as in the sample; nothing backs them yet.

## Still to do

1. **Phone test** on a real Android device, once the owner connects it. Check real lenses and the chat fixes listed below.

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
| `app-lab2.mjs` | app editor + viewer stickers, on `https://127.0.0.1:5190/dev/story-lab` | 24/24 (in the cloud sandbox, with the song step left out; see below) |
| `app-viewer.mjs` | viewer gestures | 9/9 |
| `app-cam.mjs` | camera → editor → Send to, on `/dev/camera-lab` | 17/17 |
| `app-post.mjs` | post → Share → Add to story → ring; editor and viewer sticker size | 7/7 |

To run the app's dev server: `cd apps/web && npx vite --port 5190 --strictPort --host 127.0.0.1` (it serves https). Add `--force` after new deps.

Camera tests use Chrome's fake camera. Set `FAKE_CAM=/path/face.y4m` to feed a face instead, which is needed for face lenses to do anything. Make one with `ffmpeg -loop 1 -i face.jpg -t 5 -pix_fmt yuv420p face.y4m`.

With cleared storage, Camera Kit asks "adult or child?" and then shows its terms the first time a lens loads. `app-cam.mjs` answers both.

Playwright's bundled Chromium cannot decode AAC. Posting a story with a song there fails with "That file has no sound this browser can read", so run `app-lab2.mjs` in Chrome or on a phone for that step. `/dev/story-lab` mirrors the sample's people and stories, so the two can be screenshotted side by side. The labs need no backend: start Vite with any `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` if there is no `.env`.

Camera Kit works with the Staging token. The Production token returns 401 until Snap approves the app, whose app ID is `chat.pingo.app`.
