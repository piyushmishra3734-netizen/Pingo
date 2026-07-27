# Story module — testing report

**Date:** 27 July 2026
**Built against:** `https://pingochat.pages.dev` (Cloudflare Pages, `main`)
**Database:** Supabase `lppzoqgvshhmxqsvggug`
**Commits:** `a3f3bfa` → `131a5ac`

Every result below came from driving the deployed app or querying the live
database. Where something could not be verified, it says so and why — see §7.

---

## 1. What was built

| Spec item | State |
| --- | --- |
| Story bar at the top of the chat list | Built |
| Order: You → Friends → Remaining | Built |
| Rings: accent gradient unseen, grey seen, green close friends | Built |
| Smooth horizontal scrolling | Built |
| Your Story `+` when empty → creator | Built |
| Long press → delete current story / archive | Built (plus close friends and privacy) |
| Create from camera, gallery, photo, video | Built |
| Editor: text, emoji, drawing, stickers, crop, rotate | Built |
| Architecture open to GIF / music / poll / questions / quiz | Prepared, not implemented |
| Viewer: progress bars, picture, name, time, menu | Built |
| Tap right / left, hold to pause, swipe down to close | Built |
| Bottom: like, quick reactions, reply | Built |
| Like notifies; reply opens the existing chat; no public comments | Built |
| Quick reactions ❤️ 😂 😮 🔥 😢 as chat reactions | Built |
| Share to a friend or a group; no repost chains | Built |
| Story viewers: list, count, replies, likes — owner only | Built |
| Audience: public, friends, close friends, specific people; default friends | Built |
| Hide story from selected users; mute another user's stories | Built |
| Archive: automatic, owner only, private | Built |
| Mentions, links, location | Built |
| Multiple stories, "1 / 5" | Built |
| Own menu: delete, save, archive, insights, share | Built |
| Other menu: share, copy link, mute, report | Built |
| Ads, suggested stories, chains, public threads, influencer tools, dashboards, monetisation | Not built, as instructed |

## 2. The audience rules — pass

Verified in the database, impersonating three real accounts, under
`set local role authenticated` so row level security is actually in force.

| Rule | Result |
| --- | --- |
| Close friend sees a `close` story | Pass |
| Non-close friend does not | Pass |
| Hidden viewer sees nothing, even while on the close friends list | Pass — hiding beats being named |
| Stranger sees a `public` story | Pass |
| Mutual sees `friends`; non-mutual does not | Pass |
| Named person sees `custom`; unnamed does not | Pass |
| Author reads their own expired stories; nobody else can | Pass |

The archive assertion **failed on its first run**, and the failure was in the
test rather than the schema: `supabase db query` connects as a superuser, which
bypasses RLS entirely, so the check was asserting nothing. Re-run as
`authenticated`. Worth recording, because in that form it would have "passed"
against any policy at all, including none.

All probe rows were removed: 0 probe stories, 0 close friends, 0 hidden rows,
0 custom audience rows.

## 3. Desktop — pass

Chrome, 1920×897.

| Test | Result |
| --- | --- |
| Rail renders as a labelled list, You first | Pass |
| Ring state matches the data (`bg-line-strong` for a seen story, transparent for none) | Pass |
| Viewer opens from a circle | Pass |
| Story media loads through a signed URL | Pass |
| Header shows name, time ago, `@handle · 1 / 1` | Pass |
| Five reactions and the reply box render | Pass |
| Escape closes the viewer | Pass |
| Creator offers Camera and Gallery | Pass |
| Archive screen renders and says it is private | Pass |
| Archive is empty for an account with no expired stories | Pass — verified against the database rather than assumed; the two expired stories belong to other accounts, whose archives are private to them |
| No horizontal overflow | Pass |

## 4. Mobile — pass

Measured in a real 390×844 same-origin frame, not by scaling a screenshot.

| Test | Result |
| --- | --- |
| Horizontal overflow at 386px | None, on the chat list and in the open viewer |
| Story rail scrolls horizontally without the page moving | Pass |
| **Swipe down to close** | Pass — the viewer tracks the finger (60px, then 160px, scaling 1.00 → 0.96) and dismisses past the 110px threshold |
| **Hold to pause** | Pass — "Paused" appears while held and clears on release |
| **Hold is not also a tap** | Pass — releasing after a hold leaves the story where it was |
| **Tap left at the first story** | Pass — restarts rather than closing or erroring |
| **Tap right past the last story** | Pass — closes |
| Touch targets ≥ 44px | Pass **after a fix** — the viewer's ⋯ and Close were 40px; every other control already carried `touch-target` |

The 44px audit needed a correction of its own: `touch-target` adds the missing
pixels through an `::after` pseudo-element, so `getBoundingClientRect` reports
the drawn 40px box and flags controls that are in fact fine. Re-measured by
reading the pseudo-element's `min-width`, which showed the chat list's eight
apparent failures were all already correct and left two real ones, both mine.

## 5. Accessibility — pass

| Test | Result |
| --- | --- |
| Rail is a `<ul>` with `aria-label="Stories"` | Pass |
| Each circle announces owner, count and seen state, and says "close friends" when it is | Pass |
| Your circle says "Tap to view, hold to manage" | Pass |
| Viewer is `role="dialog"`, `aria-modal="true"`, labelled | Pass |
| Focus moves to Close on open, once | Pass |
| Progress bars are one labelled group — "Story 1 of 1" — not five separate bars | Pass |
| Every button labelled: Story options, Close, five named reactions, Like | Pass |
| Reply input labelled "Reply to Piuxxh" | Pass |
| Story image has real alt text ("Story by Piuxxh"), distinct from the avatar's | Pass |
| Escape closes; arrows move; space pauses | Pass (Escape verified in the browser; arrows and space are the same handler) |
| Typing in the reply box does not trigger playback keys | Pass — the handler returns early for `INPUT`/`TEXTAREA` |
| "1 / 5" is text as well as bars | Pass |
| Reduced motion | The tokens reduce every animation to 0.01ms globally; the FLIP open animation checks `prefers-reduced-motion` itself and is skipped |

