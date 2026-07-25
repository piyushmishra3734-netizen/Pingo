# 03 — Profile, Communities, Calls, Notifications, Search

---

## 1. Profile

One screen serves both your own profile and someone else's. The page is the same
page; only the action row and the edit affordances differ.

### 1.1 Anatomy

```
┌──────────────────────────────┐
│ ‹  Anaya Sharma           ⋯  │
│ ┌──────────────────────────┐ │
│ │▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨│ │  ← brand wash
│ │          ┌────┐          │ │
│ │          │ AS │⬤        │ │  ← avatar straddles the edge
│ │          └────┘          │ │
│ │      Anaya Sharma        │ │
│ │        @anaya            │ │
│ │  Product designer. Tea,  │ │
│ │  typography, long walks. │ │
│ │                          │ │
│ │  ┌─────────┐ ╭─╮ ╭─╮    │ │
│ │  │ Message │ │☎│ │▣│    │ │
│ │  └─────────┘ ╰─╯ ╰─╯    │ │
│ └──────────────────────────┘ │
│                              │
│  Gallery  Posts  Moments  Friends │  ← segmented
│  ─────────                   │
│  ┌────┐ ┌────┐ ┌────┐        │
│  │ ▨  │ │ ▨  │ │ ▨  │        │
│  └────┘ └────┘ └────┘        │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Header card | `bg-brand-wash`, rounded 36px, avatar pulled up to straddle its lower edge with a 4px `surface` ring |
| Name | `h1` 32 |
| Handle | `body`, brand |
| Bio | `body`, secondary, centred, ≤ 3 lines then `more` |
| Own profile | Action row becomes a single `Edit Profile` secondary button; header shows `Settings` |
| Motion | Header card `rise` on mount. Avatar does **not** animate separately — one entrance, not two |

### 1.2 The four tabs

A segmented control, not a scrolling row of sections. Switching cross-fades content
over 180ms (glass) and **preserves each tab's scroll position**.

**Gallery** — images and videos, newest first.
- Grid: 3 columns phone, 4 tablet, 5 desktop. Gap 8px.
- Tiles vary between `1:1` and `3:4` by the item's real aspect, so a set reads as a
  collection rather than a spreadsheet.
- Video tiles carry a glass play badge; long-press previews inline, muted.
- Tap opens the **lightbox**: full-bleed, pinch-zoom, swipe between items, swipe down
  to dismiss (water, follows the finger). Caption and date on a bottom scrim.
- Own gallery: a `+` tile leads the grid.

**Posts** — longer-form entries that persist. Distinguished from Moments by
permanence, and from a feed by having no ranking and no infinite scroll.
- A card list: text, optional media, timestamp, reaction count.
- No comments in v1. Replies go to DM — *"Reply privately"* — which keeps the
  product a communication platform rather than a social network.

**Moments** — expiring media, 24 hours.
- A grid of 16:9 thumbnails, unviewed marked with the purple dot in a corner. **No
  ring around the avatar** — that puts a feed inside the contact list (§ 00.7).
- Tap opens the viewer: full-bleed, tap to advance, hold to pause, swipe down to
  exit. Progress is a hairline of segments at the top.
- Viewer list is visible to the author only, and only as a count plus names — never
  a re-engagement prompt.

**Friends** — mutual connections.
- Plain rows: avatar, name, handle, presence.
- Count is shown but **never as a score.** No "followers", no ratio, no leaderboard.
- Own profile allows removal via swipe, with undo.

### 1.3 Editing your own profile

A pushed screen, not a modal — editing a profile is a task, not a decision.
Fields: photo, name, username, bio. Username changes warn that the old handle frees
up immediately. Save is a text button in the header, enabled only when something
changed. Discarding with changes present asks once.

---

## 2. Communities

A community is group-shaped at scale: it has channels, roles, and announcements.
It still lives in the same conversation list — one surface, not a second inbox.

### 2.1 Community home

```
┌──────────────────────────────┐
│ ‹  Design Guild           ⋯  │
│ ┌──────────────────────────┐ │
│ │▨▨▨  Design Guild         │ │
│ │     248 members          │ │
│ └──────────────────────────┘ │
│                              │
│  📢 Announcements            │
│  ┌──────────────────────────┐│
│  │ Alex · 2h                ││
│  │ Design review moved to   ││
│  │ Thursday.                ││
│  └──────────────────────────┘│
│                              │
│  CHANNELS                    │
│  # general              ②   │
│  # critique                  │
│  # resources                 │
│  🔒 leads                    │
│                              │
│  MEMBERS                     │
│  ⬤⬤⬤⬤  +244          ›     │
└──────────────────────────────┘
```

| Section | Behaviour |
| --- | --- |
| Announcements | Pinned, read-only for members, max 3 shown then `See all`. This is the one place in PINGO where content is broadcast rather than exchanged, so it is visually distinct: a `sunken` card with a brand left edge |
| Channels | `#` prefix for open, lock glyph for restricted. Unread badge per channel. Muted channels dim to secondary |
| Members | Avatar stack + count, tapping opens the member list |

