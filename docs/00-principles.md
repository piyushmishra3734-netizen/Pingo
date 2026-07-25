# 00 — Principles & Motion Language

The philosophy is settled. This document turns it into rules that can be applied
and, more importantly, **enforced in review**. A principle that cannot fail a
design is decoration.

---

## 1. The five laws

Every screen in PINGO obeys these. They are ordered: when two conflict, the lower
number wins.

### Law 1 — One primary action per screen

Exactly one gradient button may be visible at a time. Everything else is
secondary, text, or an icon control.

A screen with two primary buttons has not decided what the user is there to do,
and has handed that decision to the user instead. That transfer is the cognitive
load we exist to remove.

**Fails review:** two gradient buttons; a gradient button next to a gradient FAB.

### Law 2 — Colour carries meaning, never decoration

The gradient means *"this is the action."* Purple means *"live, now, present."*
Brand blue means *"interactive."* Everything else is ink, secondary, or a hairline.

If a colour appears for any reason other than those four, it is noise.

**Fails review:** coloured section headers; a purple dot that indicates nothing;
tinted card backgrounds used to "group" content that spacing could group.

### Law 3 — Motion explains a state change or does not exist

Every animation must answer: *what changed, and where did it come from?* Motion
that answers neither is entertainment, and entertainment is the dopamine loop we
are refusing to build.

**Fails review:** entrance animations on static content; hover animations on
non-interactive elements; anything looping that is not communicating live status.

### Law 4 — Emptiness is a designed state

Empty, loading, offline and error states are the first thing a new user sees and
the only thing a user on a bad connection sees. They get the same care as the
populated state, and they never apologise.

**Fails review:** a bare spinner; the literal word "Empty"; an error that blames
the user; a skeleton that does not match the shape of what will load.

### Law 5 — Nothing moves under the user's finger

No layout may reflow, jump, or reorder while the user is reading or aiming at it.
New content below the fold waits. Autoscroll only follows if the user was already
at the bottom.

**Fails review:** a list that reorders on receipt of a message; a button that
shifts when a label changes; content that pushes down when an image loads.

---

## 2. Motion language: water, glass, air

Three behaviours. Every animated element in PINGO is one of them. Naming them
means a reviewer can say *"that's water where it should be air"* and be understood.

### Water — things that carry weight

Sheets, drawers, the keyboard, panels that slide. They have mass, they respond to
your gesture continuously, and they settle rather than stop.

| | |
| --- | --- |
| Duration | `--duration-base` (240ms) in, `--duration-quick` (180ms) out |
| Easing | `--ease-standard` in, `--ease-exit` out |
| Property | `transform: translate` — never `height`, never `top` |
| Gesture | Follows the finger 1:1 while dragging; velocity decides commit or return |
| Never | overshoots, bounces, or rubber-bands past its bound |

Water is the only category that responds to drag. If a surface can be dragged, it
is water.

### Glass — things that reveal

Overlays, the dock, sticky headers, context menus, tooltips. They do not travel;
they *become present*. Opacity and a small scale, never a slide.

| | |
| --- | --- |
| Duration | `--duration-quick` (180ms) |
| Easing | `--ease-standard` |
| Property | `opacity` + `scale` from `0.97` → `1` |
| Origin | Scales from its anchor — a menu grows from the button that opened it |
| Never | slides in from an edge; fades without scale (that reads as a bug) |

The 0.97 floor matters. Below about 0.95 the element reads as "flying in," which
is water behaviour wearing glass clothing.

### Air — things that acknowledge

Presence dots, typing indicators, unread badges, press feedback, delivery ticks.
The smallest motions in the product. Air never blocks and never demands.

| | |
| --- | --- |
| Duration | `--duration-instant` (120ms) for feedback; `1400ms` for ambient loops |
| Easing | `--ease-standard` for feedback; `--ease-ambient` for loops |
| Property | `opacity`, `scale`, small `translateY` (≤ 4px) |
| Amplitude | Press = `0.98` scale. Ambient = `0.55` opacity floor |
| Never | uses colour change as the feedback; travels more than 4px |

**Air is where the brand lives.** Every ambient loop in PINGO is the purple dot,
and it breathes — it never blinks. A blink is an alarm; a breath is a presence.

### The prohibition

There is no fourth category, and these three have no springs. No `cubic-bezier`
with a negative control point may enter the codebase. Overshoot reads as playful,
playful reads as a toy, and a toy is not a product you trust with private
messages.

---

## 3. Spacing rhythm

Breathing space is not "more padding." It is a *consistent* rhythm, because
inconsistent spacing is what actually reads as clutter.

