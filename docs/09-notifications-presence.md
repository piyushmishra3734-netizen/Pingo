# 09 — Notifications & Presence

Every presence indicator, notification behaviour, badge, privacy rule and sync rule,
identical across Web, Android and iOS.

---

## 0. First: these are four different things

The brief lists twenty "presence states" as one set. They are not one set, and treating
them as one is the mistake that makes presence systems inconsistent and leaky. They have
different **scopes**, different **owners**, and — critically — different **privacy
rules**.

| Family | Scope | Whose state | Broadcast? | Privacy-controlled? |
| --- | --- | --- | --- | --- |
| **A · Presence** | The person, globally | Another user | Yes | **Yes** — the user chooses who sees it |
| **B · Activity** | The person, in one conversation | Another user | Yes, to that conversation only | Yes, tied to typing-indicator setting |
| **C · Delivery** | One message | A message I sent | Yes, to the sender only | Yes, tied to read receipts |
| **D · Connection** | My own device | Me | **Never** | No — it is mine, and only I see it |

Mapping the twenty states:

| Family | States |
| --- | --- |
| **A · Presence** | Online · Away · Offline · Do Not Disturb · Invisible · Last Seen · Active Now |
| **B · Activity** | Typing · Recording Voice · Uploading Media |
| **C · Delivery** | Queued · Failed · Delivered · Read · Played |
| **D · Connection** | Connecting · Reconnecting · Offline (own) · Queued (own) · Retrying |

### Two consequences worth stating up front

**1 · "Downloading Media" is never broadcast.** It appears in the brief's presence list,
but broadcasting that someone is downloading tells the sender when a recipient opened a
conversation and how fast their connection is — with no benefit to anyone. It is a
**family D** state: local, visible only to the person doing it. *Uploading* is broadcast,
because "Anaya is sending a photo" genuinely explains a delay the recipient can see.

**2 · "Offline" and "Queued" appear in two families and mean different things.** My own
`offline` is a fact about my device that I always see. Someone else's `offline` is a
*disclosure* they control and may have hidden. Same word, opposite privacy handling.
They must never share a code path, or a privacy setting will eventually leak through the
wrong one.

---

## 1. Family A — Presence states

