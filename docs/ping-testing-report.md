# Ping — testing report

**Date:** 28 July 2026
**Built against:** `https://pingochat.pages.dev` (Cloudflare Pages, `main`)
**Database:** Supabase `lppzoqgvshhmxqsvggug`
**Commits:** `aafcd58` → `c1b4f20`

Every result came from driving the deployed app or querying the live database.
Section 7 records what could not be verified here and why.

---

## 1. The audit, and what was reused

The brief asked for an audit before code, and it changed the shape of the work:
**the hard part already existed and was already right.**

| Assumed foundation | Reality |
| --- | --- |
| Camera, flash, zoom, front/back | Exists — `useCamera.ts` |
| Shader pipeline | Exists — `engine/GLPipeline.ts` |
| Effect manager / filters | Exists — `filters/registry.ts`, `filterStill.ts` |
| Asset loader / vision | Exists — `vision/VisionPipeline.ts` |
| Gallery, story camera, chat camera | Exists — `CameraScreen.tsx` |
| Editor | Exists — text, emoji, draw, stickers, crop, rotate |
| Story export | Exists |
| **Recording engine** | **Does not exist.** No `MediaRecorder` anywhere |

The ephemeral delivery machinery also already existed: `open_snap` is a
`security definer` function, the only route to the bytes, and calling it *is*
the view. `download_snap` destroys the server copy. One object per conversation,
so one recipient saving cannot take it from the others. **The "server forgets"
requirement was met by code already in the repository**, so it was extended
rather than replaced.

Nothing in the camera stack was rewritten.

## 2. Bugs found — two of them shipped, neither mine

Testing the view limit against the live database surfaced two failures in code
that had been in production.

**1. `destroy_snap` threw on every call.** It ended with
`delete from storage.objects`, which Supabase now blocks
(`storage.protect_delete`). Three callers were affected:

- `open_snap`, when the last allowed view was spent in a direct chat. **The
  final view of every Ping failed** — the second of two, or the only one of one.
  The viewer's counter had already been incremented, so they lost the view
  *and* got an error instead of the picture.
- `download_snap`, so saving in a one-to-one chat failed.
- `purge_expired_snaps`, so nothing was ever reclaimed.

**2. Behind it, hidden by the first: a check constraint that contradicted the
feature.** `messages_snap_media_check` asserted "a snap always has media";
`destroy_snap` exists to reach the state where it has none, and nulls
`media_url`. **Destroying a snap has been impossible since the day it shipped.**

Both fixed. Making the media unreachable is still SQL — clear the path, mark it
consumed, and `open_snap` refuses on either. Reclaiming the bytes now goes
through the Storage API, so the path is parked in `snap_purge_path` for a client
sweep. That is a delay in freeing storage, not a window in which anybody can
read the Ping.

**3. Copy.** The permission gate still said "nothing is captured or sent until
you take a snap" — the first sentence anybody reads about the feature. Found by
opening the camera, not by grepping.

**4. Touch targets.** "Add to story" and "Save" were 36px tall, directly above
the send button.

## 3. The view limit — pass

Your suggestion, verified against the live database rather than in the client.

| Test | Result |
| --- | --- |
| A 1-view Ping opens once | Pass — `views_left` 0 |
| A second open of a 1-view Ping | **Refused** |
| A 2-view Ping counts down | Pass — 1, then 0 |
| A third open of a 2-view Ping | **Refused** |
| Media marked consumed and parked after the last view | Pass |
| Sender re-reading their own Ping | Does not spend a recipient's view, does not consume, notifies nobody |
| Rows written before the choice existed | Default to 2 — a Ping in flight when the migration ran was not silently changed |

"Keep in Chat" is not a third value in that function. It routes to the photo
path, which already stays in the thread and can be reopened freely. Teaching the
ephemeral path a never-expires mode would have been one `if` away from leaking
the wrong media permanently.

## 4. The workflow — pass

Driven end to end on the deployed app, sending a real Ping.

| Step | Result |
| --- | --- |
| Camera gate asks before touching hardware | Pass |
| Gallery path for a device with no camera | Pass |
| Filter stage — 14 filters | Pass |
| Editor — Draw, Text, Emoji, Stickers, Crop, Rotate | Pass, all six present |
| Send stage: view limit, then recipients | Pass |
| Default is 2 views | Pass |
| Recipients ordered pinned → recent → groups | Pass |
| Multi-select with a counting Send button | Pass — "Send to 1" |
| Button reads "Select someone" at zero | Pass |
| Send commits once for everybody | Pass |
| Confirmation over the picture, not replacing it | Pass — "Ping sent to 1" |
| Returns to the camera on its own | Pass |
| Stored with the right limit | Pass — `view_limit: 1` |
| "sent you a Ping" notification | Pass — exactly one |

