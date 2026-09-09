# Experience audit — what it found

Five parallel audits, 63 routes, 57 screens, read against
`docs/apple-research/`. Nothing was changed during the audit.

LTK's lesson was the instruction: *"we were solving the same problem in multiple
ways, even for something as simple as a product card"*
(`06_design_process.md §9`). So the findings are grouped by **class**, not by
screen. One correction to a class retires a family of defects; twenty-five
one-off tweaks retire twenty-five.

Per-area detail: `01_first_run.md` · `02_chat.md` · `03_profile.md` ·
`04_capture.md` · `05_settings.md`.

---

## The seven classes

### A · ALL CAPS section headers — ~25 headers, 4 edits

Three shared components each hard-code `uppercase`, and one screen already does
it correctly, which is what makes it a class rather than a style choice.

| Source | Reach |
| --- | --- |
| `settings/controls.tsx:42` | ~12 settings pages |
| `features/journey/sections.tsx:28` | 6 Journey headers, incl. `LifeChapters.tsx:55,79` |
| `AchievementsScreen.tsx:191` | 3 headers |
| `MythicMissionScreen.tsx:298,325,406,512,595` | 5, the same class fragment inline five times |
| `JourneyScreen.tsx:248` | rarity sub-headers |
| **`ProfileScreen.tsx:1112`** | **already title case — the model** |

The strings are already written in title case. The CSS is the only thing
shouting. `03_navigation_and_layout.md §6`.

### B · A failed fetch renders as "there is nothing here" — 9 sites

The single most common defect in the app, and in one place it states something
false.

| Site | Behaviour |
| --- | --- |
| `ProfileScreen.tsx:170,175,186,190,203` | every read catches to empty; a visitor with a network blip sees a stranger with an empty life |
| `CallsScreen.tsx:34-42` | rejection never caught → permanent spinner |
| `NotificationsScreen.tsx:168-181` | error renders "All quiet" |
| `NewChatScreen.tsx:71-73`, `NewGroupScreen.tsx:66-68` | reads as "you have no contacts" |
| **`JoinGroupScreen.tsx:55-57`** | **actively false** — a network failure says the invite is invalid or gone |
| `SharedMediaSheet.tsx:64-66` | reads as "no shared media yet" |
| `PushDebugScreen.tsx:95` | health failure hidden entirely |
| **`CommunitiesScreen.tsx:63-75`** | **correct — in-repo model** |
| **`DevicesScreen.tsx:71-85`** | **correct — `loadFailed` distinct from empty** |

Two working models already exist. Nothing needs inventing.

### C · Four material vocabularies for one job

- Camera scrims at three opacities and two blur classes —
  `CameraScreen.tsx:799-802, 466-470`, `SnapEditor.tsx:901-906, 839-843`
- A one-off glass in `JoinGroupScreen.tsx:110-116`, raw `rgba()`, no token
  variants — `01 §4`: a material chosen because it looked right in one theme is a
  bug in the other
- Two corner radii for the same object: `AchievementsScreen.tsx:209-211`
  adopted `rounded-[1.25rem]` with an explicit iOS rationale; JourneyScreen's
  equivalent cards use the generic `rounded-lg`
- And the flagship: **glass applied to content rather than controls** (class D)

### D · Glass on content, permanently — the corpus's rule #1

`MessageBubble.tsx:479` applies `glass-water` / `bg-brand-glass`
unconditionally; no press gate exists. Eight content-layer variants carry glass
at rest, zero are gated on activation (`AttachmentBubbles.tsx:42,128,157,294`,
`PhotoBubble.tsx:244,272,311`).

Both sides of every conversation are glass on every scroll — the exact pattern
`01_materials_and_glass.md §1` names, and the one fix where correct and cheap
agree.

### E · Async buttons that do not say they are working

`SignUpPhoneScreen.tsx:77-85` and `SignUpPhoneCodeScreen.tsx:118-121` await real
network calls and only swap a text label, never passing `loading`. `Button`
already has the treatment (`Button.tsx:107-128`) and
`CreatePasswordScreen.tsx:120`, `LoginPasswordScreen.tsx:163`,
`UsernameScreen.tsx:147` all use it. The most common sign-up path is the odd one
out.

Related, from `07_first_run_and_waiting.md §7`: `ChatThread.tsx:1438` renders a
spinner with a label where Apple asks for placeholder content in the shape of
what is arriving.

### F · Destructive actions without confirmation

| Control | Confirms |
| --- | --- |
| Logout, clear local data, remove device, unmute author | yes |
| **`AdvancedScreen.tsx:55-59` — reset all settings** | **no.** One tap wipes every preference. No undo. |
| **`StorageScreen.tsx:70-75` — clear cache** | **no**, and `clear()` has no catch |
| **`AccountScreen.tsx:257` — delete account** | **dead**, no `onClick`, styled as live |

