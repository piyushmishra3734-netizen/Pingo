# PINGO — Product Experience Review

**Reviewer role:** Product Design / UX Architecture
**Date:** 28 July 2026
**Build reviewed:** `https://pingochat.pages.dev` @ `2090bc4`
**Method:** Ten passes over the shipped build, experienced as a user.

> **No code was changed.** This is a design roadmap.

---

## 0. How this review was conducted, and what it can and cannot claim

I navigated the product as a user: opened every tab, every sheet, every menu,
sent a real Ping, opened a story, walked the camera flow end to end, drove
gestures with real pointer events, toggled dark mode, and measured the layout at
four viewport widths. Where behaviour needed explaining, I inspected the
implementation **afterwards**, to confirm what I had already observed — never
instead of observing.

**What I could not experience, stated plainly:**

- **Motion, at frame rate.** Chrome kept its window backgrounded for the entire
  session, which suspends `requestAnimationFrame`. I verified this rather than
  assumed it: a freshly registered callback fired **0 times in 1000ms**.
- So instead of guessing, I measured the **actual computed transitions on real
  elements in real states** — property, duration, easing. That is much stronger
  than reading design tokens, and it is what Pass 3 is built on. But I have not
  *watched* a single animation play. **Every judgement about how motion feels is
  a judgement about its specification.** Re-doing Pass 3 on a real device is the
  highest-value follow-up to this document.
- **A received Ping opened by its recipient** (needs a second account).
- **The live camera preview** (no camera on this machine).
- **Onboarding and auth** — reviewed only in passing; the account already
  existed. Scored as "not assessed" rather than guessed.

---

## 1. Executive summary

PINGO is **well above average for its stage**, and the gap between it and the
products in the brief is not features. It is *finish*: things that arrive
without motion, lists that are not grouped, screens that do not fit their
container, and a dark mode that is a token swap rather than a design.

**The six findings that matter most:**

| # | Finding | Priority |
| --- | --- | --- |
| 1 | The desktop layout is a phone in a window — ~75% of the screen unused, chat bubbles a metre apart | **P0** |
| 2 | The whole product animates at **one duration (0.12s)**; there is no motion hierarchy in practice | **P0** |
| 3 | Dark mode fails contrast on incoming bubbles and the wordmark | **P0** |
| 4 | Calls is eleven identical rows; missed calls are indistinguishable | **P0** |
| 5 | "Communities" contains contacts | **P0** |
| 6 | No layout between 768–1023px — tablets get the phone layout | **P1** |

**The single idea worth building the company around:** the sender-controlled
view limit. Nobody else lets the *sender* choose permanence per message. It is
currently presented as three text buttons.

---

# PASS 1 — Overall product flow

**Question asked:** can a new user form a correct mental model, and can a
returning user do the thing they came to do in the fewest moves?

### 1.1 The product has three creation flows that begin identically

Camera → Ping, Camera → Story, and Chat → attach photo all start from a camera
and diverge only at the end. A user who wants to "send a picture to Baani" has
three routes with different capabilities, and nothing tells them which is which
until they have already committed.

**Item F-1 · Camera destination is decided last, invisibly**
- **Current:** You shoot, filter, edit, and *then* discover this screen offers
  both "Send to" and "Add to story".
- **Suggested:** Show the destination as a persistent, changeable chip from the
  moment of capture — "→ Ping" / "→ Story" — so the user always knows what they
  are making. Not a mode switch up front (that adds a decision); a visible,
  reversible label.
- **Why:** Reduces the "what am I even making?" pause that currently sits in the
  middle of the flow.
- **Impact:** Fewer abandoned captures.
- **Priority: P1**

**Item F-2 · Chat-attached photos and Pings are near-duplicates**
- **Current:** The composer's `+` offers a photo with a "View once" switch. The
  camera offers a Ping with 1 / 2 / Keep-in-chat. These are the same concept
  with two different controls and two different vocabularies.
- **Suggested:** Unify on the Ping control everywhere a picture is sent. One
  concept, one control, one word.
- **Why:** Two names for one idea is the most reliable way to make a product
  feel bigger than it is and less coherent than it is.
- **Priority: P1**

### 1.2 First-run has no moment of orientation

There is no coach mark, no empty-state tour, and several of the best
interactions (long-press the story ring, long-press a chat row, hold to pause)
are entirely undiscoverable.

**Item F-3 · Zero discovery for gesture-only features**
- **Suggested:** A single, one-time, dismissible hint per surface — shown once,
  never nagging. Ideally the *first* time the surface is used, not on install.
- **Priority: P1**

### 1.3 Flow scorecard

| Flow | Taps to complete | Verdict |
| --- | --- | --- |
| Send a text | 2 | Optimal |
| Send a Ping | 6 (gate → source → filter → edit → limit → send) | **Two too many** — the filter and edit stages are mandatory pass-throughs |
| Post a story | 7 | **Too many** — see S-4 |
| Start a call | 2 | Good |
| Find a person | 3–4 | Acceptable, but three different search boxes |

**Item F-4 · The camera has two mandatory pass-through stages**
- **Current:** Every capture must traverse the filter screen and the editor,
  even when the user wants neither. Two taps of "Next" on the happy path.
- **Suggested:** Capture should land directly on the send screen, with filter
  and edit available as entry points from there. The fast path becomes
  capture → choose → send.
