# 05 — Components & Responsive Behaviour

---

## Part A — Component library

Each component below is specified as **anatomy → states → motion → rules**. The
"rules" are what a reviewer checks.

Components marked ✅ exist in `packages/ui`. The rest are specified here and not yet
built.

---

### 1. Button ✅

**Anatomy** — optional leading icon · label · optional trailing chevron. Height by
size: 36 / 44 / 52. Radius `md` (14px) at sm/md, `lg` (20px) at lg.

| Variant | Fill | Use |
| --- | --- | --- |
| Primary | `bg-brand-gradient` + `shadow-brand` | The one action. Max one visible |
| Secondary | `surface` + hairline border + `shadow-sm` | Everything else |
| Text | none, brand label | Inline and tertiary actions |
| Danger | `danger` filled | Destructive confirmation only — **never the gradient** |

**States** — rest · hover (shadow lifts; gradient never shifts) · pressed (`0.98`
scale) · focus (`focus-ring`, keyboard only) · loading (label hidden at opacity 0,
width preserved, monogram dots centred) · disabled (45% opacity, never grey).

**Motion** — air. 120ms on colour and shadow, 180ms on scale.

**Rules**
- Loading **must** preserve width. A shrinking button reflows its neighbours.
- Disabled buttons drop opacity; they never turn grey. Grey on near-white reads as
  broken rather than unavailable.
- A button that would be disabled for the whole session should not be rendered.

---

### 2. IconButton ✅

Square, always circular, **requires** an accessible label — enforced by the type
signature. Sizes 36/40/44 with a ≥ 44px hit area regardless of visual size.
Variants: ghost · filled (`sunken`) · gradient. Motion: air, `0.96` press.

**Rule** — never contains text, and never appears without a `title`/`aria-label`.

---

### 3. TextField ✅

**Anatomy** — optional label (caption, secondary) · field · optional leading icon ·
optional trailing slot · optional hint.

Filled with `sunken`, **borderless until focused**. On focus: background → `surface`,
border → `line-strong`, plus `shadow-sm`. A page of outlined boxes is visual noise; a
filled field reads as a soft recess.

**States** — rest · focus · filled · invalid (`danger` border + `danger-soft`
background, hint turns `danger`) · disabled.

**Motion** — air, 120ms on background/border/shadow. **No shake on error.**

**Rules**
- Focus is expressed on the wrapper, not the bare input.
- Errors appear on blur or submit, never per-keystroke while typing.
- Placeholder is never the label. A field whose label vanishes on input is a field
  the user has to remember.

---

### 4. SearchField ✅

`TextField` in pill shape with a leading magnifier and a trailing clear button that
appears once there is content. Native clear affordances are suppressed.

---

### 5. Chip ✅

Pill, 32px, caption/medium. Selected = `bg-selected` wash + brand label. Unselected =
`sunken` + secondary label. Optional trailing count, hidden at zero.

Rendered as `role="radio"` inside `role="radiogroup"` so arrow keys traverse and the
set is announced as one control.

**Rules** — selection is a wash, never a solid fill (it would compete with the
primary button). The row scrolls horizontally and never wraps.

---

### 6. Toggle ✅

48×28 track, 24px knob, 2px inset. On = `bg-brand-gradient`. Off = `line-strong`
neutral — **never red or hollow**, because off is a valid resting state, not a
warning.

`role="switch"`, knob moves by `transform` so it animates on the compositor.
Motion: air, 180ms.

---

### 7. Card ✅

`surface`, radius `lg`, elevation `sm`→`lg`, 16px padding. `interactive` adds hover
shadow lift and a `0.995` press.

**Rule** — interactive styling only on cards that actually do something. A hover
state on static content is a lie about affordance.

---

### 8. GlassPanel ✅

`glass-surface` (72% white, 24px blur, 180% saturate, translucent hairline), radius
`xl`, `shadow-lg`.