Four of seven get it right, so this is oversight, not a risk gradient — and the
unconfirmed one is arguably the most consequential of the set.

### G · Presentations from the screen edge

`components/Sheet.tsx:106-146` has no anchor concept and always renders
`fixed inset-0 … items-end`. It backs `GroupInfoSheet`, `DisappearingSheet`,
`SharedMediaSheet` and `VideoTrimSheet`; `AttachSheets.tsx:39-69` duplicates it.
`StoryViewer.tsx:134-163` opens with a FLIP from the story circle and **never
reverses on close** (`Overlay.tsx:29-45` unmounts instantly).

Three correct in-repo models exist: `AttachMenu.tsx:111-120`,
`MessageContextMenu.tsx:161-345`, and `ImageViewer.tsx:73-78, 454-516`.

---

## Two corrections to the research corpus

Found by the audit, and recorded rather than quietly patched:

1. **`99_pingo_translation.md:30` claims the context menu keeps glass. It does
   not.** `MessageActions.tsx:72` and `MoreSheet.tsx:137` are flat
   `bg-surface border border-line`. Only the reaction-bar half is glass. A
   decision to make, not a bug.
2. **The "36 places" figure is not right for chat.** `glass-water`/`glass-lit`
   occurs 22 times across 7 chat files; `GlassPanel` in one file app-wide.

## Two things already correct — removed from the work list

- **Swipe / context-menu parity passes.** Both are Reply, same icon, same
  handler (`useSwipeToReply.ts:151-165`, `MessageActions.tsx:74-81`). This was
  `99 §3`; it is done.
- **The Ping morph does not need building.** An anchored, interruptible FLIP
  already ships for view-once *photos* (`ImageViewer.tsx`), and
  `PhotoBubble.tsx:319-322` uses it. `PingBubble.tsx:166` just does
  `animate-fade-in`. The work is rewiring, not building.

## Best-in-repo, worth copying rather than re-deriving

`SplashScreen.tsx` verify-before-swap · `MythicMissionScreen.tsx` state design ·
`CommunitiesScreen.tsx` and `DevicesScreen.tsx` error-versus-empty ·
`ImageViewer.tsx` interruptible morph · `NewGroupScreen.tsx` undefined-versus-empty ·
`AttachMenu.tsx` anchored presentation.

---

## Order of work

By Slack's rule — frequency of use first, muscle-memory risk last
(`06_design_process.md §6`) — not by cost.

| # | Fix | Class | Status |
| --- | --- | --- | --- |
| 1 | Stop the send-button bounce | E | **done** — `188bfdf`, keyframe and token deleted too |
| 2 | `loading` on the two phone-auth buttons | E | **done** — `188bfdf` |
| 3 | Drop `uppercase` from section headers | A | **done** — `188bfdf`, 25 headers across 17 files, far more than the audit found |
| 4 | Confirm the destructive actions | F | **done** — `188bfdf`, plus the dead Delete Account row |
| 5 | Hide the fake "Today's missions" | — | **done** — `188bfdf` |
| 6 | Camera error branching | B | **done** — `ae3945d`, four causes, retry for the two that can change |
| 7 | Bubbles flat at rest, glass on press | D | **held for the operator** — see below |
| 8 | Wire `PingBubble` to `ImageViewer` | G | **done** — `ab4974f`, and it took PhotoBubble's stale-photo fix with it |
| 9 | Error versus empty, nine sites | B | **3 of 9** — `6004c97`: join, calls, notifications |
| 10 | Retry for failed sends | — | open |
| 11 | Reverse the StoryViewer FLIP on close | G | open |
| 12 | Increased-contrast token variant | — | open |

Remaining in class B: the five profile reads, the two contact pickers, shared
media, and push diagnostics. None of them states anything false — they read as
empty, which is wrong but not a lie — so they rank below 10 and 11.

---

## Why 7 is held

It is the corpus's own rule #1 and the audit confirms the violation: eight
content-layer variants carry glass permanently, zero gated on activation. But
it is also the one change that alters how every message in the app looks at
rest, and `MessageBubble.tsx:465-478` carries an argued rationale for the
current choice — that with a wallpaper behind it, an opaque bubble is the one
surface in the conversation refusing to admit anything is behind it.

The corpus's own strongest lesson applies here and nowhere else on this list:
Slack prototyped four headers on device and rejected the one the published rule
endorsed, because of how a single edge resolved (`06_design_process.md §3`). A
rule from a document is a hypothesis; the device is the authority. Flipping the
signature material of the main screen while nobody can look at it would be
believing the document.

The change itself is small — gate the class on the press state the long-press
plumbing already tracks. It is ready to make on a word.