- **Why:** The brief's stated objective is "sending a Ping feels effortless".
  Two obligatory screens is the opposite of effortless, and the majority of
  sends will use no filter and no edit.
- **Impact:** High — this is the core loop.
- **Priority: P0**

---

# PASS 2 — Navigation & information architecture

### 2.1 The desktop shell

**Item N-1 · Desktop is a phone in a window** *(P0)*
- **Current:** Measured — at 1440px the list is 383px and the thread pane takes
  the remaining ~1050px. Primary navigation is a floating pill at the bottom
  centre, a phone pattern, unchanged. On Chats with nothing selected, ~75% of
  the viewport is an empty panel.
- **Suggested:** A left icon rail (56–72px) above ~1024px replacing the floating
  dock; list widened to 380–420px; thread constrained (see N-2).
- **Why:** The dock costs ~90px of vertical space on every screen and puts
  navigation as far from the cursor as physically possible.
- **Impact:** The difference between "a mobile app I opened on my laptop" and "a
  product with a desktop version".
- **Reference:** Rail patterns are near-universal on desktop; the *reason* is
  cursor proximity, not fashion.

**Item N-2 · The chat thread has no maximum measure** *(P0)*
- **Current:** Incoming bubbles hug the far left, outgoing the far right, up to
  ~1050px apart.
- **Suggested:** Centre the thread at 680–760px; cap bubbles at ~65% of it. Keep
  the background full-bleed so it reads as typography, not a card.
- **Why:** Conversation is read as one vertical thread. The eye should never
  travel horizontally between turns.
- **Priority: P0**

**Item N-3 · There is no tablet layout** *(P1 — newly measured)*
- **Current:** Measured at four widths. Two-pane begins at **1024px**. At 768px
  — iPad portrait, and any half-screen window — the user gets the *phone*
  layout: one enormous single column with a floating dock.
- **Suggested:** Two-pane from 768px. Optionally a compact rail from 900px.
- **Why:** 768–1023 is not an edge case; it is every tablet in portrait and
  every side-by-side window on a laptop.

### 2.2 Destinations

**Item N-4 · "Communities" contains contacts** *(P0)*
- **Current:** The tab shows a "CONTACTS" list with a "Message" link per row. No
  communities exist anywhere.
- **Suggested:** Either rename to "People" and design a real directory
  (alphabetical index, online-first, search), or build the feature and move
  contacts into search / new-chat.
- **Why:** A nav label that does not describe its contents is the most damaging
  IA error — it teaches users the app is unreliable and they stop exploring.

**Item N-5 · Five destinations, one of which is a camera** *(P2)*
- **Current:** Chats · Calls · Camera · Communities · Profile.
- **Observation:** Camera is an *action*, not a place. It is the only tab you
  cannot "return" to meaningfully. Consider promoting it out of the tab set into
  a primary action (a centre button that is visually distinct, or a swipe from
  the chat list), which is also how it earns the instant-open the brief asks for.
- **Why:** Mixing places and actions in one bar makes the bar harder to learn.

**Item N-6 · Header patterns differ on every screen** *(P1)*
- Chats: wordmark + 4 icons. Calls/Communities: bare title. Notifications: back
  chevron + title. Profile: `ScreenHeader` with action slot.
- **Suggested:** One header component with optional slots. Four patterns for one
  job is the clearest possible signal of a design system not yet enforced.

**Item N-7 · Content width contradicts itself screen to screen** *(P1)*
- Measured: Calls ≈510px centred · Communities ≈510px · Notifications
  **full-bleed 1568px** · Profile `max-w-2xl` · Thread unconstrained.
- **Suggested:** One shared container primitive with two or three sizes.

**Item N-8 · Search exists three times with three behaviours** *(P2)*
- Chat list search filters rows; Communities search filters contacts; sheet
  search filters people. None share a component or a keyboard behaviour, and
  there is no global search.
- **Suggested:** One search primitive, and a genuine global search (people +
  messages + media) reachable from the header magnifier.

### 2.3 The story rail's placement

**Item N-9 · The rail is the fourth thing down** *(P1)*
- **Current:** wordmark → search → filter chips → Stories → Pinned → chats.
- **Suggested:** Rail directly under the header, above search; collapsing into
  the header on scroll.
- **Why:** Stories expire in 24h; conversations do not. Putting the perishable
  content below two rows of controls inverts urgency.

---

# PASS 3 — Motion and animation

**This pass is built on measured computed styles from live elements, not on
reading tokens.** See §0 for why I could not watch them play.

### 3.1 The central finding: the product has one duration

Measured on the chat list:

| Element | Transitioned property | Duration | Easing |
| --- | --- | --- | --- |
| Story circle | `transform, translate, scale, rotate` | **0.12s** | `cubic-bezier(.32,.72,0,1)` |
| Conversation row | colour/background only | **0.12s** | same |
| Dock item | colour/background only | **0.12s** | same |
| Header icon | `all` | **0.12s** | same |
| Search field | `all` | **0s** | `ease` |

**Item M-1 · Everything animates at 0.12s** *(P0)*
- **Current:** Four duration tokens exist (`instant/quick/base/slow`) but the
  interactive surface uses `instant` almost universally. 120ms is right for a
  colour change and too fast for anything that *travels* — at 120ms a movement
  reads as a jump, not a motion.