All seven render through one component: `PingoDot` on an `Avatar`
([05 § 10](./05-components-responsive.md#10-avatar-)). One component, so presence cannot
drift between surfaces.

| State | Visual | Icon / shape | Colour | Animation | Reader announcement |
| --- | --- | --- | --- | --- | --- |
| **Online** | Dot on avatar's lower-right, page-coloured ring | Filled circle | `dot` `#8B5DFF` | `dot-pulse` — 1400ms breath, 0.55 opacity floor. **Never a blink** | `"Anaya is online"` |
| **Away** | Same dot, hollow | Ring, 2px stroke, transparent centre | `away` `#F0B252` | **None.** Static | `"Anaya is away"` |
| **Offline** | **No indicator at all** | — | — | Dot fades out 180ms | Nothing on the dot; the header reads `"last seen 2 hours ago"` |
| **Do Not Disturb** | Dot with a horizontal bar through it | Circle + 2px inset bar | `dot` at 55% opacity | **None.** Static | `"Anaya has notifications off"` |
| **Invisible** | Renders exactly as **Offline** to others. Own devices show a hollow dot + caption | — / ring | — / `secondary` | None | To others: as offline. To self: `"You're invisible"` |
| **Last Seen** | Text only, chat header and profile | — | `text-secondary` | None | `"last seen yesterday at 9:12 PM"` |
| **Active Now** | Text only — the *textual* form of Online | — | `brand` | None | `"active now"` |

### 1.1 Rules

- **Offline shows nothing, not a grey dot.** An absent dot is the clearest possible
  "not here," and it keeps a quiet list quiet. A grey dot is visual noise on every row.
- **Away is hollow, not amber-filled.** Shape carries the state so it survives
  monochrome, forced-colours and colour-blindness
  ([06 § 4.3](./06-accessibility.md#43-never-colour-alone)).
- **Only Online animates.** It is the one state meaning *right now*.
- **`away` amber appears in exactly two places** in the whole product: this dot and the
  Security overview's ⚠ row. It is not a palette colour, it is a semantic exception.
- **Active Now and Online are the same fact** in two presentations — dot on an avatar,
  words in a header. They can never disagree because they read the same field.

### 1.2 Transitions

| From → To | Behaviour |
| --- | --- |
| Offline → Online | Dot scales 0 → 1 over 180ms, then begins pulsing |
| Online → Away | Fill cross-fades to ring over 180ms; pulse stops |
| Online → Offline | **30-second grace period**, then fades out over 180ms |
| Away → Online | Ring fills over 180ms; pulse starts |
| Any → DND | Bar wipes in from the left over 120ms |
| Invisible toggled on | Own dot cross-fades to hollow, 180ms. A one-time snackbar: *"You're invisible. You won't see others' online status either."* |

**The 30-second offline grace period is load-bearing.** Mobile networks drop sockets
constantly. Without it, a stationary user's dot flickers on and off all day, which reads
as a bug and trains users to ignore the indicator.

### 1.3 Privacy behaviour — and reciprocity

| Setting | Options | Default |
| --- | --- | --- |
| Last seen | Everyone · Contacts · Custom · Nobody | **Contacts** |
| Online status | Everyone · Contacts · Custom · **Same as last seen** | Same as last seen |

**Custom** opens a member picker with include/exclude lists, matching the Moments
pattern ([04 § 8](./04-settings.md#8-privacy)).

**Reciprocity is absolute, and stated before the choice is made:**

> Hiding your last seen means **you cannot see anyone else's.**
> Being invisible means **you cannot see who is online.**

This is the only defensible rule. A one-way switch would turn presence into a
surveillance advantage for whoever reads the settings screen most carefully — which is
precisely the dynamic a calm product must not create.

The reciprocity warning appears **in the row's description**, before the choice, never as
a consequence discovered afterwards.

| Setting | What the *other* party sees |
| --- | --- |
| Last seen hidden | No last-seen line. Header shows the name only |
| Online hidden | No dot, ever. Identical to genuine offline — **not** a distinguishable "hidden" state |
| DND | Visible to everyone who can see presence at all. It is a courtesy signal, so hiding it would defeat its purpose |
| Invisible | Indistinguishable from offline. Never leaks through typing, read receipts, or delivery timing |

**Invisible must not leak.** If a user is invisible, typing indicators and read receipts
from them are suppressed too — otherwise "offline but typing" reveals the deception, which
is worse than not offering the feature.

---

## 2. Family B — Activity states

Scoped to one conversation. Broadcast per **user**, not per device
([07 § 5.1](./07-offline-sync.md#51-model)).

| State | Visual | Colour | Animation | Reader announcement |
| --- | --- | --- | --- | --- |
| **Typing** | Three dots + `Anaya is typing` | `brand` text, `dot` dots | `dot-typing` — 3px lift, 1200ms, staggered −400/−200/0ms | `"Anaya is typing"` |
| **Recording Voice** | Mic glyph + `Anaya is recording` | `brand` | Haloed `recording` dot — pulsing halo, solid centre | `"Anaya is recording a voice message"` |
| **Uploading Media** | Image glyph + `Anaya is sending a photo` | `brand` | `dot-pulse` on a single dot | `"Anaya is sending a photo"` |

### 2.1 Where activity appears

| Surface | Presentation |
| --- | --- |
| Conversation row | **Replaces the preview line** entirely |
| Chat header | **Replaces the presence line** entirely |
| Thread | A bubble-shaped indicator at the thread's foot, left-aligned |
| Avatar dot | **Never.** The row already says it in words; two channels for one fact is redundant, and the three-dot group overflows the avatar's footprint |

That last row was found in implementation and is now a rule.

### 2.2 Anti-flicker timings

The single most important part of this document. A typing indicator that flickers is
worse than none.

| Timing | Value | Why |
| --- | --- | --- |
| **Show delay** | 400ms of continuous typing | Filters out a stray keystroke or a typo correction |
| **Hide delay** | 3000ms after the last keystroke | People pause mid-sentence. Hiding at 500ms produces a strobe |
| **Hard ceiling** | 15s, then force-hide | A user who walked away mid-message must not appear to type forever |
| **Broadcast throttle** | One event per 2s max, per user per conversation | Not per keystroke |
| **On send** | Clears **immediately**, no hide delay | The message arriving is proof they stopped |
| **On conversation close** | Clears immediately | — |
| **On disconnect** | Server clears after 10s of socket silence | Otherwise a crashed client types forever |
| **Minimum visible time** | 1000ms once shown | Prevents a 400ms flash if they stop right after the show threshold |

**Recording and uploading use no show delay** — both are unambiguous, deliberate acts
with no false-positive risk. Their hide is immediate on completion or cancellation.

### 2.3 Multiple users

| Count | Label |
| --- | --- |
| 1 | `Anaya is typing` |
| 2 | `Anaya and Alex are typing` |
| 3+ | `3 people are typing` |

First names only. Never a stack of avatars — in a busy group that becomes an animated
crowd at the top of the thread. The count is calmer and more informative.

**Mixed activities** resolve by priority, showing one line only:
`recording` > `uploading` > `typing`. Two people doing different things reads as
`2 people are active`.

### 2.4 Privacy

Governed by one setting: **Privacy → Typing indicators**, and it is **reciprocal** — off
means you send none *and* see none. It covers all three activity states, because
"recording" and "uploading" leak the same information typing does.

Suppressed entirely when the user is Invisible.

---

## 3. Family C — Delivery states

The state of **one message I sent**. Visible to the sender only.

| State | Glyph | Colour | Animation | Reader announcement |
| --- | --- | --- | --- | --- |
| **Queued** | Clock | `text-tertiary` | None. Bubble stays **100% opacity** | `"Waiting to send"` |
| Sending | Three dots | `text-tertiary` | `dot-pulse`, 3px | `"Sending"` |
| Sent | Single check | `text-tertiary` | 120ms cross-fade from previous | `"Sent"` |
| **Delivered** | Double check | `text-tertiary` | 120ms cross-fade | `"Delivered"` |
| **Read** | Double check | **`brand`** | 120ms colour cross-fade | `"Read"` |
| **Played** | Double check + small waveform | **`brand`** | 120ms | `"Played"` |
| **Failed** | `Not sent · Retry` | `danger` | Opacity → 0.6, danger ring fades in 180ms | `"Not sent. Double tap to retry."` |

### 3.1 Rules

- **Queued is never confused with failed.** Different glyph (clock vs text), different
  opacity (100% vs 60%), different announcement, different colour family. A queued
  message is *held on purpose*; a failed one *needs the user*. Conflating them is the
  defect this section exists to prevent.
- **Only Read and Played are brand-coloured.** Sent and delivered share tertiary grey, so
  the eye is drawn to the one transition that means something to a sender.
- **Only the glyph distinguishes sent from delivered** — one check vs two — because they
  share a colour. This is deliberate: it satisfies "never colour alone" from the opposite
  direction.
- **No haptic and no animation beyond a colour swap** on any delivery transition. They
  fire constantly ([08 § 2.2](./08-microinteractions.md#22-messaging)).
- **Played applies only to voice notes**, and is a genuinely distinct fact from Read: a
  user can open a chat without listening. Conflating them would misreport.

### 3.2 Privacy

**Privacy → Read receipts**, reciprocal: off means you send none and see none. Off →
delivery tops out at `Delivered` in both directions.

**Voice-note "Played" has its own toggle**, because listening is a stronger signal than
reading. It can be off while read receipts are on, never the reverse.

**Always on in groups.** A per-member matrix of who-can-see-what would be unreadable, and
a group where receipts are individually negotiable is a group where nobody knows what the
ticks mean.

---

## 4. Family D — Connection states

**My own device.** Never broadcast, never a privacy setting. Full behaviour in
[07 § 1](./07-offline-sync.md#1-connection-states); the presentation contract is here.

| State | Strip copy | Dot | Appears after |
| --- | --- | --- | --- |
| **Connected** | — | — | Nothing is shown. The default needs no indicator |
| **Connecting** | `Connecting…` | `loading` | 2s |
| **Reconnecting** | `Reconnecting…` | `loading` | 2s |
| **Offline** | `Offline · Messages will send when you reconnect` | `idle` (static — nothing is happening) | 2s |
| **Retrying** | `Retrying…` | `loading` | Only if a retry exceeds 2s |
| **Restored** | `Back online` | `online` | Immediately, held **1.5s**, then removed |

| | |
| --- | --- |
| Colour | **Brand, never red or amber.** Being offline is a condition, not an error |
| Motion | Water in (240ms), water out (180ms `ease-exit`) |
| Dismissible | **No.** It is state; it leaves when the state leaves |
| Haptic | **None.** Not user-initiated, and can repeat on a train |
| Reader | `polite` — `"You're offline. Messages will send when you reconnect."` / `"Back online."` |

**The 2-second delay and the 1.5-second "Back online" are both mandatory.** Without the
delay, a 300ms blip flashes a warning. Without the confirmation, the strip vanishing is
ambiguous — did it reconnect, or did the strip break?

---

## 5. Push notifications

### 5.1 Types, individually configurable

| Type | Default | Notes |
| --- | --- | --- |
| Messages — personal | **On** | The core case |
| Messages — group | On | Overridable per conversation |
| Messages — community | **Mentions only** | Communities are larger by nature, so they default lower |
| Mentions | **On** | Fires **even in a muted conversation** — an explicit @ is a direct address |
| Replies | On | A reply to your message, distinct from a mention |
| Calls | **On** | |
| Missed calls | On | |
| Announcements | On | Community announcements only, which are already rate-limited by being admin-only |
| Friend requests | On | |
| Media | **Off** | *"Anaya sent a photo"* when you already got *"Anaya sent a message"* is a duplicate |
| Reactions | **Off** | A reaction is not a message. This default is where notification fatigue is prevented |
| Downloads complete | Off | |
| Uploads complete | Off | |
| Security | **On, and not disableable** | New sign-ins, password changes, recovery attempts |
| Updates | Off | |
| **Marketing / re-engagement** | **Does not exist** | A commitment made in onboarding ([01 § 7 step 9](./01-onboarding-auth.md#11-notifications)) |

**Security notifications cannot be turned off.** They are the fallback that makes account
takeover survivable, and a user who disabled them would not learn they had been
compromised.

### 5.2 Categories and channels

Mapped to platform primitives so users can tune them in OS settings too.

| Category | Android channel | iOS thread | Priority |
| --- | --- | --- | --- |
| Personal chats | `chats_personal` | per-conversation | High |
| Group chats | `chats_group` | per-conversation | High |
| Communities | `communities` | per-channel | Default |
| Calls | `calls` | — | **Max**, full-screen intent |
| Mentions | `mentions` | per-conversation | High |
| System | `system` | — | Low |
| Security | `security` | — | High |
| Updates | `updates` | — | Low |
| Downloads | `transfers` | — | **Min**, silent, progress only |
| Uploads | `transfers` | — | Min, silent, progress only |

**Grouping is by conversation, natively.** PINGO never composes a digest — no
"3 conversations have new messages". The OS groups better than we can, and a
self-composed digest is a step toward the "importance" ranking we refuse to build
([00 § 7](./00-principles.md#7-what-pingo-deliberately-does-not-have)).

### 5.3 Notification anatomy

```
┌──────────────────────────────┐
│ * PINGO                 now  │
│ Anaya Sharma                 │
│ Hey! Where are we meeting?   │
│                              │
│  [ Reply ]      [ Mark read ]│
└──────────────────────────────┘
```

| | |
| --- | --- |
| Icon | The app icon, `light` variant. **Never** a per-sender avatar as the small icon |
| Large icon | The sender's avatar or monogram |
| Title | Sender name. In a group: `Anaya · Design Team` |
| Body | Message text, subject to the privacy level below |
| Actions | `Reply` (inline) and `Mark read`. Two, never more |
| Colour | Brand accent tint only. No coloured backgrounds, no category colours |
| Sound | One soft tone, ≤ 400ms, no melody ([08 § 4](./08-microinteractions.md#4-sound)) |

---

## 6. Notification privacy

### 6.1 Four content levels

One setting, applied everywhere.

| Level | Title | Body | Use |
| --- | --- | --- | --- |
| **Show preview** *(default)* | Sender name | Message text | Personal device |
| **Show sender only** | Sender name | `New message` | Shared or visible screen |
| **Hide content** | `PINGO` | `New message` | Public / work context |
| **Hide everything** | — | — | No notification at all; the badge still updates |

`Hide everything` still increments the badge, because suppressing the notification is a
privacy choice, not a request to be uninformed.

### 6.2 Per-surface behaviour

Each surface can override the global level **downward** (more private), never upward.

| Surface | Default | Notes |
| --- | --- | --- |
| **Lock screen** | Follows global | Independently settable. Most users want stricter here than when unlocked |
| **Unlocked / banner** | Follows global | |
| **Desktop** | Show sender only | Desktop screens are the most likely to be visible to others — shoulder-surfing, screen shares, projectors |
| **Wearables** | Show sender only | Glanceable by anyone nearby; the small screen cannot hold a message anyway |
| **Car / Android Auto** | Sender only, read aloud on request | Never auto-read; a passenger hears it too |
| **App switcher preview** | Blurred if `Hide message previews` is on | |
| **Screen sharing detected** | **Forced to `Hide content`** | Platform-dependent; where the API exists, we use it |

**Desktop and wearables default stricter than mobile.** A phone in a hand is
approximately private; a desktop in an office is not.

### 6.3 Screen-share protection

Where the platform exposes a screen-capture or -share signal, notifications drop to
`Hide content` for its duration, and a one-time snackbar explains: *"Notification
previews hidden while you're sharing your screen."* This is the single highest-value
privacy behaviour in this document, and it costs the user nothing.

---

## 7. Quiet hours

### 7.1 Configuration

| Setting | Options | Default |
| --- | --- | --- |
| Enabled | Toggle | Off |
| Schedule | Start / end time | 22:00 – 07:00 |
| Days | Every day · Weekdays · Weekends · Custom per-day | Every day |
| Allow calls | Toggle | **On** — an emergency is usually a call |
| Allow repeat calls | Toggle | On — a second call from the same person within 3 minutes rings |
| Favourite contacts | Always allowed | Off |
| Emergency contacts | **Always allowed, cannot be disabled** | — |
| Allow mentions | Toggle | Off |

### 7.2 Behaviour

| | |
| --- | --- |
| During quiet hours | Notifications are **silent and not shown**, but delivered. The in-app inbox and badges update normally |
| Never | Delayed, dropped, or batched into a morning digest. Silence is not deferral |
| On exit | **No catch-up burst.** The badge already carries the count; twelve notifications at 07:00 is an alarm clock nobody asked for |
| Emergency contacts | Ring through at full volume regardless of every other setting, including Do Not Disturb |
| Indicator | A small moon glyph beside the notification row in Settings while active. Never a persistent banner |

**Emergency contacts are the one override nothing can suppress.** A user designating
someone as an emergency contact is making a safety decision, and a notification setting
must not be able to defeat it.

---

## 8. Badges

### 8.1 What counts

| Badge | Counts | Excludes |
| --- | --- | --- |
| Conversation row | Unread messages in that conversation | — |
| Dock — Chats | Sum of unread across all conversations | **Muted conversations** |
| Dock — Calls | Missed calls since last visit | Answered, declined |
| Dock — Communities | Unread **mentions** only | Ordinary channel traffic |
| Dock — Profile | Friend requests + security alerts | — |
| App icon | Same as Dock — Chats | Muted |
| Desktop / taskbar | Same as app icon | Muted |
| Web favicon / title | Same as app icon | Muted |

### 8.2 Rules

1. **Muted conversations are excluded from every aggregate badge**, but keep their own row
   badge in **neutral grey**. Mute means *"don't interrupt me,"* not *"lie to me about
   what's there."*
2. **Never render zero.** A `0` badge is noise. The component returns `null`.
3. **Never badge a surface the user is looking at.** The Chats badge hides while Chats is
   the active destination — a count you are already reading is anxiety with no action
   attached.
4. **Cap at `99+`** so a badge can never stretch a layout.
5. **Communities badge counts mentions, not messages.** A 400-member community produces
   thousands of messages; badging them all makes the badge meaningless within a day.
6. **One digit stays a perfect circle**; larger counts grow sideways only.

### 8.3 Synchronisation

The count is **derived, never stored**: `sum(unread) where not muted`, computed locally
from the conversation list. There is no separate badge counter to drift out of step —
this is the design decision that makes cross-device badge accuracy structural rather
than something to keep patching.

| Event | Propagation |
| --- | --- |
| Read on any device | All devices recompute within one round trip (< 1s) |
| Notification withdrawn | Reading on any device dismisses it on **all** of them |
| App backgrounded | Badge recomputed and pushed to the OS before suspending |
| Cold launch | Badge from cache first, corrected after sync — never a flash of zero |
| Push received while closed | Server includes the authoritative unread count in the payload, so the badge is right before the app ever runs |

**The server sends the count in the push payload.** Without it, a badge can only update
when the app runs, which is exactly when it is least needed.

### 8.4 Accessibility

Every badge announces its meaning, never a bare number:

| Badge | Announcement |
| --- | --- |
| Row badge | `"2 unread messages"` |
| Muted row badge | `"2 unread messages, muted"` |
| Dock Chats | `"Chats, 3 unread messages"` |
| Dock Calls | `"Calls, 1 missed call"` |
| Communities | `"Communities, 2 mentions"` |
| `99+` | `"More than 99 unread messages"` |

---

## 9. Presence sync

| | |
| --- | --- |
| Broadcast unit | **One per user**, not per device. Three signed-in devices do not make someone more online |
| Aggregation | A user is Online if **any** device is active. Away if all are idle > 5 min. Offline 30s after the last disconnects |
| Own devices | Each device shows its **own** connection state (family D) and the account's presence (family A). They are different rows of information |
| Manual states | DND and Invisible are **account-level** — set on the phone, in effect on the desktop within 2s |
| Activity states | Deduplicated per user. Typing on a phone and desktop broadcasts once |
| Latency target | Presence < 2s · typing < 300ms · read state < 1s |
| Transport | The same event stream as messages ([07 § 5](./07-offline-sync.md#5-multi-device-sync)) |

**Presence is derived from connections, not reported by clients.** A client that crashes
cannot leave a stale "online" behind, because it never asserted it in the first place.

---

## 10. Design constraints

Per the branding board and [00](./00-principles.md).

| | |
| --- | --- |
| Colours | Brand, `dot` purple, and `text-secondary`. **`away` amber is the sole exception**, used only for the Away ring |
| Never | Red or green presence dots; category colours on notifications; coloured notification backgrounds |
| Motion | Only Online pulses. Only Typing lifts. Everything else is static |
| Amplitude | ≤ 3px travel on any presence animation |
| Reduced motion | All ambient loops stop; typing becomes the static text `Anaya is typing` |
| Notification design | App icon, sender avatar, brand accent tint. No illustration, no imagery, no expressive animation |
| Sound | One tone, ≤ 400ms, no melody |
| Haptic | Notifications use the platform default. **Delivery and connection states never vibrate** |

---

## 11. Accessibility summary

Every announcement in one place, for review. Contracts — a change is a spec change.

| Element | Announcement |
| --- | --- |
| Online dot | `"Anaya is online"` |
| Away dot | `"Anaya is away"` |
| Offline | *(dot silent)* — `"last seen yesterday at 9:12 PM"` |
| DND | `"Anaya has notifications off"` |
| Own invisible | `"You're invisible"` |
| Typing | `"Anaya is typing"` |
| Recording | `"Anaya is recording a voice message"` |
| Uploading | `"Anaya is sending a photo"` |
| Queued | `"Waiting to send"` |
| Sending | `"Sending"` |
| Sent / Delivered / Read | `"Sent"` / `"Delivered"` / `"Read"` |
| Played | `"Played"` |
| Failed | `"Not sent. Double tap to retry."` |
| Connection lost / restored | `"You're offline. Messages will send when you reconnect."` / `"Back online."` |
| Any badge | Number **plus** its unit — never a bare number |
| Notification | `"Message from Anaya Sharma: Hey, where are we meeting?"` |
| Notification, private | `"New message"` |

**Live-region politeness** is defined in
[06 § 1.4](./06-accessibility.md#14-live-regions). Only failures are `assertive`; typing
and progress announce **nothing**, because a screen reader narrating every typing event is
unusable.

---

*Previous: [08 — Microinteractions](./08-microinteractions.md) · Next: [10 — Media System](./10-media-system.md)*
