# 06 — Accessibility & Inclusive Design

Part of the design system, not an appendix. Every screen built from
[01](./01-onboarding-auth.md)–[05](./05-components-responsive.md) must satisfy this
document.

---

## The premise

PINGO's entire claim is that it reduces stress. A product that is stressful to use
with a screen reader, at 200% type, or one-handed on a train has failed at its own
thesis for the people who need it most.

So accessibility here is not compliance. **It is the same goal as the rest of the
product, applied to more people.** Target: WCAG 2.2 AA as a floor, with the specific
additions below where AA is not enough for a messaging app.

---

## 1. Screen readers

### 1.1 The rule that governs everything else

**Every screen must be fully operable with the screen reader alone, in reading order,
without knowing where anything is on screen.**

That single requirement produces most of the specifics below.

### 1.2 Announcement contracts

Each recurring element has an exact announcement. These are contracts — a change to
one is a spec change, not an implementation detail.

| Element | Announces as |
| --- | --- |
| Conversation row | `"Anaya Sharma. Voice message. 11:31 AM. 2 unread."` — name, preview, time, unread. In that order, because that is the order of importance |
| Conversation row, typing | `"Anaya Sharma. Anaya is typing."` — replaces the preview, matching the visual rule |
| Own message bubble | `"You said: See you there. 11:30 AM. Read."` |
| Incoming bubble | `"Anaya said: Hey, where are we meeting? 11:30 AM."` |
| Bubble in a group | `"Alex said: …"` — author always spoken, even when the avatar is visually suppressed by clustering |
| Voice note | `"Voice message from Anaya, 12 seconds. Slider. Double tap to play."` |
| Reaction | `"Thumbs up from 2 people."` |
| Day divider | `"Today"` — as a heading, so heading navigation jumps between days |
| Unread badge | `"2 unread messages"` — never just `"2"` |
| Presence dot | `"Anaya is online"` / omitted entirely when offline |
| Filter chip | `"Unread, 2 items. Radio button. 2 of 4."` |
| Dock item | `"Chats. Tab 1 of 4. Selected."` |
| Toggle | `"Read receipts. Let others know when you've read their messages. Switch. On."` — label **and description**, because the description carries the reciprocity warning |
| Send button | `"Send message"` — changes to `"Record voice message"` when empty, and the change is announced |

### 1.3 Decorative vs meaningful

| Always `aria-hidden` | Always labelled |
| --- | --- |
| Icons beside a text label | Icon-only buttons |
| Avatar monograms (the name is adjacent) | Avatar images used as the only identifier |
| Presence dots on an already-labelled row | Standalone status indicators |
| The wordmark inside a labelled header | The wordmark as the app's only title |
| Skeletons | Loading regions (`role="status"`) |
| Dividers, scrims, background orbs | — |

**Rule:** if a screen reader would say the same thing twice, one of them is
decorative. Duplicate announcements are the most common defect in this area and the
most annoying to actually use.

### 1.4 Live regions

Used sparingly. An over-announcing app is unusable.

| Event | Politeness | Announces |
| --- | --- | --- |
| Incoming message, thread open | `polite` | `"Anaya: Hey, where are we meeting?"` |
| Incoming message, thread closed | **silent** | The OS notification does this job |
| Typing started | **silent** | Too frequent, too low-value. Available on demand by re-reading the header |
| Message sent | `polite` | `"Sent"` |
| Message failed | `assertive` | `"Message not sent. Double tap to retry."` |
| Connection lost | `polite` | `"You're offline. Messages will send when you reconnect."` |
| Connection restored | `polite` | `"Back online."` |
| Upload progress | **silent** | Percentage announcements every tick are torture. Announce only start and finish |
| Snackbar | `polite` | Its message, plus `"Undo available"` if it has an action |
| Search results | `polite` | `"7 results"` — the count only, debounced 600ms |

**Only failures are `assertive`.** Everything else waits its turn.

### 1.5 Structure and navigation