- **Suggested:** Enforce a duration scale by *purpose*, not by convenience:
  colour/opacity 120ms · small transforms 200ms · sheets and panels 280–320ms ·
  full-screen transitions 340–400ms.
- **Why:** Perceived quality in motion comes from *hierarchy* — big things move
  slower than small things. A single duration flattens that, and the result
  reads as "fast but cheap" rather than "fluid".
- **Impact:** This is the highest-leverage motion change available, because it
  affects every interaction simultaneously.

**Item M-2 · The search field has `transition: all 0s`** *(P1)*
- **Current:** Focus state snaps with no transition at all — the one control the
  user types into is the one with no feedback.
- **Suggested:** 160ms on border and background; a subtle 1.01 scale is
  optional but the border must ease.

**Item M-3 · Conversation rows transition colour only** *(P1)*
- **Current:** No transform on press. Tapping a row produces a background change
  and nothing physical.
- **Suggested:** `active:scale-[0.99]` with a 120ms transform, plus an origin-
  aware ripple or wash on touch. The story circles already do this correctly —
  the rows should match.
- **Why:** Touch interfaces need physical acknowledgement. The rows are the most
  tapped element in the product and currently feel inert.

### 3.2 The missing motion vocabulary

There is no rule connecting *meaning* to *motion*. Proposed:

| Meaning | Motion | Currently |
| --- | --- | --- |
| Something arrived | rise 8px + fade, 220ms | instant |
| Something left | scale 0.96 + fade, 180ms | instant |
| Something moved | FLIP + spring | instant |
| Going deeper | shared element | some screens |
| Coming back | exact reverse of entry | generic |
| Something waits | slow breathing loop | none |
| Something succeeded | spring overshoot | Ping only |
| Something failed | 2-cycle shake, 6px | none |

**Item M-4 · Nothing arrives with motion** *(P0)*
- Messages appear. Rows re-sort instantly. Notifications appear. Story rings
  change state instantly.
- **Suggested:** Implement "arrived" and "moved" from the table above first —
  they cover 80% of the felt difference.

**Item M-5 · Everything is duration-based; nothing is spring-based** *(P1)*
- **Current:** All motion is duration + cubic-bezier. The single exception is
  the story viewer's swipe-down, which tracks the finger.
- **Suggested:** Anything the user *directly manipulates* should be spring-
  driven so it carries gesture velocity: sheets, drags, dismissals, the crop
  handles, the story dismissal. Duration-based motion is correct for things the
  system initiates.
- **Why:** A sheet that closes in a fixed 280ms regardless of whether you flicked
  it or nudged it feels like a slideshow. Velocity preservation is most of what
  "premium" means in motion.

**Item M-6 · Reduced-motion disables rather than substitutes** *(P2)*
- **Current:** The global rule reduces every animation to 0.01ms.
- **Suggested:** Substitute opacity-only transitions instead of removing motion
  entirely, so state changes remain *legible* to users who need reduced motion.
  Losing all transition can make changes harder to follow, not easier.

### 3.3 Specific transitions worth building

**Item M-7 · The dock has no travelling indicator** *(P2)*
- A pill or dot that springs between icons over ~260ms with slight overshoot,
  plus a scale-pop on the newly active glyph. This animation would fire more
  than any other in the product.

**Item M-8 · No screen-to-screen continuity** *(P1)*
- Tab changes are content swaps. Going into a chat is a swap. Only the story
  viewer has a shared-element transition (from the rail — and it is genuinely
  good, using FLIP with a border-radius morph).
- **Suggested:** The story viewer's technique is already proven in this codebase.
  Apply it to: chat row → thread (avatar as the shared element), post tile →
  post viewer, profile avatar → full-screen.

---

# PASS 4 — Micro-interactions

**Item MI-1 · No hover states worth the name on desktop** *(P1)*
- **Current:** Rows get a background tint. Buttons get a tint. Nothing lifts,
  nothing reveals, nothing previews.
- **Suggested:** On hover, conversation rows reveal quick actions (pin, mute,
  archive) on the right — replacing the need to discover swipe on desktop
  entirely. Avatars could show a presence tooltip. This is free functionality on
  a surface that currently has none.

**Item MI-2 · The send button does nothing when pressed** *(P1)*
- **Current:** Sending is the most repeated action in the product and has no
  animation at either end.
- **Suggested:** The composer text should *become* the bubble — a shared-element
  morph into place, settling with a spring. The button itself scales and the
  icon rotates slightly on press.
- **Impact:** Highest of any single micro-interaction, purely by frequency.

**Item MI-3 · The like/heart has no reward** *(P2)*
- **Current:** The story like and post like fill with colour.
- **Suggested:** Scale overshoot to 1.25 and settle; optional particle burst on
  first like only (never repeated — novelty that repeats becomes noise).

**Item MI-4 · Reactions land silently** *(P2)*
- **Current:** A reaction pill appears near a bubble.
- **Suggested:** Overlap the pill onto the bubble's lower edge so "attached to
  this" is unambiguous; bounce it in on arrival; tap → a sheet of who reacted.

**Item MI-5 · Long-press has no progress feedback** *(P2)*
- **Current:** A 480ms hold fires with a haptic at the end. Until then, nothing.
- **Suggested:** A radial or ring progress that fills during the hold, so the
  user learns the gesture *while performing it* — and can abort knowingly.
- **Why:** This single change makes three otherwise-undiscoverable features
  self-teaching.
- **Priority: P1** — this is the cheapest discovery fix in the document.

