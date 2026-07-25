# 07 — Offline & Sync Behaviour

Part of the design system. Every screen must behave correctly on a bad connection,
because a bad connection is the normal condition, not the exception.

---

## The premise

Most messaging apps are designed online and then patched for offline. The patch shows:
spinners that never resolve, messages that vanish, and a UI that lies about whether
something was sent.

PINGO inverts it. **The local database is the source of truth for what the user sees.
The network is an input that updates it.** A screen never waits for the network to
render, and never claims a state it cannot verify.

This is also a calm requirement. Uncertainty about whether a message sent is one of the
most stressful things a messaging app can produce, and it is entirely avoidable.

---

## 1. Connection states

Four states. The UI distinguishes all four, because they mean different things to the
user.

| State | Meaning | Surfaced as |
| --- | --- | --- |
| `connected` | Socket open, synced | **Nothing.** The default needs no indicator |
| `connecting` | Attempting or re-attempting | Nothing for the first 2s; then a quiet strip |
| `offline` | No network, or server unreachable | Persistent strip |
| `degraded` | Connected but round-trips are slow (> 3s p50) | Nothing, but timeouts lengthen and quality auto-drops |

### 1.1 The connection strip

Below the header, glass, full width, `caption`.

```
┌──────────────────────────────┐
│ PINGO                     +  │
├──────────────────────────────┤
│ ⬤ Offline · Messages will    │  ← strip
│   send when you reconnect     │
├──────────────────────────────┤
```

| | |
| --- | --- |
| Appears | After **2s** of non-connected state. Never instantly — a 300ms blip must not flash a warning |
| Motion | Water in (translateY, 240ms), water out (180ms `ease-exit`) |
| Dot | Purple in `idle` when offline (static — nothing is happening), `loading` when connecting |
| Copy, offline | *"Offline · Messages will send when you reconnect"* |
| Copy, connecting | *"Reconnecting…"* |
| Copy, reconnected | *"Back online"* — held for **1.5s**, then removed |
| Dismissible | **No.** It is state, not a notification. It leaves when the state leaves |
| Colour | Brand, never red or amber. Being offline is not an error — it is a condition |

**The "Back online" confirmation matters.** Without it the strip vanishing is
ambiguous: did it reconnect, or did the strip break? 1.5s of explicit confirmation
removes the doubt.

### 1.2 What stays interactive offline

Everything except the network itself. Specifically:

| Works offline | Requires connection |
| --- | --- |
| Reading all cached conversations | Loading history beyond the cache |
| Composing and "sending" (queued) | Voice and video calls |
| Recording voice notes | Server-side search |
| Attaching media (queued) | Fetching a link preview |
| Search over cached messages | Joining a community |
| All of Settings | Username availability check |
| Reactions (queued) | New device sign-in |
| Pin, mute, archive, mark read (queued) | Media not yet downloaded |

**No screen is blocked, and no screen shows a full-screen offline state.** A blocking
"You're offline" screen is the single worst pattern in this area — it removes access to
data the user already has.

Controls that genuinely cannot work are **dimmed with an inline reason**, not hidden:
the call button becomes 45% opacity with a tooltip/caption *"Calls need a connection."*

---

## 2. The send queue

### 2.1 Guarantees

Three promises the UI makes and must keep:

1. **A composed message is never lost.** It is persisted locally before the composer
   clears.
2. **A message's visible state always matches its real state.** No optimistic "sent"
   tick before the server acknowledges.
3. **Order is preserved.** Messages send in composition order per conversation, even
   across app restarts.

### 2.2 State machine

```
composing → queued → sending → sent → delivered → read
                ↓        ↓
             (offline) failed → (retry) → sending
```

| State | Bubble presentation | Reader announcement |
| --- | --- | --- |
| `queued` | Full bubble, 100% opacity, **clock glyph** in the tick slot | `"Waiting to send"` |
| `sending` | Full bubble, dots in the tick slot | `"Sending"` |
| `sent` | Single check | `"Sent"` |
| `delivered` | Double check, tertiary | `"Delivered"` |
| `read` | Double check, brand | `"Read"` |
| `failed` | 60% opacity, `danger` ring, `Not sent · Retry` | `"Not sent. Double tap to retry."` |

