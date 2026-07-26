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
| Edit, past its window | **Disabled, with the reason.** It *was* available, so silence makes the user hunt. |
| Delete for everyone, past its window | **Disabled, with the reason.** Same argument. |
| Everything else unavailable | **Hide.** |

Greyed-out rows are visual noise, and most of them are. The exception is narrow
and specific: a capability the user has already seen and could reasonably expect
to still be there.

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
| Long press detect | 120 ms |
| Message lift | 180 ms |
| Reaction bar in | 140 ms |
| Menu fade + scale | 160 ms |
| Dismiss | 140 ms |

Fast enough to feel instant, slow enough to read as deliberate. Dismiss is
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