**Item MI-6 · Typing indicator is absent from the thread** *(P1)*
- Present in the list, absent where the conversation actually is.
- **Suggested:** A three-dot bubble in the message flow, entering with the same
  motion a real message uses, so the thread visibly makes room for what is
  coming.

**Item MI-7 · Pull-to-refresh is absent everywhere** *(P2)*
- **Suggested:** Add it with a PINGO-specific indicator — the `PingoDot`
  stretching and settling. Honour the gesture even when data is already live: a
  400ms confirmation beat. It is now a *reassurance* gesture more than a data one.

**Item MI-8 · Filter chips do not preview** *(P1)*
- **Current:** Fourteen text chips: "None, Saturation, Contrast, Vignette…".
- **Suggested:** Chips become live thumbnails of the user's own photo with each
  filter applied. Better still: swipe horizontally over the image to move
  between filters, with no chips at all.
- **Why:** Text names for visual effects force blind trial. A thumbnail answers
  the question before the tap.

**Item MI-9 · No haptic vocabulary** *(P2)*
- **Current:** One `navigator.vibrate(8)` on long-press.
- **Suggested:** A small, consistent set: selection tick (5ms) · send (10ms) ·
  success (double 8ms) · error (20ms). Used identically everywhere.

**Item MI-10 · Multi-select gives no persistent summary** *(P2)*
- Ping recipients: selected people are only visible if you scroll back to them.
- **Suggested:** Selected avatars collect into a strip above the Send button,
  springing in as they are chosen.

---

# PASS 5 — Visual polish

### 5.1 Dark mode is a token swap, not a design *(P0 — newly found)*

Toggled and inspected directly.

**Item V-1 · Incoming bubbles are near-black on near-black**
- **Current:** Body background `rgb(12,13,17)`. Incoming bubbles sit barely
  above it — the bubble edge is almost imperceptible. Outgoing bubbles use the
  brand gradient and look excellent.
- **Consequence:** The conversation becomes visually one-sided: your own
  messages are vivid, theirs nearly disappear. That inverts the equality a
  conversation should have.
- **Suggested:** In dark mode, elevation must go *lighter*, not darker. Incoming
  surface should be ~`#1E2027`–`#24262E` against a `#0C0D11` page, with a
  1px lighter hairline.
- **Priority: P0**

**Item V-2 · The wordmark is nearly invisible in dark mode**
- **Current:** "PINGO" renders dark-grey on near-black in the header.
- **Suggested:** Invert the wordmark for dark. This is the first thing on the
  screen and currently the least legible.
- **Priority: P0**

**Item V-3 · Avatar monograms do not invert**
- **Current:** Monogram avatars keep a light lavender fill with light text —
  in dark mode they are the brightest objects on screen, brighter than the
  content.
- **Suggested:** Deepen the fill and lighten the glyph for dark.

**Item V-4 · Surfaces flatten in dark mode**
- The list panel and the empty thread panel become the same near-black; the
  divider disappears. In light mode they are clearly differentiated.
- **Suggested:** Define an explicit elevation ramp for dark (page → surface →
  raised → overlay) rather than reusing light-mode relationships.

### 5.2 Light mode

**Item V-5 · Avatar monogram initials follow no rule** *(P2)*
- Observed: "DB", "SM", "AM", "ZT", "PM" (two letters) alongside "A", "I"
  (one letter). It appears to depend on whether a surname exists — which reads
  as inconsistency rather than intent.

**Item V-6 · Icon sizes span 11–26px with no visible scale** *(P2)*
- **Suggested:** Three sizes only: 16 inline · 20 control · 24 primary.

**Item V-7 · The glass treatment is applied inconsistently** *(P2)*
- Header, dock and some sheets use `glass-surface`; other overlays use flat
  fills. Liquid Glass is stated as the design language, so its absence in some
  overlays reads as unfinished rather than as restraint.

**Item V-8 · Empty-state voice varies** *(P2)*
- "Choose someone from the list" (instructive) · "No messages yet" (declarative)
  · "A PINGO profile holds three posts. Theirs are still to come." (warm, and
  the best of the three).
- **Suggested:** Standardise on the warm register — it is genuinely good writing
  and it is what gives the product a personality.

**Item V-9 · The empty thread pane is a missed brand moment** *(P2)*
- Currently a grey "P" and two lines. On desktop this panel is visible more than
  any other single surface. It could carry something quietly characterful.

---

# PASS 6 — User psychology & emotional experience

### 6.1 What the product currently makes a user *feel*

| Moment | Intended feeling | Actual |
| --- | --- | --- |
| Opening the app | recognised | neutral — no personal greeting or state |
| Sending a message | connection | nothing; it just appears |
| Capturing a Ping | delight | a flash and a screen change |
| Sending a Ping | satisfaction | **good** — the confirmation works |
| Receiving a Ping | anticipation | a static card |
| Opening a story | immersion | **good** — the FLIP is genuinely nice |
| A story ending | closure | abrupt |
| Being liked | warmth | a colour change |

**Item PSY-1 · The product has no moment of arrival** *(P1)*
- **Current:** Opening the app shows a list. There is no acknowledgement of the
  person using it.
- **Suggested:** Not a greeting banner — something subtler. The wordmark could
  settle into place on cold start; unread state could arrive rather than being
  pre-rendered, so the user *sees* what is new appear.