| Context | Gap |
| --- | --- |
| Inside a control (icon → label) | `8px` |
| Between related rows | `2px` (dividers do the separating) |
| Between a label and its field | `8px` |
| Between fields in a form | `20px` |
| Between sections | `32px` |
| Screen gutter, phone | `20px` |
| Screen gutter, desktop | `32px` |
| Above a screen's first element | `24px` |
| Below a screen's last element | `32px` + dock inset |

**Rule:** a screen may use at most **three** distinct vertical gaps. More than
three and the eye can no longer infer the grouping, which is the entire purpose of
the spacing.

---

## 4. Density budget

A calm screen is not a sparse screen — it is a screen where you can find the one
thing you came for. That is a counting problem.

| Surface | Max primary elements in first viewport |
| --- | --- |
| Any screen | 1 primary action |
| Conversation list | 7 rows before the fold |
| Settings group | 6 rows before a section break |
| Composer | 3 visible controls (attach, emoji, send/mic) |
| Chat header | 3 actions |
| Dock | 4 destinations, permanently |
| Bottom sheet | 5 options before it must become a scrolling list |

Exceeding a budget is not automatically wrong, but it requires a reason recorded
in the PR. Silent creep is how every calm product becomes a noisy one.

---

## 5. Typography discipline

Five sizes exist. That is the whole scale, and it is enough.

| Token | Use | Never |
| --- | --- | --- |
| `display` 56 | Splash, welcome. Once per session at most | Inside any list or card |
| `h1` 32 | The screen's own title | More than once per screen |
| `h2` 20 | Section headers, conversation names | For body copy |
| `body` 16 | Message text, rows, labels, everything | Below 16 for anything readable |
| `caption` 12 | Timestamps, metadata, helper text | For anything a user must read to act |

**Weight before size.** To emphasise, go from `regular` to `medium` — do not go up
a size. Size changes break the vertical rhythm; weight does not.

**Never centre more than two lines.** Centred text is for moments (splash, empty
states, dialogs). Anything a user reads to *do something* is left-aligned.

---

## 6. The calm test

Before any screen ships, it answers these six questions. Any "no" is a blocker.

1. **Can you name the one thing this screen is for, in four words?**
   If not, the screen is doing two jobs and should be two screens.

2. **Is there exactly one gradient button?**

3. **Remove every colour except ink and grey. Does it still work?**
   If not, the design is leaning on colour to do a job that hierarchy should do.

4. **Turn off every animation. Is anything now confusing?**
   If yes, motion is carrying information it should not carry alone.
   If nothing changes at all, the motion was decoration — delete it.

5. **At 360px wide, does anything overflow, truncate badly, or overlap?**

6. **On the slowest connection, what does this look like for four seconds?**
   If the answer is "a spinner," the loading state is not designed.

---

## 7. What PINGO deliberately does not have

Recorded so it is not re-proposed. Each of these is a normal messaging-app feature
that fails the philosophy.

| Absent | Why |
| --- | --- |
| Infinite feed of any kind | Attention farming. Moments expire and do not rank |
| Algorithmic ordering | Recency and pins only. The user's order, not ours |
| Streaks, badges, activity scores | Manufactured obligation |
| "X is online" broadcast lists | Turns presence into surveillance |
| Typing indicators the user cannot disable | Privacy is a setting, not a default we impose |
| Read receipts without a mutual off switch | Same |
| Unread counts on surfaces the user is looking at | Anxiety with no action attached |
| Notification grouping by "importance" | We are not the judge of who matters |
| Stories rings around avatars | Puts a feed inside the contact list |
| Animated stickers in-thread by default | Motion with no state change (Law 3) |

---

## 8. Accessibility as a brand property

A product built on calm cannot be stressful to use with assistive technology.
These are requirements, not enhancements.

- **`prefers-reduced-motion` stops all ambient loops** and collapses transitions.
  Already enforced globally in `tokens.css`.
- **Contrast:** body text ≥ 4.5:1, large text and icons ≥ 3:1. `text-tertiary`
  (38% ink) is for decorative metadata **only** and may never carry sole meaning.
- **Never colour alone.** Every state has a second channel — the brand-coloured
  read receipt is also a *different glyph* (double vs single check).
- **Touch targets ≥ 44px**, even where the visual is smaller. The dock's icons are
  24px inside 48px targets.
- **Focus is visible and ordered.** `:focus-visible` only, so pointer users never
  see a ring. Tab order follows reading order; sheets and dialogs trap focus and
  restore it on close.
- **Motion is never the only affordance.** If something can only be discovered by
  a hover animation, it cannot be discovered at all on touch.

---

*Next: [01 — Onboarding & Authentication](./01-onboarding-auth.md)*
