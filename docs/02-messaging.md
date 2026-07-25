# 02 — Home, Chats & Composer

The core loop. Everything else in PINGO is in service of these three surfaces.

---

## 1. Home — the conversation list

### 1.1 Anatomy

```
┌──────────────────────────────┐
│ PINGO                     +  │  ← glass header, sticky
│ ┌──────────────────────────┐ │
│ │ ⌕  Search                │ │
│ └──────────────────────────┘ │
│ (All) Unread 2  Groups 1  ⋯  │  ← chips, horizontal scroll
├──────────────────────────────┤
│ ⬤  Anaya Sharma    📌 11:31  │
│    Voice message             │
│ ⬤  Rohit Verma        10:45  │
│    Where are we meeting?  ②  │
│ ⬤  Design Team         9:15  │
│    Alex: Shared a file    ①  │
├──────────────────────────────┤
│         ╭─────────────╮      │
│         │ 💬 ☎ 👥 👤 │      │  ← floating glass dock
│         ╰─────────────╯      │
└──────────────────────────────┘
```

### 1.2 Row information hierarchy

A row answers three questions in one glance: **who**, **what**, **does it need me**.

| Element | Read state | Unread state |
| --- | --- | --- |
| Title | `body` regular, ink | `body` **medium**, ink |
| Preview | `caption`, secondary | `caption`, **ink** |
| Timestamp | `caption`, tertiary | `caption`, **brand** |
| Badge | absent | brand pill, or **neutral if muted** |

Weight and colour temperature carry the state — **never a tinted row background.**
A list of highlighted rows reads as a list of alarms.

**Ordering:** pinned first, then most recent. No algorithm, ever (Law: § 00.7).

**Muted conversations still count** but their badge is neutral grey. Mute means
*"don't interrupt me,"* not *"lie to me about what's there."*

### 1.3 Preview text rules

| Content | Preview |
| --- | --- |
| Text | The text, single line, ellipsised |
| Voice note | `Voice message` |
| Image | `Photo` |
| Video | `Video` |
| File | `Shared filename.pdf` |
| Multiple attachments | `3 photos` |
| Deleted | `Message deleted`, italic, tertiary |
| In a group | `Alex: ` prefix. Own messages prefix `You: ` |
| Typing | **Replaces the preview entirely** — three dots + `Anaya is typing`, in brand |
| Draft exists | `Draft: ` prefix in brand, outranks the last message |

Typing replaces rather than joins the preview. Two truths in one slot is one truth
too many.

### 1.4 Row interactions

| Gesture | Result |
| --- | --- |
| Tap | Open thread |
| Swipe right → | Reveal Pin / Mark read. Water motion, follows the finger |
| Swipe left ← | Reveal Mute / Archive. Full swipe commits with a snackbar undo |
| Long press | Context menu: Pin, Mute, Mark unread, Archive, Delete |
| Hover (desktop) | `bg-hover` wash, plus a `⋯` overflow button in the timestamp's place |

**Destructive actions always undo, never confirm.** A snackbar with `Undo` for 5
seconds respects the user more than a modal asking "are you sure?" — the modal
interrupts the 99% of intentional taps to protect the 1%.

### 1.5 Filters

`All · Unread · Groups · Favorites`. Counts on every chip except All. Selecting is
a brand-tinted wash, not a solid fill — a solid chip would compete with the primary
action.

The row scrolls horizontally and **never wraps**. A wrapping filter row changes the
header height as filters change, which violates Law 5.

### 1.6 Empty states — four distinct cases

Each says something different, because they *are* different.

**First run — never had a conversation**

```
┌──────────────────────────────┐
│                              │
│            P•                │
│                              │
│    Welcome to PINGO          │
│                              │
│    Start your first          │
│    conversation.             │
│                              │
│  ┌────────────────────────┐  │
│  │      Find Friends      │  │  ← gradient
│  └────────────────────────┘  │
│                              │
│    Or share your username    │
│         @piyush  ⧉           │
└──────────────────────────────┘
```

The username with a copy button is the highest-value element here: it is the one
thing a brand-new user can *do* that doesn't depend on anyone else being present.

**Archive emptied — had conversations, none now**
Title *"All clear"*, body *"Your conversations are archived. They're still here when
you need them."*, action `View archive` (secondary).

**Filter yields nothing**
*"Nothing in Unread"* / *"You're all caught up."* No action button — the fix is
tapping another chip, which is already on screen.

**Search yields nothing**
*"No matches"* / *"Nothing found for 'xyz'."* Offers `Search messages instead` if
the query only ran against titles.