- **Why:** The first 400ms sets the emotional tone for the session.

**Item PSY-2 · Anticipation is unused, and it is the strongest lever available** *(P1)*
- **Current:** An unopened Ping is a static card. Ephemeral media earns its
  attention through anticipation, and nothing here builds any.
- **Suggested:** The unopened card breathes — a slow, subtle gradient drift.
  Opening is a circular reveal from the tap point rather than a fade. Expiry is
  visible: the card desaturates and collapses.
- **Impact:** Higher open rates *and* a more distinctive product, achieved
  without any dark pattern — the user is not pressured, only invited.

**Item PSY-3 · Loss-aversion is currently the retention mechanic** *(P2)*
- **Current:** A 🔥 streak with a day count. This is the one mechanic in the
  product that works by fear of losing something.
- **Suggested:** Invert it — see INNOVATION 3. Retention through delight rather
  than through loss is explicitly what the brief asks for, and the streak as
  built is the one thing working against that.

**Item PSY-4 · Effort is invisible** *(P2)*
- Nothing acknowledges that the user *made* something. A photo they filtered,
  edited and captioned is sent with the same ceremony as the word "ok".
- **Suggested:** Scale the send confirmation to the effort invested — a Ping
  with edits gets a slightly richer send animation than a bare one.

**Item PSY-5 · Privacy is the product's soul and is never felt** *(P2)*
- The privacy model is genuinely rigorous — enforced at the database, not the
  client. The user never experiences any of it.
- **Suggested:** Make it *visible* at the moments it applies: the view-limit
  ring (INNOVATION 1); a brief lock animation when a story goes to close friends
  only; the archive's "only you can see this" given more warmth than a caption.
- **Why:** People do not fall in love with privacy policies; they fall in love
  with feeling safe. That feeling has to be designed.

---

# PASS 7 — Innovation opportunities

Not parity. Things PINGO can do *because of choices it has already made*.

**INNOVATION 1 · The depleting view ring** *(P1 — the flagship)*
- PINGO is the only product where the sender chooses permanence per message.
- **The idea:** the Ping card carries a ring that depletes as views are spent.
  The recipient watches it drain as they look. **The sender watches the same
  ring drain, live, in their own thread** — the first time either party has ever
  been able to *see* attention being spent.
- **Why nobody else can:** it requires per-message sender-chosen limits, which
  only PINGO has.
- **Emotional effect:** turns a privacy setting into a shared moment.

**INNOVATION 2 · The three-post shelf** *(P2)*
- Three permanent posts is a genuinely novel constraint currently rendered as a
  grid that looks like it ran out of content.
- **The idea:** a curated *shelf* — three cards with depth, reorderable by drag.
  The act of choosing what stays becomes the feature. "What are your three?"
  becomes a question people ask each other.

**INNOVATION 3 · A streak that cannot punish you** *(P2)*
- **The idea:** replace the number with a small generative shape unique to each
  pair, which gains detail with sustained conversation and **pauses** — never
  resets — when life happens. You cannot lose it; you can only grow it.
- **Why:** it delivers the retention benefit of streaks with none of the
  coercion, which is precisely the brief's stated goal.

**INNOVATION 4 · Story replies remember what they answered** *(P1 — data already exists)*
- Story replies already land as messages tagged with their story. **Nothing
  renders the tag.**
- **The idea:** show the story thumbnail inline above the reply, which expires to
  a soft placeholder after 24h — "you said this about something that is gone
  now" is a uniquely PINGO artefact, and it costs only rendering.

**INNOVATION 5 · Ambient presence in the composer** *(P3)*
- When the other person is typing, the composer's own edge breathes with a faint
  gradient. Presence without a separate indicator taking up space.

**INNOVATION 6 · Capture-to-recipient continuity** *(P2)*
- On send, the picture physically *flies* toward the recipient's avatar and the
  tick lands after. Answers "where did it go?" visually and makes multi-send
  legible — three copies, three destinations.

**INNOVATION 7 · A single "quiet" control** *(P3)*
- Mute exists per chat, per story author, per notification type, in three
  different places. **The idea:** one global "quiet until…" with a warm,
  physical control — the app visibly calms (desaturates slightly, motion
  softens). A wellbeing feature that is felt rather than configured.

---

# PASS 8 — Edge cases

**Item EC-1 · Long names are untested in several places** *(P2)*
- Rows truncate correctly; the story rail shows only first names; the Ping
  bubble is fixed-width. But the chat header, the call rows and the profile
  name have no visible truncation strategy for a 40-character name.

**Item EC-2 · Zero-state of the story rail** *(P2)*
- With no stories from anyone, the rail is a single "+" circle under a "Stories"
  heading — a section header for one button. Consider hiding the heading, or
  turning the row into an invitation.

**Item EC-3 · One-message threads have a lot of empty space** *(P2)*
- The thread pane is bottom-aligned, so a single message floats above a large
  void on desktop. Consider vertically centring short threads.

**Item EC-4 · Failed sends have no queue or retry** *(P1)*
- **Current:** "That didn't send. Try again." The user must repeat the gesture.
- **Suggested:** The failed message stays in the thread greyed with a retry
  affordance on it, as every mature messaging product does. Currently a failed
  Ping loses the picture entirely — the most expensive possible failure.
- **Priority: P1** *(P0 for the Ping case specifically)*

