# 08 — Microinteractions, Haptics & Sound

Part of the design system. [00 § 2](./00-principles.md#2-motion-language-water-glass-air)
defines the three motion categories; this document assigns every interaction in the
product to one, and adds the tactile and audio channels.

---

## The premise

Microinteractions are where a product stops feeling like software and starts feeling
like an object. They are also where calm products go wrong — because each one is
individually delightful, and collectively exhausting.

So the governing rule is subtractive:

> **Feedback exists to confirm that something happened, or to explain what changed.
> Never to reward, celebrate, or entertain.**

A user should finish a day in PINGO having noticed nothing. That is the goal.

---

## 1. The feedback budget

Every interaction gets **at most one** feedback channel beyond the visual state change
it already causes.

| Channel | When it is permitted |
| --- | --- |
| Visual | Always. It is the primary channel |
| Haptic | Committed actions and boundaries. Not navigation |
| Sound | Only where the user cannot be looking: incoming notification, call ring, recording start/stop |

**Never stack channels on one event** except for the three cases in
[§ 5.2](#52-the-three-permitted-multi-channel-events). A tap that flashes, buzzes and
clicks is a slot machine.

### 1.1 The over-feedback test

Perform the interaction 30 times in a row. If it becomes irritating, it was
over-designed. Send is the canonical case: a user sends 200 messages a day, so send
gets the *lightest* possible confirmation, not the most satisfying one.

---

## 2. Complete interaction table

Every interaction, its category, and its exact treatment.

### 2.1 Buttons & controls

| Interaction | Category | Visual | Haptic |
| --- | --- | --- | --- |
| Button press | air | `scale(0.98)`, 120ms | — |
| Button release → action | air | Returns to 1.0 | **Light** on commit |
| IconButton press | air | `scale(0.96)`, 120ms | — |
| Button hover (pointer) | air | Shadow lifts one step, 120ms | — |
| Button disabled attempt | — | **Nothing.** No shake, no buzz | — |
| Loading start | air | Label → opacity 0, dots fade in. Width preserved | — |
| Loading → success | air | Dots out, label in, 120ms | **Light** |
| Toggle flip | air | Knob `translateX` 180ms; track cross-fade | **Light** |
| Chip select | air | Wash fades in 120ms; label → brand | **Light** |
| Segmented control | water | Selected pill slides 240ms | **Light** |
| Slider drag | air | Follows finger 1:1 | **Selection tick** at each step |
| Text field focus | air | Background → surface, border in, shadow in. 120ms | — |
| Text field invalid | air | Border → danger, caption fades in 180ms. **No shake** | — |

**Disabled controls do nothing on press.** Feedback on a dead control implies it might
work.

### 2.2 Messaging

| Interaction | Category | Visual | Haptic |
| --- | --- | --- | --- |
| Send tap | air | Button `0.96`; composer clears instantly | **Light** — once, on tap |
| Message appears in thread | air | `bubble-in`: translateY 6px + scale 0.99 → 1, 240ms | — |
| Message acknowledged (`sent`) | — | Tick glyph swaps, 120ms cross-fade | **None** |
| Message read | — | Tick colour → brand, 120ms | **None** |
| Message failed | air | Opacity → 0.6, danger ring fades in | **Warning** |
| Incoming message, thread open | air | `bubble-in`, plus autoscroll if at bottom | **None** |
| Typing indicator appears | air | Dots fade in 180ms, then loop | — |
| Swipe-to-reply | water | Bubble follows finger to 48px max | **Light** at the 32px threshold |
| Swipe-to-reply release | water | Settles back 180ms `ease-exit` | — |
| Double-tap react | air | Emoji scales 0 → 1.15 → 1, 240ms. **The one permitted overshoot** | **Light** |
| Reaction added | air | Pill scales from the bubble edge, 180ms | — |
| Long-press bubble | glass | Bubble lifts `scale(1.02)`, menu scales from anchor | **Medium** on menu open |
| Scroll to bottom pill | glass | Fades + scales in, 180ms | — |
| Day divider sticks | — | No animation. Position only | — |
| Draft saved | — | **Nothing.** Silent by design | — |

**Read receipts have no haptic and no animation beyond a colour swap.** They fire
constantly; anything more would be a background hum of buzzing.

**The double-tap react is the only overshoot in the product.** It is permitted because
a reaction *is* an expressive act — the one place where a little delight is the point.
1.15× and nothing more.

### 2.3 Voice notes

| Interaction | Category | Visual | Haptic |
| --- | --- | --- | --- |
| Press-and-hold mic | air | Composer replaced 180ms; recording UI in | **Medium** on start |
| Recording active | air | Live waveform; brand dot in `recording` state | — |
| Slide to cancel | water | UI follows finger; trash icon scales up as it nears | **Light** at the cancel threshold |
| Cancel committed | air | UI collapses 180ms | **Warning** |
| Release to send | air | UI collapses; bubble appears | **Light** |
| Lock hands-free | water | UI slides up into locked layout, 240ms | **Medium** |
| Playback start | air | Play → pause glyph, 120ms | **Light** |
| Waveform progress | — | Bars change colour as playback passes. No other motion | — |
| Playback complete | air | Resets to 0, glyph returns | **Light** |
| Seek by drag | air | Follows finger | **Selection tick** per second |

### 2.4 Navigation

| Interaction | Category | Visual | Haptic |
| --- | --- | --- | --- |
| Dock tab change | air | Icon colour 120ms; active dot fades in 180ms | **Light** |
| Dock tab re-tap (already active) | water | Scrolls that surface to top | **Light** |
| Push screen | water | New screen translateX 100% → 0, 240ms. Old screen shifts −24px | — |
| Pop screen | water | Reverse, 180ms `ease-exit` | — |
| Swipe back | water | Follows finger 1:1; commits past 40% or on velocity | **Light** on commit |
| Bottom sheet open | water | translateY, 240ms. Scrim fades 180ms | — |
| Bottom sheet drag | water | Follows finger 1:1 | — |
| Bottom sheet dismiss | water | 180ms `ease-exit` | **Light** on commit |
| Dialog open | glass | Scale 0.97 → 1 + opacity, 180ms | — |
| Dialog dismiss | glass | Reverse, 120ms | — |
| Context menu open | glass | Scale 0.95 → 1 **from anchor**, 180ms | **Medium** |
| Tooltip appear | glass | Opacity + 2px toward anchor, after 500ms hover | — |
| Pull to refresh | water | Follows finger; dot enters `loading` at threshold | **Light** at threshold |

**Navigation transitions have no haptic** except gesture commits. A buzz on every screen
change is the fastest way to make a phone feel cheap.

### 2.5 Lists & content

| Interaction | Category | Visual | Haptic |
| --- | --- | --- | --- |
| Row press | air | `bg-pressed` wash, 120ms | — |
| Row swipe reveal | water | Actions revealed 1:1 under the finger | **Light** at reveal threshold |
| Row swipe full commit | water | Row collapses 240ms; snackbar rises | **Medium** |
| Row removed | water | Height collapses to 0, 240ms; neighbours settle | — |
| Row added at top | air | `rise`: translateY 8px + fade, 240ms | — |
| List reorder (pin) | water | Row travels to its new position, 320ms | **Medium** |
| Skeleton → content | air | Skeleton fades out, content fades in. **No slide** | — |
| Staggered list entrance | air | `rise` per row, 40ms stagger, **max 6 rows** | — |
| Scroll boundary | — | Platform default overscroll | — |
| Lightbox open | water | Tile expands to full-bleed from its position, 320ms | — |
| Lightbox swipe-dismiss | water | Follows finger; scales down and fades | **Light** on commit |

**Stagger caps at 6 rows.** Beyond that the last item's delay becomes a visible wait,
and a list that takes 800ms to appear is slower, not smoother.

### 2.6 System & status

| Interaction | Category | Visual | Haptic |
| --- | --- | --- | --- |
| Connection lost | water | Strip slides in after 2s | **None** |
| Connection restored | water | Strip → "Back online" 1.5s, then out | **None** |
| Snackbar appear | water | translateY in, 240ms | — |
| Snackbar auto-dismiss | glass | Fade out, 180ms | — |
| Snackbar undo tapped | air | Snackbar out; the reversal animates in | **Light** |
| Upload progress | air | Determinate bar grows. **No pulse, no shimmer** | — |
| Upload complete | air | Bar fades out 180ms | **None** |
| Incoming call | — | Full-screen or glass banner | **Ring pattern**, repeating |
| Call connected | — | Status → duration | **Medium** |
| Call ended | — | Screen dismisses | **Light** |
| Permission denied | air | Inline caption fades in | **None** |

**Connection changes are never haptic.** They are not caused by the user and can happen
repeatedly on a train.

---

## 3. Haptic vocabulary

Five patterns. Everything above maps to one of them.

| Name | iOS | Android | Web | Use |
| --- | --- | --- | --- | --- |
| **Light** | `UIImpactFeedbackGenerator(.light)` | `EFFECT_TICK` | `navigator.vibrate(10)` | Confirmed action, gesture commit, toggle |
| **Medium** | `.medium` | `EFFECT_CLICK` | `vibrate(20)` | Significant commit: menu open, call connect, destructive swipe |
| **Selection tick** | `UISelectionFeedbackGenerator` | `EFFECT_TICK` (short) | `vibrate(5)` | Passing a discrete step in a continuous control |
| **Warning** | `UINotificationFeedbackGenerator(.warning)` | `EFFECT_DOUBLE_CLICK` | `vibrate([15,40,15])` | Failure, cancellation |
| **Ring** | System ringtone haptic | System ring | — | Incoming call only |

### 3.1 What has no haptic — deliberately

| No haptic | Why |
| --- | --- |
| Screen transitions | Happens constantly; would become a hum |
| Scrolling | Never |
| Typing | The keyboard's own haptic already exists |
| Message received | Interrupts without user action; the notification handles it |
| Read receipts, delivery ticks | Far too frequent |
| Success confirmations of visible things | The visual already confirmed it |
| Loading start/finish | Not a user action |
| Connection changes | Not user-initiated, potentially repeated |

### 3.2 Rules

1. **Never more than one haptic per 300ms.** Coalesce; drop the later one.
2. **Never a haptic on a rejected action.** Buzzing at a disabled control is a scold.
3. **Respect the OS setting.** If system haptics are off, PINGO produces none. There is
   no in-app override that re-enables them.
4. **`Warning` is the only multi-pulse pattern.** Everything else is a single tap, so a
   double-pulse always means "something went wrong."
5. **Haptics are never the sole channel.** A user with haptics disabled loses nothing.
6. **Web haptics degrade to nothing**, silently. `navigator.vibrate` is unsupported on
   iOS Safari, and that is fine.

---

## 4. Sound

### 4.1 Sound is nearly absent

PINGO makes **three** sounds. Everything else is silent.

| Sound | Default | Character | Length |
| --- | --- | --- | --- |
| Incoming notification | **On** | Single soft tone, no melody, gentle attack | ≤ 400ms |
| Call ringtone | **On** | Two-note figure, loops with a gap | 2s cycle |
| Voice recording start / stop | **Off** | Two short soft clicks, distinct pitch | ≤ 80ms |

### 4.2 Explicitly no sound

Sent messages, button taps, screen transitions, toggles, pull-to-refresh, upload
completion, errors, reactions, typing.

**Message-send sound is off and not configurable in v1.** It is the most-requested
skeuomorphic sound and the most fatiguing: a user sending 200 messages a day hears it
200 times. If it ships later it ships off by default.

### 4.3 Sound design constraints

| | |
| --- | --- |
| Tonality | Soft attack, no transient click, no reverb tail. Sine and triangle bases |
| Pitch | Mid-range, 400–1200Hz. Nothing piercing, nothing sub-bass |
| Melody | **None.** A melody becomes a brand jingle, and a jingle is dopamine farming |
| Loudness | Normalised to −18 LUFS so it never spikes above ambient media |
| Ducking | Respects the OS audio session; never interrupts music, ducks briefly |
| Silent mode | Absolutely respected. No "important" exception |
| Quiet hours | Silences delivery entirely ([04 § 4](./04-settings.md#4-notifications)) |

---

## 5. Loading, success & error feedback

### 5.1 Loading, by expected duration

The choice is a function of how long it will take, not of what is loading.

| Duration | Treatment |
| --- | --- |
| < 100ms | **Nothing.** A flash of loading state is worse than a brief wait |
| 100–300ms | Nothing visible; the result animates in with `fade-in` |
| 300ms–2s | Skeleton matching the target's shape, or inline monogram dots |
| 2s–10s | Skeleton or dots **plus a label** naming what is happening |
| > 10s | **Determinate progress required.** If progress is unknowable, the operation must be made cancellable and backgroundable |

**Guaranteed minimum display: 400ms.** A skeleton that appears for 80ms reads as a
glitch. If data arrives sooner, hold the skeleton to 400ms — the perceived stability is
worth 300ms.

**No spinners.** The indeterminate indicator is the monogram's loading state, always.

### 5.2 The three permitted multi-channel events

The only interactions that use more than one feedback channel:

1. **Voice recording start** — visual (UI replaces composer) + haptic (Medium) + optional
   sound. Justified: the user's attention may be on the microphone, not the screen, and
   recording without knowing it is a genuine harm.
2. **Incoming call** — visual + haptic (Ring) + sound. Justified: the entire purpose is
   to reach someone not looking at the device.
3. **Destructive swipe commit** — visual (row collapses) + haptic (Medium). Justified:
   it is irreversible-feeling and happens under a finger that may be covering the row.

### 5.3 Success feedback

**Default: no explicit success feedback.** The changed state *is* the confirmation.

| Situation | Feedback |
| --- | --- |
| Message sent | The bubble appears. Nothing more |
| Setting changed | The control moved. Nothing more |
| Profile saved | Screen pops, new value visible. Nothing more |
| Copied to clipboard | Snackbar — **required**, because nothing visible changed |
| Code saved as file | Snackbar, for the same reason |
| Undo applied | The reversal animates. Snackbar dismisses |
| Account recovered | Home, signed in. **No celebration screen** |

**Rule:** a success message is only warranted when the result is invisible. Confirming
something the user can already see is noise — and a "Saved!" toast on every settings
toggle is the clearest possible symptom of an over-fed interface.

**No confetti, no checkmark animations, no celebration.** Not on registration
completion, not on first message sent, not ever.

### 5.4 Error feedback

| Severity | Treatment | Haptic |
| --- | --- | --- |
| Field invalid | Inline caption + border. On blur or submit, never per keystroke | None |
| Action failed, retryable | Inline on the affected element, with retry | Warning |
| Action failed, transient | Silent. Retried automatically | None |
| Operation failed, no user action possible | Snackbar, informational | None |
| Destructive action blocked | Dialog explaining why | None |
| Session expired | Route to sign-in, state preserved | None |

**No shake animations anywhere.** A shake is a scold, and the user already knows.
The border colour and caption carry the message without the reprimand.

---

## 6. Performance budget

Motion that stutters is worse than no motion. These are hard limits.

| | |
| --- | --- |
| Frame rate | 60fps minimum; 120fps where the display allows |
| Animatable properties | `transform` and `opacity` **only** |
| Never animated | `width`, `height`, `top`, `left`, `margin`, `box-shadow` blur, `filter` on large surfaces |
| Layout thrash | Zero forced synchronous layouts in an animation frame |
| Concurrent animations | Max 3 distinct animations on screen. Stagger beyond that |
| Long lists | Virtualised beyond 50 rows; entrance animation applies only to newly visible rows |
| Glass surfaces | Max 2 backdrop-filtered surfaces on screen. Blur is expensive and compounds |
| Low-power mode | Glass → opaque, ambient loops paused, stagger removed |
| Dropped frames | If a transition drops > 2 frames on target hardware, it is simplified — not optimised later |

**Blur budget matters most.** The dock plus a sticky header is already two glass
surfaces; a third means the dock or the header goes opaque on that screen.

---

## 7. Implementation reference

| Token | Value | Use |
| --- | --- | --- |
| `--duration-instant` | 120ms | Press, colour, hover |
| `--duration-quick` | 180ms | Glass in/out, small transforms |
| `--duration-base` | 240ms | Water in, entrances |
| `--duration-slow` | 320ms | Full-screen, lightbox, reorder |
| `--ease-standard` | `cubic-bezier(0.32, 0.72, 0, 1)` | Everything entering or responding |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Everything leaving |
| `--ease-ambient` | `cubic-bezier(0.4, 0, 0.6, 1)` | Loops only |
| `--animate-rise` | `translateY(8px)` + fade, 240ms | Content entering |
| `--animate-bubble-in` | `translateY(6px)` + `scale(0.99)`, 240ms | New messages |
| `--animate-fade-in` | opacity, 240ms | Cross-fades |
| `--animate-dot-pulse` | 1400ms loop, 0.55 opacity floor | Presence, live |
| `--animate-dot-typing` | 1200ms loop, 3px lift, staggered | Typing |
| `--animate-dot-orbit` | 1600ms linear | Loading |

**There is no spring easing token, and none may be added.** Overshoot is prohibited
outside the single documented exception in
[§ 2.2](#22-messaging) (double-tap react).

---

## 8. Review checklist

For any new interaction:

1. **What changed, and does the motion explain that?** If it explains nothing, delete it.
2. **Which category — water, glass, or air?** If it does not fit one, the interaction is
   wrong, not the taxonomy.
3. **Does it use more than one feedback channel?** If so, is it one of the three
   permitted cases?
4. **Perform it 30 times.** Is it still acceptable?
5. **Does it overshoot?** Unless it is the react animation, that is a defect.
6. **Turn off animation entirely.** Is anything now unclear? Then motion is carrying
   information it should not carry alone.
7. **Turn off haptics.** Is anything lost? Then the haptic was load-bearing, which it
   may never be.
8. **Does it animate anything but `transform` and `opacity`?** Then it will stutter.
9. **Is there a haptic on an action the user did not initiate?** Remove it.
10. **Is there a success toast for something already visible?** Remove it.

---

*Previous: [07 — Offline & Sync](./07-offline-sync.md) · Next: [09 — Notifications & Presence](./09-notifications-presence.md)*