- One `<h1>` per screen, matching the visible title.
- Day dividers are headings, so heading navigation moves between days in a thread.
- Settings groups are `<section>` with the group caption as their heading.
- Landmarks: `banner` (header), `main`, `navigation` (dock), `contentinfo` where present.
- The thread is a `log` with `aria-relevant="additions"`.
- Message clustering is **visual only.** Each bubble is a separate focusable item with
  a complete announcement; a cluster is never merged into one node.

### 1.6 Gesture parity

Every screen-reader user must reach every action without a swipe gesture.

| Visual gesture | Screen-reader equivalent |
| --- | --- |
| Swipe row → pin/mute | Actions rotor on the row: Pin, Mute, Mark read, Archive |
| Swipe bubble → reply | Actions rotor on the bubble: Reply, React, Forward, Copy, Delete |
| Long press → context menu | The same actions rotor |
| Drag sheet → dismiss | `Dismiss` action, plus Escape on desktop |
| Pinch-zoom media | Zoom in / Zoom out actions, plus a `Zoom level` adjustable |

**Rule:** no action exists only as a gesture. This is also why every swipe has an
overflow-button equivalent on desktop ([05 Part B](./05-components-responsive.md#touch-and-pointer)).

---

## 2. Dynamic type

### 2.1 Scaling behaviour

The type scale ([00 § 5](./00-principles.md#5-typography-discipline)) scales **as a
ramp**, proportionally. Changing only `body` breaks the relationships the scale exists
to hold.

| User setting | Multiplier | `body` | `caption` | `h1` |
| --- | --- | --- | --- | --- |
| Smallest | 0.85× | 13.6 | 10.2 | 27.2 |
| Small | 0.92× | 14.7 | 11.0 | 29.4 |
| **Default** | 1.0× | 16 | 12 | 32 |
| Large | 1.15× | 18.4 | 13.8 | 36.8 |
| Larger | 1.3× | 20.8 | 15.6 | 41.6 |
| Largest | 1.5× | 24 | 18 | 48 |
| Accessibility sizes | up to 2.0× | 32 | 24 | 64 |

Implementation: `rem`-based sizing against a root that responds to the OS setting, so
one variable moves the whole system. Never hard-code `px` for text.

### 2.2 What must survive 200%

At 2.0× on a 360px screen, these must all still hold:

| Element | Behaviour at 200% |
| --- | --- |
| Conversation row | Grows vertically. Title and preview each wrap to **2 lines max**, then ellipsise. Row height is never fixed |
| Message bubble | Grows freely. Max-width stays a *percentage*, so it scales with the column |
| Chat header | Title wraps to 2 lines; the header grows. Call buttons stay 44px and never shrink |
| Dock | **Icons do not scale.** They are 24px glyphs in 48px targets — scaling them would consume the screen. Their labels are screen-reader only, so nothing truncates |
| Filter chips | Grow, and the row keeps scrolling horizontally |
| Settings row | Label and description wrap freely. Toggles do **not** scale |
| Buttons | Grow vertically; label wraps to 2 lines rather than truncating |
| Badge | Grows, `99+` cap holds |
| Timestamps | Never truncate. If space is tight, the row wraps instead |

**Rule: controls do not scale, content does.** A 2× toggle is not more usable — it is
just bigger. Hit targets are already ≥ 44px at every size.

### 2.3 Layout consequences

- **No fixed heights on anything containing text.** This is the single most common
  dynamic-type bug.
- **No `line-clamp: 1` on a primary identifier.** A truncated contact name at large
  type is unusable; two lines then ellipsis.
- **Two-pane switches on width, not on type size.** A user at 200% on a desktop still
  gets two panes; the list pane simply becomes proportionally narrower content.
- **Test matrix:** every screen at 1.0×, 1.5× and 2.0×, at 360px and 1280px. Six
  combinations, and they are part of the review, not a later audit.

### 2.4 Bold text and fonts

- **Bold text** shifts body weight `regular` → `medium` globally. Not `semibold` —
  that overshoots and makes long messages heavy.
- **Font choice** offers System as an alternative to Space Grotesk, so users with
  dyslexia-friendly system fonts installed get them. The brand face is the default,
  never the only option.
- Letter-spacing on the wordmark is `em`-based, so it scales correctly with type size.

---

## 3. Reduced motion

### 3.1 Behaviour

`prefers-reduced-motion: reduce`, or the in-app override, produces:

| Category | Reduced behaviour |
| --- | --- |
| **Air** — ambient loops | **Stopped.** Presence dot becomes static, typing indicator becomes the static text `Anaya is typing`, skeletons stop pulsing |
| **Air** — press feedback | Kept. It is 120ms and conveys touch, not decoration |
| **Water** — sheets, drawers | Cross-fade in place, 120ms. No travel |
| **Water** — drag gestures | **Kept.** A drag that does not follow the finger is broken, not calm. Reduced motion does not mean unresponsive |
| **Glass** — overlays, menus | Opacity only. No scale |
| Entrance animations | Removed entirely. Content appears |
| Autoscroll | Instant jump, never smooth |
| Progress bars | Kept. Determinate progress is information |
| Segmented control | Selection moves instantly; no slide |

Already enforced globally in `tokens.css`. The in-app toggle can only make motion
*less*, never more than the OS allows.

### 3.2 The critical rule

**No information may exist only in motion.**

Verified by [00 § 6 question 4](./00-principles.md#6-the-calm-test): turn off every
animation, and nothing becomes confusing. Concretely:

| Motion | Static equivalent that must exist |
| --- | --- |
| Typing dots | The text `Anaya is typing` |
| Pulsing presence dot | The dot's presence and colour |
| Loading monogram | The word `Loading` beside it |
| Recording halo | The running duration and the word `Recording` |
| Sheet slide direction | A visible grabber and a dismiss control |
| Selection slide | The selected segment's contrast and a checkmark for screen readers |

### 3.3 Vestibular safety

- No parallax, no zoom-on-scroll, no auto-playing full-screen video.
- The splash orb drifts ≤ 12px over 20s — below the perceptual threshold for motion
  sensitivity, and stopped entirely under reduced motion.
- Media auto-play is muted, small, and only on explicit hover or long-press; never on
  scroll-into-view.

---

## 4. Contrast & colour

### 4.1 Measured ratios

Against `--color-page` `#FBFBFE` unless noted. These are the audited values of the
existing token set.

| Token | Hex | Ratio | Passes |
| --- | --- | --- | --- |
| `text` | `#101114` | **17.8:1** | AAA body |
| `text-secondary` | `#6F7282` | **4.9:1** | AA body ✓ |
| `text-tertiary` | 38% ink | **~3.1:1** | Large text / non-text only |
| `brand` | `#5C6CFF` | **4.6:1** | AA body ✓ |
| `brand-alt` / `dot` | `#8B5DFF` | **4.1:1** | Large text & UI only ✗ body |
| `danger` | `#E5544B` | **3.6:1** | Large text & UI only ✗ body |
| `online` | `#34C77B` | **2.3:1** | **Non-text only** |
| White on gradient midpoint | `#FFF` on `#87 76 FF` | **4.6:1** | AA body ✓ |

### 4.2 Rules that follow from the table

1. **`text-tertiary` may never carry sole meaning.** It is for timestamps and metadata
   that duplicate information available elsewhere. A timestamp is the only thing it is
   used for that a user might need — and the full time is always in the screen-reader
   announcement.
2. **`dot` purple is never used for body text.** It is a *dot*, a badge fill, and large
   type. Brand blue is the text colour.
3. **`danger` red is never body text either.** Error captions use it at `caption` size
   against `danger-soft`, which lifts the effective ratio, **and** are always paired
   with a glyph or a state change.
4. **`online` green is never text and never alone.** It is a fill on a shape whose
   presence is itself the signal.
5. **Gradient buttons are verified at the gradient's lightest point**, not its average.
   `#A16EFF` with white is 3.9:1 — which is why the label is `medium` weight at 16px,
   qualifying as large text, and why the gradient's light end never occupies the label
   area.

### 4.3 Never colour alone

Every state has a second channel. This is a brand property, not just an a11y one — it
is why the read receipt is a *different glyph*, not just a different colour.

| State | Colour | Second channel |
| --- | --- | --- |
| Read | brand | Double check vs single check |
| Delivered vs sent | tertiary (same) | Double check vs single check |
| Failed | danger | The words `Not sent` + retry affordance |
| Unread | brand timestamp | Medium-weight title + a badge |
| Online | purple dot | The dot's presence |
| Selected chip | brand wash | `aria-checked` + weight |
| Selected theme | brand ring | A checkmark |
| Required field unmet | — | **Never red while typing.** Hollow vs filled check |

### 4.4 High contrast & forced colours

- `prefers-contrast: more` — borders go from 7% to 20% ink, `text-secondary` darkens to
  meet 7:1, shadows are replaced by 1px borders.
- `forced-colors: active` (Windows High Contrast) — the gradient falls back to
  `ButtonFace`/`ButtonText`, glass becomes opaque `Canvas`, all shadows become borders,
  and every icon gets `forced-color-adjust: auto`. **Bubble direction must survive
  this**, so outgoing bubbles keep their right alignment and gain a border.
- **Never convey the send/receive distinction by fill alone.** Alignment is the primary
  channel; the gradient is the reinforcement.

### 4.5 Dark theme

Specified in [04 § 2](./04-settings.md#2-appearance) and not yet built. Requirements
when it is:

- Surfaces lighten with elevation (`#141519` → `#1C1D22` → `#24252B`), never darken.
- **Pure black is prohibited.** It causes smearing on OLED and haloing for astigmatism.
- The gradient desaturates ~15% — full-saturation brand colour on a dark ground
  vibrates.
- Text tops out at `#F2F3F7`, not white. Pure white on near-black is the dark-mode
  equivalent of glare.
- Every ratio in § 4.1 is re-audited against the dark surface. Passing in light does
  not imply passing in dark.

---

## 5. Touch targets & motor accessibility

### 5.1 Sizes

| Context | Visual | Target |
| --- | --- | --- |
| Dock icon | 24px | **48px** |
| Header icon button | 20px | 44px |
| Composer send/mic | 19px | 44px |
| Composer emoji | 20px | 40px (inside a 48px row) |
| Filter chip | 32px tall | 32px + 6px vertical slop = 44px |
| Conversation row | — | Full width × ≥ 64px |
| Settings row | — | Full width × ≥ 56px |
| Toggle | 48×28 | 48×44 |
| Reaction pill | 20px tall | 32px — **the one documented exception**, mitigated by the bubble's own context menu offering the same action |
| Lightbox close | 24px | 48px, inset ≥ 16px from the edge |

**Floor: 44×44px.** Anything smaller is a spec violation requiring a recorded reason.

### 5.2 Spacing between targets

Minimum 8px between adjacent independent targets. The chat header's three buttons sit
at 2px visual gap — their 44px targets are adjacent, which is acceptable only because
they are the same *category* of action. A destructive control is never adjacent to a
non-destructive one.

### 5.3 Motor considerations

- **No timed interactions.** Nothing expires while the user decides. Snackbar undo is
  the one timed element, and its action is always also available elsewhere (Archive is
  in the row's menu; a deleted message is in Recently deleted).
- **No double-tap requirements** except the reaction shortcut, which duplicates the
  context menu.
- **No drag-only actions.** Every drag has a tap equivalent.
- **Long-press duration** is 500ms, and follows the OS setting where exposed.
- **Hover is never required.** Not on desktop either — every hover-revealed control is
  also in a menu.
- **Reachability:** on phones the primary action sits in the bottom third. The dock is
  at the bottom. Destructive actions in sheets are at the bottom of the list, furthest
  from a resting thumb.

---

## 6. Keyboard navigation

### 6.1 Global

| Requirement | |
| --- | --- |
| Tab order | Follows reading order. No `tabindex` above 0, anywhere |
| Focus visible | `:focus-visible` only, 2px `focus-ring` at 2px offset. Pointer users never see it |
| Focus never lost | Deleting a focused item moves focus to its neighbour, never to `<body>` |
| Skip link | First tab stop on desktop: `Skip to conversation` |
| Escape order | Innermost first: menu → sheet → dialog → search → clears field |
| No keyboard trap | Except intentional focus containment in dialogs and sheets, which always release on close |

### 6.2 Focus management by surface

| Surface | On open | On close |
| --- | --- | --- |
| Dialog | First interactive element, or the safest one for destructive dialogs (`Cancel`) | Returns to the trigger |
| Bottom sheet | First option | Returns to the trigger |
| Context menu | First item | Returns to the anchor |
| Search | The field | Returns to the search trigger |
| Thread (desktop) | The composer | — |
| Lightbox | The image, arrows navigate | Returns to the tile |

**Destructive dialogs focus `Cancel`, not the destructive action.** A user who hits
Enter reflexively should not delete their account.

### 6.3 Shortcuts

Full list in [05 Part B](./05-components-responsive.md#keyboard-shortcuts-desktop).
Requirements:

- Discoverable via `⌘/`, which opens a sheet listing them.
- **Never the only path** to an action.
- No single-character shortcuts without a modifier — they collide with typing, which in
  a messaging app is catastrophic.
- User-remappable is a future addition; conflicts with OS and screen-reader shortcuts
  are checked now.

---

## 7. Cognitive accessibility

Under-specified in most products, and directly aligned with PINGO's thesis — this is
where "calm" and "accessible" are the same requirement.

| Principle | Applied |
| --- | --- |
| One decision per screen | Registration is ten steps, not one long form ([01 § 7](./01-onboarding-auth.md#2-the-complete-journey)) |
| No time pressure | Nothing expires while the user reads |
| Plain language | No jargon. Settings descriptions are sentences, not labels. Reading level target: 12-year-old |
| Consistent placement | The primary action is always bottom-right or full-width-bottom. Back is always top-left. Never moves |
| Reversible by default | Undo over confirm. Destructive-and-irreversible is the only case that gets a dialog |
| No hidden state | Toggles show their state; there is no "long press to see the real setting" |
| Errors say what to do | *"That password doesn't match. Try again, or recover your account."* — not *"Authentication failed"* |
| Progress is visible | Registration has a bar; recovery has a stepper; uploads have determinate progress |
| Memory not required | The phone number is shown on the password screen. The case reference is copyable. Nothing must be remembered between screens |

**Error copy rules:** name what happened, name what to do, never blame, never use an
error code as the primary message. A code may appear as a caption for support.

---

## 8. Situational & environmental

Temporary, situational impairment affects everyone, and designing for it improves the
product for all users.

| Situation | Design response |
| --- | --- |
| One-handed, on a train | Primary actions in the bottom third; dock at the bottom |
| Bright sunlight | 17.8:1 body contrast; no critical information in `text-tertiary` |
| Noisy environment | Voice notes always have a visible waveform and duration; calls have visible state, not just audio |
| Silent environment | Nothing requires sound. All audio feedback is optional and off-by-default except the notification tone |
| Poor connection | See [07 — Offline & Sync](./07-offline-sync.md). Never a blocking spinner |
| Low battery | Glass effects and blur auto-disable under low-power mode; ambient loops pause |
| Cold hands / gloves | 44px floor plus 8px separation makes targets forgiving |
| Distracted, interrupted | Drafts persist per conversation; registration resumes at the last completed step |

---

## 9. Testing requirements

Not optional, and not a pre-launch audit. Part of the definition of done for any screen.

| Check | How |
| --- | --- |
| Screen reader | VoiceOver (iOS/macOS), TalkBack (Android), NVDA (Windows). Complete the screen's primary task **with the display off** |
| Keyboard only | Complete the primary task without touching the mouse |
| Dynamic type | 1.0× / 1.5× / 2.0× at 360px and 1280px |
| Reduced motion | OS setting on — nothing confusing, nothing broken |
| Contrast | Automated on every token pair, manual on gradient and glass surfaces |
| Forced colours | Windows High Contrast — bubble direction must survive |
| Targets | Automated: no interactive element under 44×44 |
| Zoom | Browser zoom to 400% at 1280px, no horizontal scroll |

**The display-off test is the one that finds real defects.** Everything else can pass
while the screen remains unusable.

---

*Previous: [05 — Components & Responsive](./05-components-responsive.md) · Next: [07 — Offline & Sync](./07-offline-sync.md)*
