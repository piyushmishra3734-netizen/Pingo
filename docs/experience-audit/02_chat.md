# 02 · Chat — experience audit

Audited: `/chats`, `/chats/:id`, new chat, new group, share, join, and
`features/chat/**`. Read-only audit; nothing changed.

**Summary.** The chat surface gets three of the corpus's five Adopt rules right
in verifiable places — context-menu/swipe parity, reaction bar and context menu
anchored to the pressed bubble, `AttachMenu`'s trigger-anchored dropdown — and
gets the most important one wrong at scale: every message bubble carries glass
permanently rather than while pressed. The headline is that **the Ping morph does
not need to be built**: an anchored, interruptible FLIP morph already ships for
view-once *photos*; `PingBubble` simply is not wired to it. The send button
replays a 360ms bounce on every message, which the corpus names by hand as a
violation. Failed sends are a dead end.

---

## A. The flagship violation — glass on content

`MessageBubble.tsx:479` applies, **unconditionally**:

```
mine ? 'bg-brand-glass text-on-brand' : 'glass-water text-ink'
```

There is no `isPressed` gate anywhere in the component. `bg-brand-glass` also
carries `backdrop-filter: blur` (`tokens.css:904-922`), so both sides of every
conversation are glass on every scroll. This is exactly what
`01_materials_and_glass.md §1` names.

Same pattern: `AttachmentBubbles.tsx:42` (location/event), `:128, :157`
(contact), `:294` (finished call); `PhotoBubble.tsx:244` (placeholder), `:272`
(view-once cover), `:311` (caption).

**Eight content-layer variants carry glass permanently; zero are gated on
activation.** Across `features/chat`, 22 `glass-water`/`glass-lit` occurrences in
7 files.

**Correctly glass** — controls, transient or persistent chrome:
`ReactionBar.tsx:70`, `Composer.tsx:563, 590, 831`, `PingBubble.tsx:193` (the
transient Save button — the one correct case in that file), `ChatThread.tsx:1198`
(floating header).

### Two corrections to the corpus, from this audit

1. **`99_pingo_translation.md:30` says the context menu keeps glass. It does
   not.** `MessageActions.tsx:72` and `MoreSheet.tsx:137` are
   `bg-surface border border-line` — flat cards. Only the reaction-bar half of
   the long-press menu is glass. This is a decision to make, not a bug to
   silently fix.
2. **The "36 places" figure is wrong for chat.** `glass-water`/`glass-lit`
   appears 22 times across 7 chat files; `GlassPanel` appears in one file
   app-wide (`Dock.tsx`); `glass-surface` in 17 files app-wide. The
   mis-application to content is confirmed regardless of the count, but the
   number should be restated rather than repeated.

---

## B. Already correct — two rules that pass today

**Swipe / context-menu parity passes.** `useSwipeToReply.ts:151-165` fires
`onReply()` past a 56px commit threshold; `SwipeableMessage.tsx:79` shows a
`ChatIcon`; exactly one swipe action in both directions (`:40`): **Reply**. And
`MessageActions.tsx:74-81`'s first item is Reply, same icon, same handler.
**Match.** This was `99 §3`'s named audit item — it is done. Remove it from the
work list.

**Presentations already grow from their source, for the long-press menu.**
`useMenuTriggers.ts:114-122` captures the pressed bubble's live
`getBoundingClientRect()`; `MessageContextMenu.tsx:161-173` redraws the bubble
lifted at that measured position; `place()` (`:268-345`) puts the reaction bar
above and the action list below with edge clamping. Textbook, and structurally
true already.

`AttachMenu.tsx:111-120` is the other correct example —
`origin-bottom-left animate-panel-in`, anchored to the `+` button. **Cite this as
the in-repo model** rather than inventing a pattern.

---

## C. Ping and view-once — the flow, traced

- **Sealed:** `PingBubble.tsx:258-306` — a `bg-brand-glass` capsule, "New Ping ·
  Tap to open · N views", rendered as a `<button>`.