## 6. Performance — pass

| Measure | Result |
| --- | --- |
| DOMContentLoaded | 201ms |
| Load | 253ms |
| Long tasks over 50ms | **0** |
| DOM nodes | 235 |
| JS heap | 69MB |
| Progress bar | `scaleX` on the compositor, written from a ref inside `requestAnimationFrame` — React renders once per *story*, not once per frame |
| Story media | Signed URLs with a one-hour life, so a rail of thumbnails does not go grey while somebody reads their chats |

The bar deliberately does not use React state for elapsed time. Sixty renders a
second of the header, caption, action row and image to animate a two-pixel bar
is how a story viewer stutters on the device it matters on.

## 7. What could not be verified here, and why

**The progress bar filling, and auto-advance.**

`requestAnimationFrame` does not run in a hidden tab. That is not a limitation
worked around — it is the reason the clock uses rAF, so a story does not run out
while nobody is looking. The browser this was tested through keeps its window in
the background, so rAF was suspended throughout: a freshly registered callback
fired **0 times in 800ms**, confirming it rather than inferring it.

So the bar's motion and auto-advance are unverified in the browser. What *was*
verified:

- The clock's arithmetic, in isolation: 5s of 60fps frames advances exactly
  once; 5s at 120fps behaves identically, so the timing is wall-clock and not
  frame-count.
- Everything the bar depends on other than frames: the labelled group, the
  segment count, the index, and the fill element receiving its initial
  `scaleX(0)`.

**This is the one thing worth a glance on your own screen**: open a story and
confirm the bar fills over about five seconds and moves to the next.

An earlier draft of this report would have said "the progress bar does not
move", which was measured in the same hidden tab and was not a finding about
the bar at all. It is recorded here because it nearly became a bug report about
working code.

## 8. Bugs found and fixed during testing

1. **Opening a story hung the tab.** The viewer marked a story seen in an effect
   keyed on the story; the context rebuilt the story object to record it; the
   new object re-fired the effect; which marked it seen again. React re-rendered
   as fast as it could. It never threw — it surfaced as a renderer that stopped
   responding to injected script. Fixed in three places: the patch returns the
   identical array when nothing changed, and both the viewer's effects and the
   clock key on the story's **id** rather than its object identity.

2. **Returning to a backgrounded tab would eat the queue.** rAF stops while
   hidden, so the first frame back carries the entire hidden duration — two
   minutes away is a single 120,000ms delta, which completes the current story
   and every story after it in one frame, leaving an empty rail with everything
   marked seen. Deltas are clamped to 250ms: a frame longer than that did not
   happen, the clock was suspended. Verified as arithmetic — unclamped, the
   two-minute case advances immediately; clamped, it resumes a quarter of the
   way through, which is correct.

3. **Two 40px touch targets** in the viewer's header.

## 9. Deliberate decisions, stated rather than hidden

- **Video skips the editor.** `SnapEditor` composites onto a canvas from a still
  image; drawing on video means per-frame compositing and re-encoding, which is
  a different pipeline and not a flag on this one. Caption, place, link and
  audience still apply to a video story. An honest gap beats tools that appear
  and silently do nothing.

- **Sharing sends a link, never the media.** A copy would outlive the story,
  which is the one thing a story is not, and it would route round the audience
  entirely — bytes handed to somebody carry no rule with them. A close-friends
  or specific-people story cannot be shared at all: it was addressed, and
  passing the address on is not the sender's to do. That is also why there are
  no repost chains; there is nothing to re-share but the same link anybody
  could have sent.

- **Reporting a story routes to the profile**, where the reasons list, the sheet
  and the block-as-well follow-up already exist. A second reporting flow would
  be a second set of reasons to keep in step with the first.

- **Muting is filtered in the client, everything else at the database.** Muting
  is the viewer's own preference about a story they are perfectly entitled to
  see; audience is a rule about who may see it at all, and that belongs where it
  cannot be edited around.

- **The archive is a query, not a table.** An expired story is the same row it
  always was. Copying it somewhere on expiry needs a job, and a job that has not
  run yet is an archive with holes in it.

- **Stickers are a strip, not the full picker.** The picker is a tall panel with
  search and categories; over a picture you are decorating it would cover the
  thing you are working on.

- **Emoji and stickers are placed at a fixed size.** Pinch-to-resize is a real
  gap, not a decision — it is worth adding, and it was not part of the spec.

- **Private profiles: architecture prepared, not implemented**, as instructed.
  `can_see_story()` is where a `private` audience rule would go; it needs no new
  concept, only another branch.

## 10. Known gaps

- The progress bar and auto-advance are unverified in a browser — see §7.
- Green close-friends and gradient unseen rings are verified as *code paths* and
  by the audience tests, but no account in the test data currently has an unseen
  or close-friends story, so the two ring states have not been seen rendered.
- Video stories have not been posted end to end; no video was to hand.
- Emoji and stickers cannot be resized once placed.
- `onForward` in the chat remains a no-op. Unrelated to this module, still open.

## 11. Verdict

Desktop passes. Mobile passes, including all four gestures. Accessibility
passes. Performance passes — zero long tasks. Three bugs were found and all
three are fixed, one of which made the whole viewer unusable.

The module is not yet complete: §7 and §10 list what has not been seen working.
The single highest-value check is the one this environment cannot do — open a
story and watch the bar fill.
