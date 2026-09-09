# 04 · Capture and realtime — experience audit

Audited: `/camera`, stories, `/calls`, `/communities`, `/notifications`.
Rules from `docs/apple-research/`. Read-only audit; nothing changed.

**Summary.** The camera is well engineered underneath — GL-composited filter
pipeline, a capture race fixed with a queued-request pattern, `useBackStep`
walking stages rather than dropping out of the flow — with one serious gap:
every camera failure collapses into a single generic message that is sometimes
false, with no recovery path. Controls over the live feed use ad hoc opacity
values rather than the app's own material, so the clear-glass rule is not
applied on the one screen it was written for. `StoryViewer` implements half of
"grows from its source": it opens with a FLIP out of the story circle and closes
by unmounting instantly. Calls and Notifications each drop one failure state.

---

## 1. CameraScreen (`/camera`)

Four stages on one route — `Stage = 'gate' | 'live' | 'filter' | 'edit' | 'send'`
(`CameraScreen.tsx:47`). At rest the `live` stage is a full-bleed canvas preview,
a filter rail, and a shutter/gallery/close row (`CameraScreen.tsx:539-728`).
No permission is requested until the gate is dismissed
(`CameraScreen.tsx:315-374`) — deliberate, and the file says so
(`CameraScreen.tsx:307-314`). Correct.

### States

| State | Present | Where |
| --- | --- | --- |
| Not yet asked | yes, the `gate` stage | `CameraScreen.tsx:315-374` |
| Starting | yes, `PingoDot` | `CameraScreen.tsx:598-602` |
| Ready | yes | `CameraScreen.tsx:537, 619-665` |
| **Permission denied** | **no distinct state** | `useCamera.ts:194-196` |
| **No camera present** | **no distinct state** | `useCamera.ts:194-196` |
| **Camera busy** | **no distinct state** | `useCamera.ts:194-196` |
| Capture in flight | implicit only — flash, no lock | `CameraScreen.tsx:158-184` |
| Send failing | yes, generic | `CameraScreen.tsx:254-259, 281-286` |
| **Offline** | **missing** — same catch-all | `CameraScreen.tsx:254-259` |

### The serious finding

`useCamera.ts:107-197` calls `getUserMedia` in a bare `try`, and the single
`catch` at `:194` sets `status = 'unavailable'` regardless of `error.name`.
There is no `NotAllowedError` / `NotFoundError` / `NotReadableError` branching
anywhere in `apps/web/src/features/camera/` — zero hits on search.
`CameraScreen.tsx:604-616` renders one screen for all three: *"No camera here."*
(`camera.none`, `catalog.ts:173, 942`).

For permission-denied this is worse than unhelpful, it is **false** — the device
has a camera, PINGO just is not allowed to use it — and there is no route back
to the OS prompt or the browser's site settings. The only way forward is "Choose
a photo instead" (`CameraScreen.tsx:610-616`), or leaving the app to change a
setting the UI never names.

### Controls over live media — the clear-glass test

PINGO's own material is **not used anywhere in the live stage**. Instead:

| Control | Treatment | Where |
| --- | --- | --- |
| Flip / grid / torch / timer | `bg-black/40`, `bg-white` active | `CameraScreen.tsx:778-807` |
| Retake over sent photo | `bg-black/45 backdrop-blur-glass` | `CameraScreen.tsx:466-470` |
| SnapEditor discard | `bg-black/34 backdrop-blur-sm` | `SnapEditor.tsx:901-906` |
| SnapEditor speaker | `bg-black/45 backdrop-blur-sm` | `SnapEditor.tsx:839-843` |

Three opacities (34 / 40 / 45) and two blur classes doing one job — a dark scrim
over media — none tied to the app's tokens or to Apple's published 35% figure
(`01_materials_and_glass.md §2`). Directionally right, systematically
disconnected. This is LTK's "solving the same problem in multiple ways"
(`06_design_process.md §9`) in miniature.

One done right: SnapEditor's floating toolbar
(`SnapEditor.tsx:938-943`, `border-white/12 bg-white/10 backdrop-blur-xl`) is a
proper regular-glass control cluster, correctly distinct from content scrims.

### Motion

Shutter flash is 160ms and opaque (`CameraScreen.tsx:159-161, 596`) — brief and
correct per `02_motion.md §4`. Stage transitions are hard cuts, which is right:
frequent interactions earn no motion. Back walks stages one at a time via
`useBackStep` (`CameraScreen.tsx:301-303`) and each stage's own Back does the
same thing as hardware back — it reverses its own gesture. Nothing is
uninterruptible, and the sent confirmation is also text with `role="status"`
(`CameraScreen.tsx:454`), so no meaning is motion-only.

### The camera stays hot through review

`useCamera(chain, stage !== 'gate', …)` (`CameraScreen.tsx:94-99`) keeps
`enabled` true across `live`, `filter`, `edit` and `send`; it only goes false
back at `gate`. So `getUserMedia` and the render loop never tear down when the
stage advances (the loop's canvas check just returns early once the element
unmounts, `useCamera.ts:154-156`). The stream stays open and the privacy
indicator stays lit for the whole time somebody is filtering, editing and
choosing recipients for a photo already taken. Probably deliberate for fast
retake — but it should be a decision, not an implication.

### Reachability