The return degrades honestly: on a machine with no camera it lands on "No camera
here. Pick a photo instead" rather than an error.

## 5. The Ping in a chat — pass

| Test | Result |
| --- | --- |
| Sender's side is a status card, not a button | Pass — "Ping sent · 1 view" |
| Receiver's side is a button | Pass — "New Ping · Tap to view · 2 views" |
| It states the cost before you spend it | Pass |
| Accessible name warns what opening does | Pass — "New Ping, two views. Opening it spends a view." |
| Opening spends exactly one view | Pass — `snap_views.views = 1` |
| Opening fires exactly one `ping_opened` | Pass |
| A second open fires `ping_replayed`, not `ping_opened` | Pass |
| Media that cannot be fetched falls to "Ping opened" | Pass — the view is still spent, which is correct |

The last row is worth stating plainly: the fixture used for the receiver test had
no bytes behind it, so the bubble ended in its gone state rather than showing the
picture. That is the right behaviour for a missing object. It also means the
**open state — the image, the "1 view remaining" counter and Save to gallery —
was not seen rendered.** See §7.

## 6. Accessibility, mobile, performance

| Accessibility | Result |
| --- | --- |
| View limit is a labelled `radiogroup` with a `legend` | Pass |
| Default option correctly `aria-checked` | Pass |
| Recipient list labelled "Send to" | Pass |
| Each recipient is a `role="switch"` with checked state | Pass |
| Search labelled | Pass |
| Ping bubble's accessible name states the cost | Pass |
| View counter is `aria-live="polite"` | Pass |
| Retake has a 44px hit area | Pass |

| Mobile (real 390×844 frame) | Result |
| --- | --- |
| Horizontal overflow | None |
| Gate copy correct | Pass |
| Touch targets ≥ 44px | Pass **after the fix** in §2.4 |

| Performance | Result |
| --- | --- |
| DOMContentLoaded | 258ms |
| Load | 287ms |
| Long tasks over 50ms | **0** |
| DOM nodes on the camera | 86 |
| JS heap | 28MB |

## 7. What was not verified, and why

**Video.** The brief lists a recording engine among the existing foundation.
There is none — no `MediaRecorder`, nothing in the camera stack that captures
video. **Ping is photo-only.** Building it is real work (recorder, codec
choice, a duration cap) and the editor cannot composite onto video, so it would
also arrive with its tools disabled. Flagged rather than silently shipped.

**The open state of a received Ping.** Testing the receiver's side needs a
second signed-in account, which is not mine to create or sign into. The fixture
used instead had no bytes in storage, so the bubble correctly fell to its gone
state. The counting underneath it *is* verified — at the database, which is the
layer that enforces it — but the rendered image, the "1 view remaining" line and
the Save button have not been seen on screen.

**Screenshot detection.** Prepared, not implemented, as instructed. The web
platform has no reliable signal for it.

**Save to gallery** is a download, because the web has no gallery API. On a
phone it lands in Photos; on a desktop it lands in Downloads. Either way it goes
to the device and never to a PINGO server.

## 8. Deliberate decisions

- **Internal names stay `snap`.** `SnapEditor`, `snap_path`, `open_snap` and the
  persisted `saveSnaps` preference key are not read by anybody. Renaming the
  last would silently reset the setting for every user who had changed it.
- **`/settings/camera-snaps` keeps its path.** It is a URL, not copy; changing
  it 404s for anyone holding the old one in exchange for a word nobody reads.
- **The sender is told when a Ping is opened and replayed, and nothing else.**
  When, for how long, how often over a week — that is surveillance of the person
  who opened it. The receiver is told nothing about the sender either, and the
  thread folds exhausted, saved and expired into one state so neither can infer
  the other's timing.
- **Story and Save sit above Send, not beside it.** Three buttons on one row look
  interchangeable when only one of them ends the flow.
- **Sending returns after a held beat**, not instantly. Returning immediately
  makes a send feel like it may not have happened; a dialog makes it feel like
  paperwork.

## 9. Verdict

Desktop passes. Mobile passes. Accessibility passes. Performance passes — zero
long tasks. Four bugs found and fixed, two of which had been shipped and one of
which broke the final view of every Ping.

Two things remain open and are the user's call: **video capture**, which does
not exist and was assumed to, and **the open state of a received Ping**, which
needs a second account to see rendered.