**Item EC-5 · Offline is invisible** *(P1)*
- `ConnectionState` exists in the model with `offline`. No screen surfaces it.
- **Suggested:** A slim, non-blocking banner. Users blame the app for a bad
  network unless told otherwise.

**Item EC-6 · Signed media URLs expire at 1 hour** *(P2)*
- A session left open longer than an hour will silently start failing to load
  images. No refresh strategy observed.

**Item EC-7 · Expired story media in the archive** *(P2)*
- One archived story has media in a bucket it cannot be signed from; it will
  render as a broken tile. The archive needs a "no longer available" state.

**Item EC-8 · Very large recipient lists** *(P3)*
- The Ping recipient list is unvirtualised. Fine at current scale; will not be
  at 500 conversations.

**Item EC-9 · Rapid double-tap on send** *(P2)*
- Guarded by `busy`, correctly. But the button does not visually disable, so a
  user gets no feedback that their second tap was ignored.

---

# PASS 9 — Accessibility

**The baseline is genuinely strong** — verified live, not assumed: labelled
modals, correct tab semantics, focus moved into sheets and returned on close,
Escape closing the innermost surface, one labelled progress group announcing
"Story 1 of 5" rather than five bars, `aria-live` on view counters, 44px hit
areas via `touch-target`, and reduced-motion honoured globally. Most shipped
products do not reach this.

| # | Item | Priority |
| --- | --- | --- |
| **A-1** | **Story auto-advance cannot be paused by assistive tech.** A screen-reader user cannot finish a caption before the story moves on. This is the most serious accessibility issue in the product. | **P0** |
| **A-2** | **Colour is load-bearing in four places** — story ring state, missed calls, unread notification tint, delivery status. Each needs a non-colour signal (shape, icon, weight, text). | **P1** |
| **A-3** | **Dark-mode contrast fails on incoming bubbles** (V-1) — likely below 3:1 against the page. | **P0** |
| A-4 | Reduced-motion disables rather than substitutes (M-6) | P2 |
| A-5 | Search input is 24px internally — below comfortable target size | P2 |
| A-6 | No roving tabindex or type-ahead in the chat list | P2 |
| A-7 | Long-press features have no keyboard equivalent — the profile avatar's change/remove is reachable via Edit Profile, but the chat row's and story rail's are not | **P1** |
| A-8 | No skip-link past the story rail and filters to the conversation list | P2 |
| A-9 | Focus visibility in dark mode not assessed | P2 |

---

# PASS 10 — Final holistic review

### 10.1 What PINGO already is

A product with **a real point of view**: privacy enforced where it cannot be
edited around, a three-post profile that resists the infinite feed, Pings whose
permanence the sender controls, and writing that is warmer and more honest than
its competitors'. The engineering underneath is unusually careful.

### 10.2 What is holding it back

Not features. **Three systemic gaps**, each of which shows up on every screen:

1. **One duration.** Everything moves at 120ms, so nothing has hierarchy.
2. **No shared container.** Every screen makes its own width decision.
3. **Dark mode was derived, not designed.**

Fixing those three would raise the entire product at once — more than any
individual screen improvement in this document.

### 10.3 The thing to protect

The **sender-controlled view limit**, and the writing. Both are genuinely
differentiated and both are currently under-presented.

---

# 11. Screen scorecard

Scored 1–10. **Motion scores are scored against the *specification*** (see §0).

### Chat list
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 7 | Clean, well-spaced, good typography. Loses points for the buried rail and inconsistent timestamps. |
| UX Quality | 8 | Filters, pinning, favourites, swipe and selection are all well-considered. Genuinely strong. |
| Motion Quality | 4 | Rows re-sort instantly; no arrival motion; colour-only transitions at 120ms. |
| Emotional Delight | 5 | Streak flame and story rings carry personality; nothing else does. |
| Performance Perception | 9 | Fast, no long tasks, skeletons present. |
| Ease of Use | 8 | Everything is where you expect. |
| Premium Feel | 6 | Static. Correct but inert. |

### Chat thread
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 5 | Bubbles are good; the unconstrained width on desktop and the dark-mode contrast failure are serious. |
| UX Quality | 7 | Reply, react, edit, delete, attach all work well. No day dividers costs it. |
| Motion Quality | 3 | The most-used screen has the least motion. No send, arrive, or typing animation. |
| Emotional Delight | 4 | Sending — the core act — is unrewarded. |
| Performance Perception | 9 | Smooth, quick. |
| Ease of Use | 8 | Composer is clear and uncluttered. |
| Premium Feel | 5 | Held back by width and stillness. |

### Camera / Ping flow
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 7 | The send stage is well-organised; filter chips as text is the weak point. |
| UX Quality | 7 | Excellent recipient screen and view-limit concept; two mandatory pass-through stages cost it. |
| Motion Quality | 5 | The send confirmation is the best motion in the product; capture and stage changes have none. |
| Emotional Delight | 7 | The confirmation genuinely satisfies. Highest in the product. |
| Performance Perception | 8 | Filtering is fast; the busy state is honest. |
| Ease of Use | 6 | Six taps to send. |
| Premium Feel | 7 | Closest to the target. |

