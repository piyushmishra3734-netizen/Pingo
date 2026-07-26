# 13 · The message context menu
>
> **Status: frozen.** Build against this. Revisit only when real use shows a
> problem — theoretical optimisation past this point costs more than it returns.

Decided 2026-07-27. This is the spec for long-pressing a message, and the two
principles under it govern more than this one screen.

## § 1 Two principles

### 1.1 Everything originates from where the finger touched

Menus, sheets and viewers grow out of the thing that was touched, never out of a
screen edge. The story viewer already does this — it expands from the circle you
tapped rather than fading in over everything.

Applies to: story circle → viewer, thumbnail → full screen, profile photo →
zoom, `+` → attachment grid, message → context menu.

This is what separates "has animations" from "feels alive", and it costs nothing
once the origin rectangle is threaded through.

### 1.2 Progressive disclosure

| Level | Contents |
| --- | --- |
| 1 | React · Reply · Copy · Forward · More |
| 2 | Organise · Edit · Share · About · *(AI, when it applies)* |
| 3 | The individual actions |

Level 1 and the Level 2 **category headers never move and never hide**. That is
what lets a returning thumb find Star without reading. Level 3 contents may come
and go freely, because the header above them is the landmark.

## § 2 The menu is anchored to the message, not the screen

Not iMessage's overlay — beautiful, but the actions land near the top of a large
phone where a thumb cannot reach. Not Telegram's bottom sheet — reachable, and
indistinguishable from every other bottom sheet ever shipped.

```
              😊  ❤️  😂  👍  🔥  ➕        ← reactions, above the bubble
        ┌────────────────────────────┐
        │  Hey bro, see you at 8!    │     ← lifts 2–4px, soft shadow
        └────────────────────────────┘
              ↩  Reply
              📋  Copy                      ← actions, below the bubble
              📤  Forward
              ⋯  More
```

**The menu follows the message.** Near the bottom of the screen it flips above;
near the top it stays below. The reaction bar and the action list may end up on
either side — what stays constant is that both touch the bubble.

Background dims 5–10%. **No blur.** Blur is the app announcing a modal; a dim is
the app stepping back. Only one of those is calm.

### 2.1 Order is fixed, by thumb travel

Reply · Copy · Forward · More — most-used nearest the bubble. Never reordered by
frequency: a menu that rearranges itself destroys the muscle memory it was
trying to reward.

### 2.2 Adaptive reach

On a 6.7–6.9" phone the top third is out of thumb range. A message up there
would put its menu somewhere the hand cannot go.

So the menu's **resting position may slide toward the thumb** while its
**animation origin stays the message**. It still grows out of the bubble that
was touched; it simply comes to rest lower than strict adjacency would put it.

That is what keeps the two goals from fighting. Spatial connection is carried by
where the motion *starts*, not by where the menu ends up — which is also why
this does not weaken § 1.1. The eye follows the growth; the thumb gets a
reachable target.

The slide is capped: the menu never detaches so far that the bubble it belongs
to is off screen. Past that point the thread scrolls instead, bringing the
message into reach rather than sending the menu away from it.

### 2.3 The awkward cases

- **Message taller than the viewport** (long text, tall image): the menu anchors
  to the *touch point* rather than the bubble's edge, and the bubble does not
  lift. There is nothing to lift it away from.
- **Message at the very top**: reactions move below the bubble, actions below
  them. Order within each group is unchanged.
- **Dismiss**: tap anywhere outside, or scroll. Scrolling dismisses without
  performing anything — a thumb that starts to scroll has already changed its
  mind.

## § 3 Hiding versus disabling

> Hide what was never yours. Explain what expired.

| Case | Treatment |
| --- | --- |
| Delete for everyone, on someone else's message | **Hide.** Never available; never looked for. |
| A capability that expires | **Disabled, with the reason.** It *was* available, so silence makes the user hunt. |
| Everything else unavailable | **Hide.** |

Greyed-out rows are visual noise, and most of them are. The exception is narrow
and specific: a capability the user has already seen and could reasonably expect
to still be there.

### Editing and deleting do not expire

There is no time limit on either, and the rows are never disabled for age.
Amended after build, on the reasoning that what protects a reader is *knowing a
message changed*, not the change becoming impossible after fifteen minutes — a
window mostly punishes the person who spots their own typo late. Both changes
are therefore permanent record:

- An edited message carries **Edited** inside the bubble, on the message itself
  rather than with the cluster timestamp, so an edit three messages back is
  still marked.
- Deleting for everyone leaves a **tombstone** in place — same side, same point
  in time, italic and muted. Removing the bubble outright would edit the past;
  "something was here" is itself what the reader needs.
- Deleting for yourself removes it from your thread only, and is a `hidden`
  row rather than a state on the message, because the other people in the
  conversation must keep seeing it.

## § 4 AI appears only when the message earns it

No AI tab. No AI page. No fixed row.

| Action | Appears when |
| --- | --- |
| Translate | the message is not in the reader's language |
| Remind me | the message contains a time or date |
| Summarise | the selection is long, or a thread is |
| Rewrite | it is your own unsent draft |

The group has **no header and no fixed position** — present when it applies,
absent otherwise. Without this rule "contextual AI" becomes four permanent extra
rows, which is the AI tab again, scattered.