**`queued` is a distinct state with its own glyph.** Showing a queued message as
"sending" is a lie, and showing it as failed is a false alarm. The clock says
*"held, on purpose, and I know about it."*

Queued bubbles render at **full opacity**. Dimming them implies something is wrong; the
clock glyph carries the state without suggesting failure.

### 2.3 Retry policy

| | |
| --- | --- |
| Trigger | Connection restored, app foregrounded, or manual tap |
| Backoff | 1s, 2s, 4s, 8s, 16s, 30s, then every 30s |
| Jitter | ±20%, so a reconnecting fleet does not stampede the server |
| Max automatic attempts | **Unlimited while queued.** A message is not abandoned |
| Marked `failed` | Only on a *definitive* server rejection — 4xx, too large, blocked recipient. Never on a timeout |
| Ordering | Strictly sequential per conversation. A stuck message blocks only its own thread |
| Head-of-line relief | After 3 failures the stuck message is set aside and later messages proceed; the set-aside one shows `Not sent · Retry` |

**Timeouts never mark a message failed.** A timeout means "we don't know," and the
honest presentation of "we don't know" is `queued`, not `failed`.

### 2.4 Queue visibility

If more than 3 messages are queued, the composer gains a caption:

```
┌──────────────────────────────┐
│ ⬤ 5 messages waiting to send │
│ ┌──────────────────────┐ ╭─╮ │
│ │ + Type a message… ☺ │ │🎤│ │
│ └──────────────────────┘ ╰─╯ │
└──────────────────────────────┘
```

Tapping it opens a sheet listing the queued messages with `Retry all` and
`Delete all`. Beneath 4 messages the per-bubble clock glyphs are sufficient — a
summary would be redundant.

---

## 3. Media uploads

### 3.1 Upload states

| State | Presentation |
| --- | --- |
| `queued` | Bubble at full size with the media's blurred placeholder + clock glyph |
| `uploading` | Determinate brand bar along the bubble's lower edge |
| `processing` | Indeterminate — the monogram dots. Server-side work, duration unknown |
| `sent` | Normal bubble |
| `failed` | 60% opacity, `danger` ring, tap to retry. **Never auto-deleted** |

**The bubble appears immediately at its final size**, using the media's real aspect
ratio and a blurred placeholder. Media that pops into a placeholder shifts the layout
under the reader (Law 5).

### 3.2 Upload policy

| | |
| --- | --- |
| Resumable | Chunked, so a 40MB video survives a tunnel. Resumes from the last chunk, not from zero |
| Concurrency | 2 uploads at a time; the rest queue. More saturates a mobile link and slows everything |
| Ordering | Media and text interleave in composition order. A queued photo does not jump ahead of text sent after it |
| Wi-Fi only | Respects Chats → Media auto-download for *receiving*; uploads always proceed, because the user explicitly chose to send |
| Large file warning | Over 25MB on mobile data, a one-time inline caption with `Send anyway` / `Wait for Wi-Fi`. `Wait for Wi-Fi` keeps it queued with a distinct caption |
| Cancel | Available at any point from the bubble's context menu. Cancelling removes the bubble |
| Local copy | Kept until the server acknowledges. Never deleted on a failed upload |

### 3.3 Downloads

- Received media downloads per the auto-download matrix; otherwise the bubble shows a
  tap-to-download state with the file size.
- A failed download is retryable in place and **never** replaces the bubble with an
  error.