Shutter, gallery and close are in the bottom row (`CameraScreen.tsx:680-712`) —
in reach. Flip/grid/torch/timer are stacked top-right
(`CameraScreen.tsx:620-644`), outside a one-handed arc, which matches the
convention of keeping infrequent no-side-effect controls out of the
accidental-tap zone. Defensible. Zoom and exposure are horizontal range inputs
(`CameraScreen.tsx:647-665, 809-839`); there is no pinch handler on the frame —
its only gesture is tap-to-focus (`CameraScreen.tsx:544-553`).

---

## 2. Stories

`StoryViewer.tsx` is a full-screen player: tap to page, hold to pause, swipe down
to dismiss, segmented progress (`StoryViewer.tsx:26-46`). `StoryProgress.tsx:6-21`
drives the bar with direct `style.transform` writes on its own rAF loop rather
than React state — correct, avoids re-rendering the tree 60 times a second.

States are unusually well covered: progressive blur-to-sharp reveal held via
`player.hold()` so the clock does not run over a blank frame
(`StoryViewer.tsx:607-693, 695-979`); `onError={done}` releases the hold rather
than hanging forever (`:672, :867`); a visible "Paused" pill so the pause is not
motion-only (`:480-489`); an explicit tap-to-unmute affordance for blocked
autoplay (`:946-976`); confirmation on delete and mute (`:289-301, 334-370`).

### The motion finding

`StoryViewer.tsx:134-163` runs a FLIP that grows the viewer **out of** the
tapped story circle — exactly rule 5 in `99_pingo_translation.md`. There is **no
reverse on close.** `Overlay.tsx:29-45` is a bare portal with no exit-transition
machinery, and every close path — X (`:432-440`), Escape (`:201`),
swipe-past-threshold (`:266-269`) — calls `onClose()` and unmounts instantly.
The swipe does follow the finger while it is down (`:385-393`), but once
`DISMISS_DISTANCE` is crossed the viewer vanishes rather than continuing back
into the circle's rect.

This is the constraint `99 §5` names for the not-yet-built Ping morph — "it must
collapse back into the bubble it came from" — already half-built here, with the
missing half citable rather than speculative.

---

## 3. Calls, Communities, Notifications

**CallsScreen** — correctly de-emphasises missed calls in brand colour rather
than red (`:24-26`); loading (`:49-50`) and empty (`:51-56`) handled; group rows
correctly disable call-back with no single peer (`:155-167`). **A rejected
`listCalls()` is not caught at all** (`:34-42`) — `calls` stays `undefined`
forever, so a fetch failure is indistinguishable from loading, with no retry.

**CommunitiesScreen** — the model for the others. Loading (`:217-218`), a
distinct directory fetch-error banner (`:55-79, 205-209`), a separate
"couldn't open a chat" banner (`:118-144, 211-215`), a per-row opening spinner
(`:114, 335`), and empty split from no-matches by whether a query was typed
(`:219-228`). Nothing to fix.

**NotificationsScreen** — good structure: day sectioning and consecutive-run
collapsing (`:204-221`), search and kind filters (`:295-334`), inline
accept/ignore re-verified against a live pending set rather than trusting the
notification kind (`:133-161, 421`). One gap: `listNotifications()` failure is
caught and silently treated as an empty list (`:168-181`), so an error renders
"All quiet" (`:576-607`) — the mirror image of the Calls bug.

---

## Top five fixes

1. **Camera errors are one indistinguishable, sometimes-false message.**
   `useCamera.ts:194-196` + `CameraScreen.tsx:604-616` + `catalog.ts:173, 942`.
   Branch on `(error as DOMException).name`: `NotAllowedError` → "Camera access
   is off for PINGO" with a route to site settings; `NotFoundError` → today's
   copy; `NotReadableError` → "Camera's busy — try again." Three strings, one
   `switch`. **Medium.** The only place a user gets permanently stuck with a lie
   on screen.

2. **StoryViewer opens with a FLIP and never FLIPs back.**
   `StoryViewer.tsx:134-163` versus every `onClose()` site (`:232, 269, 300,
   369, 435, 531, 556`) going through `Overlay.tsx`'s instant unmount. Mirror the
   open effect toward the stored `origin` rect before calling `onClose`, falling
   back to instant close with no origin or under reduced motion. **Medium** — the
   geometry already exists, it needs to run in reverse and be awaited.

3. **Three ad hoc scrim opacities instead of one token.**
   `CameraScreen.tsx:799-802`, `:466-470`, `SnapEditor.tsx:901-906`, `:839-843`.
   Pick one clear-style pairing for "dark control over live media" and use it in
   all four. **Small** — pure class normalisation.

4. **The stream stays open through filter/edit/send.**
   `CameraScreen.tsx:94-99`. Gate on `stage === 'live'`, accepting a brief
   reacquire on retake (permission is already granted, so no re-prompt) — or, if
   fast retake is intentional, stop the tracks on entering `send`, past which
   nothing is retaken. **Small-medium**, and worth a deliberate call either way.

5. **Calls has no error state; Notifications maps failure to "all quiet."**
   `CallsScreen.tsx:34-42`, `NotificationsScreen.tsx:168-181`. Add a distinct
   error flag rendered beside the loading/empty states — copy
   `CommunitiesScreen.tsx:63-75`, which already does it correctly, rather than
   inventing a third pattern. **Small.**