## § 4.5 One menu, several ways in

The component is one. Only the trigger differs by platform, and no behaviour is
allowed to differ with it — a second implementation is a second set of bugs.

| Platform | Trigger | Opens |
| --- | --- | --- |
| Touch | tap | the reaction bar only |
| Touch | long press | the bar and the actions |
| Pointer | a `⋯` that appears on hover, aligned to the bubble | everything |
| Pointer | right-click, anchored at the cursor | everything |
| Keyboard | `Shift+F10` or the Context Menu key on the focused message | everything |

`Esc` closes, everywhere.

### Two depths, one menu

Amended after build. A tap offers reactions and nothing else; a hold offers the
actions as well. Reacting is by far the most common thing anyone does to a
message and also the most reversible, so it gets the cheapest gesture, and the
half-second hold is kept for the actions that change something.

This replaced double-tap-to-❤️, which cannot coexist with it: once a single tap
opens the bar, the second tap of a double tap lands on the bar rather than on
the message. Choosing an emoji is barely slower than committing to ❤️, and it is
one rule instead of two.

The `➕` on a tap-opened bar reveals the actions rather than dead-ending, so
realising mid-gesture that you wanted Reply does not cost a dismiss and a hold —
otherwise people learn to hold every time and the cheap gesture earns nothing.

Tap-to-react is touch only. A click is how you interact with everything on a
desktop, so binding it to a reaction bar would fire constantly by accident, and
the hover `⋯` is already the cheap opener there. This is a difference in
*trigger*, which the table above exists to hold — the menu and its behaviour do
not change with it.

Right-click anchors to the cursor rather than the bubble because that is where a
desktop user is already looking, and § 1.1 asks the menu to come from where the
input was — which on a mouse is the pointer, not the finger.

## § 5 Haptics

Different actions must not feel the same. The hand should be able to tell what
happened without the eyes.

| Moment | Feedback |
| --- | --- |
| Long press recognised | soft impact |
| Reaction selected | light tick |
| Copy | tiny confirmation |
| Forward | soft tick |
| Star | soft sparkle |
| Pin | medium impact |
| Delete | warning |

## § 6 Timing

| Step | Duration |
| --- | --- |
| Long press hold | 500 ms |
| Message lift | 180 ms |
| Reaction bar in | 140 ms |
| Menu fade + scale | 160 ms |
| Dismiss | 140 ms |

The hold is 500 ms, matching iMessage and Instagram. An earlier draft said
120 ms; that is a recognition *latency* budget, not a hold — at 120 ms every
ordinary tap opens the menu. Past roughly a second users decide the gesture
failed and lift off, so the usable window is narrow in both directions.

The rest are fast enough to feel instant, slow enough to read as deliberate. Dismiss is
quicker than entry, because leaving should never feel like waiting.

All of it scales with the motion setting — these are duration tokens, not inline
values, so Reduced honours them without a second code path.

## § 7 Read receipts, screenshots

**Read receipts stay**, and they are a state change rather than a motion. The
tick does not animate on arrival, does not tint, does not pull the eye. True
when you look for it, invisible when you are not.

**Screenshot alerts are off in normal chats and available in secret chats.** In
a normal chat it is surveillance; in a secret chat both people accepted the
rules on the way in.

## § 8 Reaction state

Decided 2026-07-27, before the bar was built, because the first implementation
re-read the message after every toggle and again on every realtime echo — three
round trips for one tap, which defeats the point of a hydrated model.

### 8.1 The cache is not a second model

It is the backing store for `Message.reactions`, and nothing else.

- `listMessages()` fills it once.
- Every `Message.reactions` handed to the UI is derived from it.
- `toggleReaction()` mutates it optimistically, emits, *then* fires the RPC.
- Realtime deltas mutate the same instance.
- On disagreement, reconcile to the server and emit one final update.

There must be no path where one component reads `Message.reactions` and another
reads the cache. One authoritative client state, not two.

**No reads after a successful toggle.** The client already knows whether the tap
was an add, a swap or a remove; the realtime event confirms rather than informs.

### 8.2 Version every mutation

Each optimistic toggle takes a monotonic revision. When confirmation arrives:

| Case | Action |
| --- | --- |
| Confirms the newest pending op | clear pending |
| Belongs to an older op | ignore |
| Disagrees | reconcile to server, emit once |

Without this, rapid taps let a stale confirmation overwrite newer local intent —
the user taps ❤️ then 👍, and the ❤️ echo arrives last and wins.

### 8.3 Matching a confirmation to an operation

The non-obvious part. Realtime carries the *row*, not your operation id — it
gives `message_id`, `user_id`, `emoji` and nothing about who asked.

So a confirmation is matched by **(message_id, user_id === me)**, and the check
is whether the arriving emoji equals the newest pending intent for that message:

- equal → that intent is confirmed, clear it
- different, and a newer intent is still pending → ignore; the newer one's echo
  is still in flight
- different, with nothing pending → someone else's device changed it, or ours
  failed; take the server's value

A `DELETE` payload carries `old` rather than `new`, and means the emoji is gone
for that user — the same three cases apply with "no reaction" as the value.