**Rule** — only where something scrolls behind it. Glass over a static background is
a tinted box paying the cost of a backdrop filter. Falls back to opaque `surface` +
border when Appearance → Glass effects is off, or on low-power mode.

---

### 9. Badge ✅

Circular at one digit (`h-5 min-w-5`), grows sideways beyond. `99+` cap. Tones:
brand (default) · neutral (muted conversations) · danger. Returns `null` at zero.

**Rule** — never render `0`. Never place a badge on a surface the user is currently
looking at.

---

### 10. Avatar ✅

Six sizes 28→128. Falls back to a monogram on a deterministic brand-derived gradient
chosen by hash of the user id — same person, same colour, every device, no network
request.

Presence dot uses `PingoDot`, ringed in the page colour to separate it from the
image. Multi-dot states scale to 40% so they never exceed the avatar's footprint.

`AvatarStack` overlaps at **20%** — enough to read as a stack, not enough to clip the
monogram beneath. Caps at 3 + count.

---

### 11. ListRow / ListGroup ✅

Icon slot (fixed 36px so labels align) · label · optional description · trailing slot
· optional chevron.

Renders as `<button>` **only** when it has an `onClick`; a row holding a toggle is a
`<div>`. Getting this wrong is the most common accessibility defect in settings
screens.

`ListGroup` draws dividers between children via a selector, so a group never ends
with a stray line.

---

### 12. Dialog *(to build)*

**Anatomy** — title (`h2`) · body (`body`, secondary) · action row. Max 340px wide,
centred, radius `xl`, `shadow-xl`. Scrim `scrim` at 32%.

**Motion** — glass. Scrim fades 180ms; dialog scales `0.97`→`1` with opacity over
180ms. Exit 120ms `ease-exit`. **No slide, no bounce.**

**States** — default (secondary + primary) · destructive (secondary + danger) ·
single-action (one full-width secondary).

**Rules**
- Focus traps inside; `Esc` and scrim tap dismiss non-destructive dialogs.
- Destructive dialogs require an explicit choice — scrim tap does **not** dismiss.
- Cancel is always on the left, always secondary.
- **Confirmations are for the irreversible only.** Anything undoable uses a snackbar
  instead (§ 18).
- Never more than two actions. Three means the dialog is a menu.

---

### 13. Bottom sheet *(to build)*

**Anatomy** — grabber (32×4 rounded, `line-strong`) · optional title · content ·
optional action row. Radius `xl` on top corners only, `shadow-xl`.

**Motion** — water. Slides `translateY` over 240ms `ease-standard`. Drag follows the
finger 1:1. Release: velocity > 0.5 px/ms or past 40% travel commits the dismiss,
otherwise it settles back. Exit 180ms `ease-exit`.