- **Tap:** `:67-94` calls `service.openPing(message.id)`; local state moves
  `opening → open | gone`. **No navigation, no viewer** — the image renders
  inline in the thread in place of the bubble (`:164-218`, `max-h-80`).
- **Animation:** `:166` is `animate-fade-in`. That is the whole transition. No
  anchor, no growth — the sealed bubble unmounts and a new element fades in.
- **Spent:** `:130-159` is a static capsule, "Ping opened · Gone from chat" —
  legible with no motion running, so `02_motion.md §2` is already satisfied.

**The morph already exists, for the sibling feature.** `PhotoBubble.tsx` captures
`sourceRef`/`sourceRect` (`:100-101`) and opens
`<ImageViewer originRect={sourceRect} … />` (`:319-322`). `ImageViewer.tsx`'s
`morphTo` (`:73-78`), `open` (`:454-476`) and `requestClose` (`:490-516`) are a
real anchored FLIP: it grows out of the exact bubble rect and collapses back into
it, re-measuring on close in case the thread scrolled, and freezing the live
transform before reversing (`:505-508`) so it is **interruptible by
construction**.

So `99 §5` is already shipped — for photos. The work is not "build a morph," it
is "point `PingBubble` at the morph that already exists."

---

## D. Motion inventory

| Trigger | Behaviour | Where | Verdict |
| --- | --- | --- | --- |
| Send | 360ms `send-pop`, replays every tap | `Composer.tsx:813-835`, `tokens.css:590-603` | **violation** |
| Receive | fade only | `NewMessagesDivider.tsx:19` | correct |
| Jump chip | fade + press scale | `ThreadJumpChip.tsx:46` | correct |
| Thread open | staggered, capped 8×45ms, once per open | `ChatThread.tsx:1466-1494` | acceptable |
| Long-press menu | anchored to bubble rect | `useMenuTriggers.ts:114-122` | correct |
| Attach menu | rows stagger 40ms | `AttachMenu.tsx:132-134` | acceptable |
| Sheets (5 of them) | `panel-in` from screen edge, no anchor | `Sheet.tsx:106-146` | **violation** |
| Conversation `⋯` | positioned right, but `origin-top-right` is dead code — `panel-in` never scales | `ConversationMenu.tsx:135` | partial |
| Ping open | plain fade | `PingBubble.tsx:166` | **gap** |
| View-once photo | anchored FLIP, interruptible | `ImageViewer.tsx:73-78, 454-516` | correct — the template |
| Recording pulse, AI shimmer | `motion-reduce` respected | `ChatThread.tsx:176-221` | correct |

**The send bounce.** `Composer.tsx:813-835` increments `sent` (`:819`) and
remounts via `key={sent}` (`:830`) to replay the animation on every send. The
in-code comment (`:822-829`) frames it as deliberate, apparently unaware it
contradicts the rule set the app is adopting: *"sending is the most frequent
action in the app and by this rule earns none"* (`02_motion.md §4`).

---

## E. States

### ChatThread

| State | Present | Where |
| --- | --- | --- |
| Initial loading | yes | `:1437-1438` |
| Loading older | yes | `:1454-1457` |
| **Empty thread** | **missing** — `:1458-1464` only renders "This is the beginning…" when `messages.length > 0`; at zero the area is blank | |
| **Error loading** | **missing** — `useMessages` exposes no error surface consumed here | |
| **Offline** | **missing** — no `navigator.onLine` check in the file | |
| Sending | yes, clock icon | `MessageBubble.tsx:695-696` |
| **Failed to send** | partial — desaturated bubble + red ring (`:481`) and "Not sent" (`:699-700`), but **no retry exists** in `MessageMenu.tsx` or `MessageActions.tsx`. A failed message is a dead end. | |

### Elsewhere

- `NewChatScreen.tsx:71-73` and `NewGroupScreen.tsx:66-68` — a `listContacts()`
  failure silently becomes an empty array, indistinguishable from having no
  contacts. `NewGroupScreen` otherwise handles states well, correctly separating
  `undefined` from an empty Set (`:74-84, 200-201`).