### 1.7 Loading & offline

- **Loading:** skeleton rows matching the real row's shape — circle, two bars of
  varied width. Pulses opacity; never a shimmer sweep. Five rows.
- **Offline:** a glass strip below the header — *"Offline. Showing your saved
  messages."* Non-dismissible while offline, slides away (water, 180ms) on
  reconnect. The list stays fully interactive; drafts queue.

---

## 2. The chat thread

### 2.1 Anatomy

```
┌──────────────────────────────┐
│ ‹  ⬤ Anaya Sharma   ☎ ▣ ⋯   │  ← glass, sticky
│      online                  │
├──────────────────────────────┤
│                              │
│            Today             │
│  ╭─────────────────────╮     │
│  │ Hey! Where are we   │     │
│  │ meeting?            │     │
│  ╰─────────────────────╯     │
│  11:30 AM                    │
│                              │
│        ╭──────────────────╮  │
│        │ See you there!   │  │  ← gradient
│        ╰──────────────────╯  │
│                  11:30 AM ✓✓ │
├──────────────────────────────┤
│ ┌──────────────────────┐ ╭─╮ │
│ │ + Type a message… ☺ │ │▶│ │
│ └──────────────────────┘ ╰─╯ │
└──────────────────────────────┘
```

### 2.2 Bubble specification

| | Incoming | Outgoing |
| --- | --- | --- |
| Fill | `surface` white + `shadow-sm` | `bg-brand-gradient` |
| Text | ink | white |
| Radius | 20px, 6px on the clustered seam | same, mirrored |
| Max width | 68% of column (85% with media) | same |
| Align | left | right |

**Why incoming needs a shadow:** Soft White on Background is two steps of
luminance. Without elevation the bubble is invisible. This was found in
implementation and is now a rule.

**Clustering.** Consecutive messages from one author within 5 minutes form a
cluster: full radius at the ends, 6px on the internal seam, **one timestamp on the
last bubble only.** Repeating the timestamp per line is the fastest way to make a
thread look cluttered.

**No avatars in 1:1 threads.** The header says who you're talking to; a repeated
avatar down the margin is 40px of noise per message. Group threads show the avatar
on the **first bubble of each incoming cluster** only.

### 2.3 Delivery states

| State | Glyph | Colour |
| --- | --- | --- |
| Sending | three dots (air) | tertiary |
| Sent | single check | tertiary |
| Delivered | double check | tertiary |
| Read | double check | **brand** |
| Failed | `Not sent` + retry | danger |

Only `read` is brand-coloured. It is the one transition that carries meaning for
the sender.

### 2.4 Message interactions

| Gesture | Result |
| --- | --- |
| Long press / right-click | Context menu, scales from the bubble (glass) |
| Double tap | Quick-react with the last-used emoji |
| Swipe right on bubble | Reply. Bubble slides ≤ 48px and springs back — water, no overshoot |
| Tap a reply quote | Scrolls to the original and highlights it for 1.2s |
| Tap failed message | Retry / Delete sheet |

**Context menu contents:** React · Reply · Forward · Copy · Star · Edit *(own, ≤ 15
min)* · Delete. Delete offers `For me` / `For everyone` where allowed.

### 2.5 Reactions

Straddle the bubble's lower edge. White pill, `shadow-sm`, emoji + count when > 1.
Tapping opens a sheet listing who reacted. The picker is a bottom sheet with six
recents and a search field — **not** a hover bar, which cannot be discovered on
touch.

### 2.6 Scroll behaviour

- Opens at the newest message, **jumped not animated.**
- Autoscroll follows new messages **only if already within 120px of the bottom.**
- Otherwise, a floating `↓ 3 new` pill appears above the composer. Tapping scrolls
  and clears.
- Short threads are **bottom-anchored** against the composer, not stranded at the
  top under a void.
- Loading older history preserves scroll position exactly — the new content must
  not push the reader (Law 5).

### 2.7 Day dividers

Centred caption, `Today` / `Yesterday` / weekday / full date. Placed before the
first cluster of each day. No line, no pill — just the words. Sticky at the top
while scrolling through a long day.

---

## 3. The composer

### 3.1 Resting state

```
┌──────────────────────────────┐
│ ┌──────────────────────┐ ╭─╮ │
│ │ + Type a message… ☺ │ │🎤│ │
│ └──────────────────────┘ ╰─╯ │
└──────────────────────────────┘
```