### Story viewer
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 8 | Clean, content-first, correct hierarchy. |
| UX Quality | 9 | Tap zones, hold, swipe-down, keyboard support, cross-author queue — genuinely complete. |
| Motion Quality | 7 | The FLIP open is the best transition in the product. No author-to-author transition. |
| Emotional Delight | 7 | Immersive. Lacks a closing beat. |
| Performance Perception | 9 | Ref-driven progress bar is the right architecture. |
| Ease of Use | 9 | Nothing to learn. |
| Premium Feel | 8 | The strongest screen in the product. |

### Story creator
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 6 | A form. Preview is small. |
| UX Quality | 5 | Seven steps for a casual act; audience picker is heavy for the common case. |
| Motion Quality | 3 | Step changes are swaps. |
| Emotional Delight | 3 | Posting a story should feel light; this feels like filing. |
| Performance Perception | 8 | Fine. |
| Ease of Use | 5 | Too many decisions before the reward. |
| Premium Feel | 5 | Functional. |

### Profile
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 8 | Well-composed; the three-post grid is clean; good spacing. |
| UX Quality | 8 | Stats, tabs, menus, sharing and privacy are complete and coherent. |
| Motion Quality | 5 | Animated counters are a nice touch; no shared-element transitions. |
| Emotional Delight | 6 | The empty-state writing is the best in the product. |
| Performance Perception | 9 | 138 nodes, no long tasks. |
| Ease of Use | 8 | Clear. |
| Premium Feel | 7 | Good, and one transition away from very good. |

### Calls
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 3 | Eleven identical rows; enormous side gutters; no sections. |
| UX Quality | 2 | Cannot answer the one question it exists to answer: did I miss a call? |
| Motion Quality | 2 | None. |
| Emotional Delight | 2 | None. |
| Performance Perception | 8 | Fast. |
| Ease of Use | 3 | Unscannable. |
| Premium Feel | 2 | The weakest screen in the product. |

### Communities
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 5 | Tidy rows; the repeated blue "Message" link creates a distracting stripe. |
| UX Quality | 2 | The label does not describe the contents. |
| Motion Quality | 2 | None. |
| Emotional Delight | 2 | None. |
| Performance Perception | 8 | Fast. |
| Ease of Use | 4 | Works, but not where anyone would look for it. |
| Premium Feel | 3 | Reads unfinished. |

### Notifications
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 4 | Full-bleed rows at 1568px look like a layout bug. |
| UX Quality | 6 | Inline Accept/Ignore is good. No grouping, no mark-all-read. |
| Motion Quality | 2 | None. |
| Emotional Delight | 5 | "Piuxxh opened your Ping" is a genuinely lovely line. |
| Performance Perception | 9 | Instant. |
| Ease of Use | 6 | Fine at this volume; will not scale. |
| Premium Feel | 4 | Let down by layout. |

### Story rail
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 8 | The three ring states are well-judged; the green close-friends treatment is elegant. |
| UX Quality | 7 | Ordering is right. Long-press is undiscoverable. |
| Motion Quality | 5 | Circles have transform transitions — one of the few places that does — but at 120ms. |
| Emotional Delight | 7 | Rings carry real personality. |
| Performance Perception | 9 | Good. |
| Ease of Use | 8 | Immediately understood. |
| Premium Feel | 7 | Strong. |

### Settings
| Dimension | Score | Why |
| --- | --- | --- |
| Visual Quality | 7 | Conventional, tidy, well-grouped. |
| UX Quality | 8 | Search over settings is a genuinely good touch. |
| Motion Quality | 3 | None. |
| Emotional Delight | 3 | Utilitarian, appropriately. |
| Performance Perception | 9 | Fast. |
| Ease of Use | 8 | Clear. |
| Premium Feel | 6 | Fine. |

### Onboarding / Auth — **not assessed**
Reviewed only in passing; the session was already authenticated. Given that
first-run sets the tone for everything above, **this should be the first target
of the next review pass.**

### Aggregate

| Screen | Mean |
| --- | --- |
| Story viewer | **8.1** |
| Profile | 7.3 |
| Story rail | 7.3 |
| Camera / Ping | 6.7 |
| Chat list | 6.7 |
| Settings | 6.3 |
| Chat thread | 5.9 |
| Story creator | 5.0 |
| Notifications | 5.1 |
| Communities | 3.7 |
| Calls | **3.1** |

**Product mean: 5.9.** The spread (3.1 → 8.1) is the real story: PINGO is not
uniformly mid — it is *excellent in places and unfinished in others*, and the
unfinished screens are dragging the perception of the good ones down with them.

---

# 12. Roadmaps

Ordered by **user impact**, not by implementation cost.

## Roadmap 1 — Quick wins (hours)

| # | Change | Impact |
| --- | --- | --- |
| Q-1 | Fix dark-mode incoming bubble contrast (V-1) | Fixes a legibility failure for every dark-mode user |
| Q-2 | Invert the wordmark in dark mode (V-2) | The first thing on screen becomes legible |
| Q-3 | Constrain the chat thread to a readable measure (N-2) | Biggest single visual improvement available |
| Q-4 | One shared content container across Calls / Communities / Notifications (N-7) | Removes the strongest "unfinished" signal |
| Q-5 | Give the search field a focus transition (M-2) | The typed-into control gains feedback |
| Q-6 | Add `active:scale` to conversation rows (M-3) | The most-tapped element gains physicality |
| Q-7 | Missed calls in the danger tint; replace "0:00" with the outcome (K-2) | Makes the Calls screen answer its own question |
| Q-8 | Day section headers on Calls and Notifications | Removes most of the repetition |
| Q-9 | Rename "Communities" → "People" (N-4, option a) | Removes an IA lie in one word |
| Q-10 | Drop the repeated "Message" link; make rows tappable (CM-2) | Cleaner, and one fewer target |
| Q-11 | Move the story rail above search (N-9) | Perishable content gets priority |
| Q-12 | Offline banner (EC-5) | Stops users blaming the app for the network |