- **`JoinGroupScreen.tsx:55-57` is actively misleading**, not merely missing: a
  `previewGroupInvite` network failure renders the same "this invite is invalid or
  gone" copy as a genuinely dead invite. It tells the user something false.
- `ShareScreen.tsx:131-138` — no payload renders `null` with no message; a stale
  route goes blank. No upload progress for large sends, only a boolean `busy`.
- `SharedMediaSheet.tsx:64-66` — a disk-read failure renders "No shared media
  yet."
- `GroupInfoSheet.tsx:566-611` — no loading state for the member roster.
- `VideoPlayer.tsx` — `onError` exists (`:34, 224`) but renders nothing; with
  `preload="none"` (`:192`) there is no buffering indicator either. The component
  most likely to need a slow-media state has none.
- `GroupInfoSheet.tsx:412-423` — the avatar button's `aria-label` is set only
  when `iAmAdmin` (`:422`); non-admins get an unnamed button. A concrete
  `04 §5` "always" violation.

### A third glass vocabulary

`JoinGroupScreen.tsx:110-116` uses neither `glass-water` nor `glass-surface` but
a one-off `border border-line/50 bg-surface/90 backdrop-blur-md` with raw
`rgba()` shadows instead of tokens — built without the light/dark/contrast
variants, which `01 §4` names directly: a material picked because it looked right
in one theme is a bug in the other.

---

## Top five fixes

1. **Stop animating the send button on every send.**
   `Composer.tsx:813-835` — remove the `key={sent}` remount (`:830`) and
   `motion-safe:animate-send-pop` (`:831`). Most frequent interaction in the app;
   the corpus names this exact case. **Trivial** — ~5 lines deleted.

2. **Bubbles flat at rest, glass only while pressed.**
   `MessageBubble.tsx:479`, `AttachmentBubbles.tsx:42,128,157,294`,
   `PhotoBubble.tsx:244,272,311`. Gate on the press state the long-press plumbing
   already tracks (`useLongPress.ts` / `useMenuTriggers.ts`). Corpus rule #1,
   affects every message on every scroll, and no new infrastructure is needed.
   **Medium** — ~8 render conditionals across 3 files.

3. **Wire the Ping viewer to the morph that already exists.**
   `PingBubble.tsx:164-218` does a bare fade (`:166`); point it at `ImageViewer`
   with the bubble's rect as `originRect`, exactly as `PhotoBubble.tsx:319-322`
   does. **Medium**, and far cheaper than it looks — the morph is
   production-tested.

4. ~~**Give failed sends a way out.**~~ **Corrected on reading the pipeline.**
   The audit read this from the UI. `chat-service.ts:4131-4168` shows `failed`
   is only reached in three cases, and the commonest is not one of them: a
   dropped connection already goes into the offline queue under the id the
   bubble is showing and **stays `sending`**, leaving on the next flush with
   nobody doing anything. The file says why, in as many words - "a connection
   that gave out is not a message that failed."

   What actually reaches `failed` is (a) the server refusing with a Postgres
   code, where the same request will be refused again and a retry button would
   be a lie; (b) a draft carrying media, because a queued photo is a file handle
   that does not survive a reload; and (c) a send that was already a retry.

   So the real gap is narrower than reported and lives only in (b): a photo
   whose send failed while the page is still alive, with the preview still in
   the bubble. That one is retryable and worth building. It needs the draft to
   stay reachable from the message id, and it needs a live test on a throttled
   connection - which is why it is not being built blind.

5. **Anchor sheets to what opened them — fix the shared primitive.**
   `components/Sheet.tsx:106-146` has no anchor concept and always renders
   `fixed inset-0 … items-end`. It backs `GroupInfoSheet`, `DisappearingSheet`,
   `SharedMediaSheet` and `VideoTrimSheet`; `AttachSheets.tsx:39-69` duplicates
   it independently. One primitive, five surfaces. `AttachMenu.tsx:111-120` is
   the in-repo model. **Medium-large** — or, per `99` item 7, deliberately
   prototype this one before committing.