Three controls, per the density budget: **attach**, **emoji**, and **send-or-mic**.

**The trailing button swaps** — microphone when empty, gradient send when there's
text. The primary action is always the one that makes sense, and the button is never
sitting there disabled for the user to reason about.

### 3.2 Text behaviour

| | |
| --- | --- |
| Element | `textarea`, grows to ~6 lines then scrolls |
| Autosize | Before paint, so it never renders at the wrong height |
| Enter | Sends on desktop. **Newline on touch** — there is no visible Shift to discover |
| Shift+Enter | Newline on desktop |
| Draft | Persisted per conversation, surfaced in the list as `Draft:` |
| Mentions | `@` opens an inline picker; the chip is brand-coloured, non-editable |
| Links | Detected on send, preview card resolved after |

### 3.3 Attachment sheet

`+` opens a bottom sheet — **not** a fan of icons, which cannot be labelled and so
cannot be learned.

```
┌──────────────────────────────┐
│           ────               │  ← grabber
│                              │
│  ┌────┐ ┌────┐ ┌────┐        │
│  │ 📷 │ │ 🖼 │ │ 🎬 │        │
│  │Cam │ │Photo│ │Video│      │
│  └────┘ └────┘ └────┘        │
│  ┌────┐ ┌────┐ ┌────┐        │
│  │ 📄 │ │ GIF│ │ 📍 │        │
│  │File│ │ GIF│ │Place│       │
│  └────┘ └────┘ └────┘        │
│                              │
│  ── Recent ──                │
│  ▣ ▣ ▣ ▣ ▣ ▣  →              │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Layout | 3-column grid of labelled tiles, 44px icon in a `sunken` rounded square |
| Recents | A horizontal strip of the last 12 device photos, tap to attach directly |
| Motion | Water — slides up 240ms, drag-to-dismiss follows the finger |
| Scrim | `scrim` at 32%, fades in over 180ms |

The recents strip removes the most common flow — *"send the photo I just took"* —
from three taps to one.

### 3.4 Per-type behaviour

**Camera** — opens in-app capture (§ [05](./05-settings.md#camera) for settings).
Photo/video toggle, flip, flash, and a shutter that is the only gradient element on
screen. Captured media goes to a review screen with `Send` / `Retake` and an
optional caption — never sends straight from the shutter.

**Photo / Video** — a picker with multi-select up to 10. Selected items get a
brand-numbered badge showing send order. A caption field spans the bottom, one
caption per batch.

**Voice** — press-and-hold the mic. On press:

```
┌──────────────────────────────┐
│  🗑        ▂▄▆█▆▄▂     0:04  │
│           ← slide to cancel  │
└──────────────────────────────┘
```

The composer is **replaced**, not overlaid. Live waveform, running duration, slide
left to cancel, release to send. Lock-to-hands-free by sliding up. The recording dot
is the brand purple in its `recording` state — haloed, pulsing.

**File** — system picker. Any type. In-thread as an icon + name + size card. Progress
is a determinate brand bar along the card's lower edge.

**GIF** — a searchable grid in a bottom sheet. Trending on open. Sends immediately
on tap; a confirm step here is friction with no benefit.

### 3.5 Upload states

| State | Presentation |
| --- | --- |
| Queued | Bubble present at 60% opacity, dots in place of the tick |
| Uploading | Determinate brand progress along the bubble's bottom edge |
| Processing | Indeterminate — the monogram loading dots |
| Failed | 60% opacity, `danger` ring, tap to retry. **Never auto-deletes** |

The bubble appears **immediately** at full size. Media that pops into a
placeholder shifts the layout under the reader.

### 3.6 Permissions

Never request on screen entry. Request at the moment of use, and if denied, the tile
becomes a one-line explanation with a link to Settings — *"PINGO needs camera access
to take photos. Open Settings."* No modal, no repeat prompt, no nagging.

---

## 4. Cross-device consistency

The same conversation on phone and desktop must never disagree.

| | |
| --- | --- |
| Read state | Reading on one device clears the badge on all, within one round trip |
| Drafts | Sync per conversation. Last write wins, and typing on a second device shows a quiet `Editing on another device` caption |
| Typing | Broadcast once per user, not once per device |
| Sent messages | Appear on all devices via the event stream, not via local echo |
| Scroll position | **Not** synced. Where you are reading is local, and moving another device's viewport would violate Law 5 |

---

*Previous: [01 — Onboarding & Auth](./01-onboarding-auth.md) · Next: [03 — Profile, Communities, Calls](./03-social-and-calls.md)*