### 2.2 Channels

A channel thread is **the chat thread** (§ [02.2](./02-messaging.md#2-the-chat-thread))
with three additions:

1. Header shows `# channel` and the community name beneath it.
2. Incoming clusters show the author's avatar and name.
3. A read-only channel replaces the composer with a caption: *"Only admins can post
   here."* — never a disabled composer, which invites a tap that does nothing.

### 2.3 Roles

Three, and no more. Every additional role is a permissions matrix the user has to
hold in their head.

| Role | Can |
| --- | --- |
| Member | Read and post in open channels |
| Moderator | Delete messages, mute members, manage channel topics |
| Admin | Everything, plus roles, channels, and community settings |

Roles are shown as a caption beside the name in the member list, never as a coloured
badge. Colour means meaning, and rank is not one of PINGO's four meanings (Law 2).

### 2.4 Discovery

Deliberately minimal: **search by name, or join by invite link.** There is no
browse-and-explore directory, because a directory is a ranked feed and a ranked feed
is what we do not build. Growth here is by invitation, which is also the safer
default for a privacy-first product.

### 2.5 Media & Files tabs

Per community and per conversation, reachable from the `⋯` menu:
- **Media** — the same grid as the profile gallery, grouped by month.
- **Files** — rows with type icon, name, size, sender, date. Sortable by date or
  size. Searchable.
- **Links** — cards with resolved title and domain.

---

## 3. Calls

### 3.1 Call history

The Calls tab is a **log, not a dialler.** What a user wants here is almost always
"call the person I just spoke to."

| Element | Spec |
| --- | --- |
| Row | Avatar, name, direction glyph, duration-or-outcome, timestamp, call-back button |
| Direction | One arrow glyph, rotated: `↗` outgoing, `↙` incoming |
| Missed | Brand-coloured text, **not red.** A missed call is frequent and normal, not a failure |
| Call-back | Trailing icon button, matching the original call's type |
| Group calls | Show the conversation name and an avatar stack |

### 3.2 Outgoing / connecting

```
┌──────────────────────────────┐
│                              │
│           ┌──────┐           │
│           │  AS  │           │
│           └──────┘           │
│         Anaya Sharma         │
│          Ringing…            │
│                              │
│                              │
│                              │
│      ╭───╮ ╭───╮ ╭───╮       │
│      │ 🔇│ │ 📹│ │ 🔊│       │
│      ╰───╯ ╰───╯ ╰───╯       │
│           ╭─────╮            │
│           │  ✕  │            │  ← end, danger
│           ╰─────╯            │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Background | `bg-brand-wash`, with one slow-drifting orb. No video-call chrome on a voice call |
| Avatar | 128px, with a soft pulsing halo while ringing — air motion, opacity only |
| Status | `Ringing…` → `Connecting…` → duration. One line, `h2` |
| Controls | 56px circles, glass, generous 24px gaps |
| End | The only filled control. `danger`, and it is **not** the gradient — ending a call is not the brand's primary action |

### 3.3 Active voice call

Duration replaces status. Controls persist. A minimise gesture (swipe down) collapses
to a **pill** docked below the header of whatever screen you navigate to:

```
┌──────────────────────────────┐
│ ╭──────────────────────────╮ │
│ │ ⬤ Anaya · 04:12      ✕  │ │  ← tap to return
│ ╰──────────────────────────╯ │
```

Glass, brand dot pulsing, tap to expand. This is what makes calls feel native to the
product rather than a mode you are trapped in.

### 3.4 Video call

- Remote video full-bleed; local video in a draggable rounded thumbnail that snaps to
  corners (water — follows the finger, snaps on release).
- Controls auto-hide after 4s of no interaction, return on tap. **Fade only, never
  slide** — glass behaviour.
- Poor connection: the remote frame desaturates and a caption appears —
  *"Anaya's connection is unstable."* Never a red banner.
- Camera off shows the avatar on `brand-wash`, not a black rectangle.

### 3.5 Group calls

| Participants | Layout |
| --- | --- |
| 2 | Full-bleed + thumbnail |
| 3–4 | Even grid |
| 5–8 | Grid, active speaker enlarged |
| 9+ | Active speaker full, others in a scrolling filmstrip |

The active speaker is marked with a **brand ring**, animated in air motion. Muted
participants show a small glyph on their tile. Names appear on a bottom-left scrim
per tile, not floating.

### 3.6 Incoming call

Full-screen on lock; a glass banner at the top when the app is open. Two actions:
accept (gradient) and decline (danger). A third text button — `Message instead` —
which is the calm option and should be easy to reach.

---

## 4. Notifications

### 4.1 In-app inbox

Reached from the Home header. Grouped by day, newest first.

| Type | Presentation |
| --- | --- |
| Message | Avatar, name, preview, time |
| Mention | Avatar, community/channel, the mentioning line, brand `@` glyph |
| Call | Avatar, `Missed voice call`, time |
| System | Monogram in place of an avatar, plain text |

Unread items carry the purple dot at the row's leading edge — not a coloured
background. Tapping navigates to the source and marks read. `Mark all read` is a
text button in the header.

**No categories, no priority sorting, no "important" grouping.** We are not the judge
of who matters to the user (§ 00.7).

### 4.2 System notifications

| | |
| --- | --- |
| Content | Sender name and message text, unless previews are disabled |
| Privacy off | `New message` with no sender or content |
| Grouping | By conversation, natively. Never a digest we compose |
| Actions | Reply inline, Mark read |
| Sound | One tone. Short, soft, no melody |
| Quiet hours | Silences delivery entirely; the inbox still fills |
| Never sent | Marketing, re-engagement, "you have unread messages", feature announcements |

That last row is a product commitment made in onboarding (§ 01.7 step 9). It is
recorded here so it cannot be quietly walked back.

---

## 5. Universal search

### 5.1 Behaviour

One field, five result types. Opening from Home focuses the field and shows recents.

```
┌──────────────────────────────┐
│ ┌──────────────────────────┐ │
│ │ ⌕ anaya              ✕  │ │
│ └──────────────────────────┘ │
│ (All) People Messages Media ⋯│
│                              │
│  PEOPLE                      │
│  ⬤ Anaya Sharma  @anaya      │
│                              │
│  MESSAGES                4 › │
│  ⬤ Anaya Sharma      11:30   │
│    …where are we **meeting**?│
│                              │
│  MEDIA                   6 › │
│  ▨ ▨ ▨ ▨ ▨ ▨                │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Debounce | 250ms. Local results are instant; remote results fill in |
| Sections | People, Messages, Communities, Media, Files — in that order, each capped at 3 with a `›` to expand |
| Match highlight | The matched substring in **medium weight**, not a coloured background |
| Empty query | Recent searches, then recent conversations |
| No results | Per § [02.1.6](./02-messaging.md#16-empty-states--four-distinct-cases) |
| Scope filter | The chip row narrows to one type |

### 5.2 Search inside a conversation

From the thread's `⋯` menu. The header becomes a search field; matches are
highlighted in place with `↑ ↓` navigation and an `n of m` counter. Exiting restores
the previous scroll position.

### 5.3 Encryption consequence

Message search is **local-only**, because the server cannot read message content.
This means:
- Results cover messages present on **this device**.
- A caption states it once, plainly, at the bottom of message results: *"Searching
  messages on this device."*
- It is a feature, not a limitation, and the copy treats it that way.

---

*Previous: [02 — Messaging](./02-messaging.md) · Next: [04 — Settings](./04-settings.md)*