## Roadmap 2 — Medium improvements (days)

| # | Change | Impact |
| --- | --- | --- |
| M-1 | **Establish the duration scale** — 120/200/300/380 by purpose (M-1) | Raises every interaction simultaneously |
| M-2 | Message grouping in the thread (T-1) | Threads look considerably more refined |
| M-3 | Send + arrive motion, with the composer→bubble morph (MI-2, M-4) | The most repeated action gains a reward |
| M-4 | Typing bubble in the thread (MI-6) | Cheapest emotional win available |
| M-5 | Sticky day dividers (T-3) | Answers "when was this?" |
| M-6 | Collapse consecutive calls into grouped rows (K-1) | Turns an unusable screen into a useful one |
| M-7 | Long-press progress ring (MI-5) | Makes three hidden features self-teaching |
| M-8 | Filter chips → live thumbnails (MI-8) | Filter usage should rise sharply |
| M-9 | Capture lands on the send screen; filter/edit become optional (F-4) | Removes two taps from the core loop |
| M-10 | Failed-send retry in place (EC-4) | Stops the most expensive failure losing a photo |
| M-11 | Story auto-advance pause for assistive tech (A-1) | Accessibility blocker |
| M-12 | List reorder FLIP (C-2) | The list stops feeling like it refreshes |
| M-13 | Hover-revealed row actions on desktop (MI-1) | Free functionality on an unused surface |
| M-14 | Two-pane from 768px (N-3) | Tablets stop getting the phone layout |
| M-15 | Simplify story posting to one primary action (S-4) | More stories posted |

## Roadmap 3 — Major product enhancements (weeks)

| # | Change | Impact |
| --- | --- | --- |
| L-1 | **The desktop shell** — rail, three-column, proper density (N-1) | Transforms the desktop product |
| L-2 | **INNOVATION 1 — the depleting view ring** | Makes the product's core differentiator visible |
| L-3 | **A designed dark mode** with its own elevation ramp (V-1→V-4) | Half the user base experiences a different product |
| L-4 | Spring-based motion for all direct manipulation (M-5) | The largest contributor to "premium" |
| L-5 | Shared-element transitions throughout (M-8) | Continuity across the whole product |
| L-6 | **INNOVATION 4 — story replies that remember** | Unique artefact; data already exists |
| L-7 | Ping arrival: breathing card, circular reveal, visible expiry (PSY-2) | Higher open rates without dark patterns |
| L-8 | **INNOVATION 3 — the non-punishing streak** | Retention through delight, per the brief |
| L-9 | Communities, actually built (N-4, option b) | Fills the IA hole properly |
| L-10 | Global search across people, messages and media (N-8) | The missing primary navigation verb |
| L-11 | **INNOVATION 2 — the three-post shelf** | Makes the profile unmistakably PINGO |
| L-12 | Route-level code splitting | ~867KB single bundle; camera + QR loaded by everyone |
| L-13 | Onboarding review and redesign | Currently unassessed and sets the tone for everything |

---

## 13. Where to start

If one thing: **the duration scale (M-1)**. It is a day of work and it touches
every screen in the product.

If one screen: **Calls**. It scores 3.1 and it is the cheapest screen to make
good.

If one idea: **the depleting view ring**. It is the only thing in this document
that no competitor could copy without rebuilding their permission model.

---

## Appendix — Consolidated defect list

**Bugs**
- B-1 Dark mode: incoming bubbles fail contrast · **P0**
- B-2 Dark mode: wordmark near-invisible · **P0**
- B-3 Calls show "0:00" for calls that never connected, though the outcome exists in the data · **P0**
- B-4 "Communities" renders contacts · **P0**
- B-5 Chat list shows "Yesterday" and "Sun" concurrently — likely an off-by-one day boundary · P2
- B-6 `filterStill` swallows all errors and silently returns the unfiltered image — this is how a fully broken Bloom filter survived unnoticed · **P1** *(engineering)*
- B-7 Notifications full-bleed while sibling screens are constrained · P1
- B-8 Search field has `transition: all 0s` · P2
- B-9 Archived story with unsignable media will render as a broken tile · P2
- B-10 Avatar monogram initials follow no consistent rule · P2

**UI inconsistencies:** container widths (4 strategies) · header patterns (4) ·
row affordances (3) · icon scale (11–26px) · empty-state voice (3 registers) ·
glass applied inconsistently · sheet weight undifferentiated.

**UX inconsistencies:** swipe-down dismisses only 2 of 5 full-screen surfaces ·
long-press used on 3 surfaces with no discovery · search implemented 3 times ·
back behaviour differs by screen · Story and Ping diverge silently from the same
camera · mute lives in 3 places.

**Performance:** DCL 201–427ms · Load 253–537ms · **0 long tasks >50ms on every
screen measured** · 86–235 DOM nodes · 28–69MB heap · **~867KB / 248KB gzipped
single bundle — the one real issue** · images lack intrinsic dimensions ·
`backdrop-filter` used liberally and unprofiled on low-end hardware.