- Auto-deleted media ([04 § 7](./04-settings.md#7-storage)) leaves the bubble present
  with `Media removed · Download again` — the message is not the media, and losing one
  must not lose the other.

---

## 4. Conflict resolution

### 4.1 The general rule

**Messages never conflict — they are append-only and ordered by server timestamp.**
Everything else is metadata, and metadata conflicts resolve by explicit rules rather
than last-write-wins, which loses user intent.

### 4.2 Rules by data type

| Data | Resolution | Why |
| --- | --- | --- |
| Messages | Server sequence number. Local order is provisional until acknowledged | Append-only; no conflict possible |
| Read state | **Most-read wins.** Read on any device marks read everywhere; unread never resurrects | Un-reading something the user read is a false alarm |
| Manual "mark unread" | Explicit action beats automatic. Wins over a stale read from another device | It is a deliberate act, and deliberate beats incidental |
| Reactions | Set union per user per emoji. A removal is an explicit tombstone, not an absence | Otherwise a slow device's stale state re-adds removed reactions |
| Pin / mute / favourite | Last write wins, by client timestamp | Low stakes, and the user sees the result immediately |
| Draft text | **Longest wins**, then most recent. A second device typing shows `Editing on another device` | Users lose more from a truncated draft than a stale one |
| Settings | Last write wins per **field**, not per object | Field-level merging stops a stale device reverting an unrelated setting |
| Deleted message | Tombstone always wins, and is never resurrected | A delete is an unambiguous intent |
| Conversation order | Derived, never synced — computed locally from pinned + `updatedAt` | Deterministic everywhere with nothing to conflict |
| Scroll position | **Not synced** | Moving another device's viewport violates Law 5 |

### 4.3 Clock skew

Client clocks are wrong. Every displayed timestamp is the **server's**, with the local
time used only for provisional ordering of unsent messages.

If a client's clock is off by more than 5 minutes, message ordering silently corrects on
acknowledgement — the provisional bubble reflows into its correct position **only while
the user is at the bottom of the thread.** If they are reading history, the correction is
deferred until they return to the bottom (Law 5).

### 4.4 Edit and delete races

| Race | Resolution |
| --- | --- |
| Edit while offline, recipient already read | Edit applies; the bubble shows `edited`. Recipients see the edit and the marker |
| Edit after the 15-minute window closes | Rejected server-side. The local edit reverts with a snackbar: *"Too late to edit that one."* |
| Delete-for-everyone while offline | Queued. Applies on reconnect if within the window; otherwise reverts to delete-for-me with a snackbar explaining |
| Two devices edit the same message | Last acknowledged wins. The losing device's edit surfaces in a snackbar with `View` |

---

## 5. Multi-device sync

### 5.1 Model

One event stream, one reducer, every device. A device is a **view** of the account, not
an owner of state.

| | |
| --- | --- |
| Transport | WebSocket, with long-poll fallback |
| Delivery | At-least-once. Every event carries an id, and clients de-duplicate |
| Ordering | Per-conversation sequence numbers. A gap triggers a targeted backfill, not a full resync |
| Catch-up | On reconnect, the client sends its last-seen sequence per conversation and receives only the delta |
| Presence | One broadcast per **user**, not per device. Three signed-in devices do not make someone "more online" |
| Typing | Deduplicated per user across devices |

### 5.2 What syncs and how fast

| | Target latency |
| --- | --- |
| Message send → recipient | < 500ms p50 |
| Message → own other devices | < 500ms p50 |
| Read state | < 1s |
| Typing start/stop | < 300ms |
| Settings change | < 2s, and never blocks the UI |
| Profile edit | < 2s |
| Draft | Debounced 2s — syncing per keystroke is wasteful and racy |

### 5.3 Cross-device rules

- **Read state converges within one round trip.** A user who reads on their phone must
  not find the badge still on their desktop a minute later; this is the most-noticed
  sync defect in messaging apps.
- **No device is authoritative.** Any device can send, react, or change settings.
- **Sent messages arrive via the event stream, not local echo.** The same code path
  renders our own messages and everyone else's, so the two can never diverge.
- **Notifications suppress across devices.** A message read on any device withdraws its
  notification from all of them.

---

## 6. First sync on a new device

Signing in on a new device loads history from the server. This must be a **designed
state**, not a blank list that slowly fills.

```
┌──────────────────────────────┐
│ PINGO                        │
│                              │
│            P•                │  ← monogram, loading
│                              │
│    Getting your messages     │
│                              │
│  ▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░       │
│    Recent conversations      │
│                              │
└──────────────────────────────┘
```

### 6.1 Staged loading

The order is chosen so the product becomes usable as early as possible.

| Stage | Loads | Usable at this point |
| --- | --- | --- |
| 1 | Account, contacts, conversation list | **The list is browsable and searchable** |
| 2 | Last 50 messages per conversation | Threads open and are readable |
| 3 | Remaining history, newest-first, in background | Everything |
| 4 | Media, lazily on demand | — |

**The screen is dismissible after stage 1.** Users can start reading while stage 3
continues; a background caption in the header shows `Syncing older messages` with no
blocking.

### 6.2 Rules

- Progress is **determinate** where the count is known (conversations, messages), and
  indeterminate only for the initial handshake.
- The label names what is loading — *"Recent conversations"* — not a percentage in
  isolation.
- Interruption is safe: killing the app mid-sync resumes from the last completed
  conversation.
- A thread not yet backfilled shows a `Load earlier messages` control rather than
  pretending the history does not exist.
- **Never show an empty state during first sync.** *"No conversations yet"* on a
  ten-year-old account is the worst possible first impression, and it is purely a state
  bug.

---

## 7. Cache & eviction

| | |
| --- | --- |
| Cache scope | All messages ever received on this device, plus media per the download settings |
| Eviction order | Oldest media first, then oldest messages from archived conversations. **Never** messages from pinned or recent conversations |
| Eviction trigger | Device storage under 500MB free, or the user's Storage limit |
| Evicted content | Re-downloadable on demand, and the UI says so rather than showing a gap |
| Never evicted | Drafts, queued messages, starred items, settings |

Eviction is silent and reversible. A user should never discover it as a surprise — the
tap-to-download state is the same one used for media that was never downloaded, so it
is already familiar.

---

## 8. Error taxonomy

How each failure class is presented. The distinction that matters: **is this the user's
problem to solve, or ours?**

| Class | Example | Presentation | User action |
| --- | --- | --- | --- |
| Transient | Timeout, socket drop | Silent. Retry with backoff | None |
| Connectivity | No network | Connection strip | Wait, or nothing |
| Rejected | Message too large, blocked recipient | Inline on the bubble, specific reason | Fix and retry |
| Auth | Session expired | Sign-in screen, with drafts and queue preserved | Sign in |
| Permission | Camera denied | Inline where the control is, link to Settings | Grant, or don't |
| Rate limited | Too many attempts | Visible countdown + reason | Wait |
| Server | 5xx | Snackbar: *"Something went wrong on our side. We're retrying."* | None |
| Client bug | Unexpected exception | Screen-level fallback that keeps navigation working, plus `Report` | Report, or navigate away |

### 8.1 Error copy rules

- Name what happened, then what to do.
- **Never blame the user.** "Check your connection" is a mild accusation; "You're
  offline" is a fact.
- Never expose a code as the primary message. A code may appear as a caption for
  support.
- Never use a modal for something the user cannot act on.
- Retries are automatic and invisible until they matter. The user does not need to know
  about attempt three.

### 8.2 What must never happen

| Never | Because |
| --- | --- |
| A message disappears | The queue is persisted before the composer clears |
| A message shows `sent` when it was not | Acknowledgement drives the tick, not optimism |
| A full-screen offline blocker | It removes access to data the user already has |
| An infinite spinner | Every load has a timeout and a next state |
| A retry loop the user cannot see or stop | The queue sheet exposes and controls it |
| Silent data loss on logout | Nothing is lost; messages live on the account |
| An empty state during first sync | Stage 1 renders a loading state, never emptiness |

---

## 9. Testing requirements

Part of the definition of done, not a later audit.

| Scenario | Expected |
| --- | --- |
| Airplane mode → send 5 messages → reconnect | All 5 send, in order, once |
| Kill app with a full queue → relaunch | Queue intact, sends on reconnect |
| Send during a 3-second network blip | No strip flash, message sends normally |
| Upload a 40MB video, drop the network at 60% | Resumes from 60%, not 0% |
| Read on device A while device B is offline | Badge clears on B when it reconnects |
| Edit a message on two devices simultaneously | One wins; the loser is informed |
| Sign in on a new device with 10k messages | Usable after stage 1; no empty state |
| Throttle to 2G | No blocking spinner anywhere; all screens render |
| Set device clock 1 hour forward → send | Ordering corrects on ack, no viewport jump while reading history |
| Fill device storage | Eviction is silent; nothing pinned or recent is lost |

---

*Previous: [06 — Accessibility](./06-accessibility.md) · Next: [08 — Microinteractions & Haptics](./08-microinteractions.md)*