**Sizes** — content-height (default) · half · full (becomes a pushed screen at that
point; a full-height sheet is a screen wearing a sheet's clothes).

**Rules**
- Never nest sheets. A sheet that opens a sheet should be a pushed screen.
- Scrolling content: the sheet only drags from the grabber or when content is at
  scroll-top. Otherwise the gesture belongs to the content.
- On desktop ≥ 1024px a bottom sheet becomes a **centred dialog** — sheets from the
  bottom of a large screen are a phone idiom that reads as unfinished.

---

### 14. Context menu *(to build)*

**Anatomy** — rows of icon + label, 44px tall, min 200px wide, radius `lg`,
`glass-surface`, `shadow-lg`. Destructive items `danger`, last, after a divider.

**Motion** — glass. Scales `0.95`→`1` **from its anchor point**, 180ms. A menu opened
from a bubble's top-right grows from that corner. Origin correctness is what makes it
feel attached rather than dropped in.

**Rules**
- Repositions to stay in the viewport; never clipped.
- On touch, long-press opens it and the source element lifts slightly (air) to
  acknowledge the press.
- Max 7 items. Beyond that it becomes a bottom sheet.

---

### 15. Dropdown / Select *(to build)*

Trigger looks like a `TextField` with a trailing chevron that rotates 180° on open
(air, 180ms). Panel is `glass-surface`, anchored, scrolls past 6 items, radius `md`.
Selected item shows a brand check. Type-ahead jumps; arrows navigate; `Esc` closes
and restores focus.

**Rule** — on touch this becomes a bottom sheet. Anchored dropdowns are unusable
near a keyboard.

---

### 16. Menu bar / overflow ✅ *(icon exists, menu to build)*

The `⋯` control. Opens a context menu anchored to itself. Same spec as § 14.

---

### 17. Tooltip *(to build)*

Caption on `ink` at 92%, white text, radius `sm`, 8px padding, max 240px. Appears
after 500ms hover, disappears immediately on leave. Glass motion, opacity + 2px
travel toward the anchor.

**Rules**
- **Pointer only.** Tooltips do not exist on touch, so they may never carry
  information required to use a control.
- Never on a control that already has a visible label.
- Every icon-only control has one on desktop, matching its `aria-label` exactly.

---

### 18. Snackbar *(to build)*

**Anatomy** — message (`body`) · optional action (text button, brand) · no close
button. `surface`, radius `lg`, `shadow-lg`, 16px padding.

**Position** — above the dock on phone (bottom-centre, 16px gutter), bottom-left on
desktop. Never covers the composer.

**Motion** — water in (translateY 240ms), glass out (fade 180ms). Asymmetric on
purpose: arriving needs to be noticed, leaving does not.

**Timing** — 4s default, 6s with an action, indefinite for errors with a retry.
Hovering pauses the timer.

**Rules**
- **One at a time.** A new snackbar replaces the current one; they never stack.
- This is the home of undo. Destructive actions in PINGO delete first and offer
  `Undo` here, rather than interrupting with a confirmation.
- Never used for success confirmation of something already visible. Saving a setting
  that visibly moved does not need a snackbar.

---

### 19. Navigation ✅ *(dock)* / *(rail + sidebar to build)*

Three forms of the same four destinations:

| Form factor | Form |
| --- | --- |
| Phone | Floating glass dock, bottom-centre |
| Tablet | Vertical glass rail, left edge |
| Desktop | Vertical rail + persistent list pane |

Active state is the **purple dot** beneath (dock) or beside (rail) the icon — the
brand element already means "here, now," so it costs the user nothing to learn.

**Rules** — exactly four destinations, permanently. Unread badge on Chats only, and
hidden while Chats is the active destination.

---

### 20. Segmented control *(to build)*

Used for the profile's four tabs. `sunken` track, radius `pill`, the selected segment
a `surface` pill with `shadow-sm` that **slides** between positions (water, 240ms) —
the slide is what communicates that these are positions on one axis rather than
separate buttons.

Max 4 segments. Beyond that, use a scrolling chip row.

---

### 21. Skeleton ✅

`sunken` blocks that pulse opacity. **Never a shimmer sweep** — a sweep implies
progress it cannot know about; a fade says "not yet."

**Rule** — must match the shape of what will load, including varied widths for text
lines so it reads as text rather than bars.

---

### 22. Empty state ✅

Icon in a `sunken` rounded square (optional) · title (`h2`) · one sentence
(`body`, secondary) · optional single action.

**Rules** — never apologises, never says "Empty," and always says what to do next if
there is something to do. If there is nothing to do, it has no button.

---

### 23. Progress *(to build)*

| Form | Use |
| --- | --- |
| Determinate bar | Uploads, downloads, backups. 3px, brand gradient, radius pill |
| Determinate ring | Inline in a row, 20px, 2px stroke |
| Indeterminate | **The monogram's loading state.** Never a generic spinner |

**Rule** — if progress is knowable, show it. An indeterminate indicator on a
knowable operation is a design failure, not a fallback.

---

### 24. Divider ✅

1px `divider` (5% ink). Inset 12px from the container edge inside groups, full-bleed
between sections.

**Rule** — dividers separate; spacing groups. If spacing can do the job, delete the
divider.

---

## Part B — Responsive behaviour

One product, three form factors. Not three products, and not one layout stretched.

### Breakpoints

| Token | Width | Form factor |
| --- | --- | --- |
| — | < 480 | Phone |
| `sm` | ≥ 480 | Large phone / small tablet portrait |
| `md` | ≥ 768 | Tablet |
| `lg` | ≥ 1024 | Desktop — **the two-pane switch** |
| `xl` | ≥ 1280 | Wide desktop |

`lg` is the only breakpoint that changes the component tree. Everything else changes
values only.

### Layout per form factor

**Phone (< 768)** — single pane, one screen at a time.

```
┌────────────────┐
│    Screen      │
│                │
│   ╭────────╮   │
│   │💬 ☎ 👥 👤│  │  ← floating dock
│   ╰────────╯   │
└────────────────┘
```

Navigation is the dock. An open thread is full-screen with the dock **hidden** — the
composer takes the bottom edge, because it must sit against the keyboard.

**Tablet (768–1023)** — single pane, navigation rail.

```
┌──┬─────────────────────┐
│💬│                     │
│☎ │      Screen         │
│👥│                     │
│👤│                     │
└──┴─────────────────────┘
```

The dock becomes a left rail. Content gets a wider gutter (32px) and content columns
cap their measure rather than filling — a 900px-wide line of message text is
unreadable regardless of the device.

**Desktop (≥ 1024)** — two panes.

```
┌──┬───────────┬──────────────┐
│💬│ Chats     │              │
│☎ │ ⌕ Search  │   Thread     │
│👥│ ▸ Anaya   │              │
│👤│ ▸ Rohit   │              │
└──┴───────────┴──────────────┘
```

List pane 352px (`xl`: 400px), fixed. Thread fills the remainder with its column
capped at 768px and centred. Hover states become meaningful; keyboard shortcuts
become primary.

### What changes and what does not

| | Phone | Tablet | Desktop |
| --- | --- | --- | --- |
| Panes | 1 | 1 | 2 |
| Navigation | Floating dock | Left rail | Left rail |
| Gutter | 20px | 32px | 32px |
| Gallery columns | 3 | 4 | 5 |
| Bottom sheets | Sheet | Sheet | **Dialog** |
| Dropdowns | Sheet | Anchored | Anchored |
| Tooltips | none | none | yes |
| Snackbar | Bottom-centre | Bottom-centre | Bottom-left |
| Type scale | identical | identical | identical |
| Colours, radii, motion | identical | identical | identical |
| Information available | identical | identical | identical |

**The last row is the important one.** No feature and no data is desktop-only or
phone-only. Layout adapts; capability does not.

### URL parity

A URL means the same thing on every form factor. `/chats/c-anaya` is a full-screen
thread on a phone and a selected thread beside the list on a desktop — the same
state, arranged differently. A link shared from a phone opens correctly on a desktop
and vice versa.

### Keyboard shortcuts (desktop)

| Key | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Universal search |
| `⌘N` | New conversation |
| `↑` `↓` | Move through the conversation list |
| `⌘1`–`⌘4` | Jump to a dock destination |
| `Esc` | Close sheet / dialog / search, in that order |
| `⌘F` | Search within the open conversation |
| `Enter` | Send |
| `Shift+Enter` | Newline |
| `⌘↑` | Jump to the oldest unread message |

Discoverable via `⌘/`, which opens a shortcut sheet. Never the only path to an
action.

### Touch and pointer

| | Touch | Pointer |
| --- | --- | --- |
| Min target | 44px | 32px |
| Reveal on hover | never | permitted, but never sole access |
| Long press | context menu | right-click |
| Swipe actions | yes | replaced by an overflow button on hover |
| Drag to dismiss | yes | `Esc` / scrim |

**Rule** — every touch gesture has a pointer equivalent and vice versa. A swipe-only
action is inaccessible on desktop; a hover-only action is invisible on touch.

---

*Previous: [04 — Settings](./04-settings.md) · Next: [06 — Accessibility](./06-accessibility.md)*
