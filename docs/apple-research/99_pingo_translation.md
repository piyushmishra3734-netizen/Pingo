# 99 · PINGO translation

The payload. Every row: **Apple did this → the problem → the principle → PINGO's
equivalent → what not to copy.** Nothing here is adopted because Apple does it;
each item has to earn its place against Slack's test — does this make PINGO
better at what only PINGO does?

Two facts frame everything below.

**PINGO has no system to inherit from.** Slack's redesign was largely a matter
of deleting custom controls and letting the OS paint. PINGO has no such option:
every rule adopted here is hand-built and maintained forever (`06 §1`). So the
bar is high and the list is short.

**PINGO gets no learning-curve subsidy.** Slack could move search because every
Apple app moved that week (`06 §4`). Nothing teaches PINGO's users on PINGO's
behalf, which makes novel patterns cost *more* here than at Slack.

---

## Adopt

### 1. Glass is for controls; bubbles are content

| | |
| --- | --- |
| **Apple** | "Don't use Liquid Glass in the content layer" — except transient interactive elements, which take it on *while activated* (`01 §1`, `04 §2`). |
| **Problem** | A material on everything stops distinguishing anything. |
| **Principle** | The material *is* the hierarchy; spend it at the moment of interaction. |
| **PINGO** | Bubbles flat while scrolling, glass while long-pressed. Dock, composer, reaction bar and context menu keep it. |
| **Not copied** | The variant API. PINGO has one material and its own lens. |

The rare case where the Apple-correct answer and the WebView-affordable answer
are the same: fifty resting bubbles cost nothing, one pressed bubble costs one
lens.

### 2. Motion amplitude belongs to the input device

| | |
| --- | --- |
| **Apple** | Glass "responds to direct touch … with greater emphasis," and is "more subdued" under a trackpad (`02 §1`). |
| **Problem** | The same animation reads tactile under a thumb and fussy under a cursor. |
| **Principle** | Amplitude is a property of the input, not the component. |
| **PINGO** | `glass-press` gains a `pointer: coarse` / `pointer: fine` split. |
| **Not copied** | Nothing. |

Cheapest item in the corpus, and nobody would have guessed it without the source.

### 3. Context-menu order must match swipe actions

| | |
| --- | --- |
| **Apple** | "Make sure the actions you surface at the top of your contextual menu match the swipe actions you provide for the same item" (`04 §3`). |
| **Problem** | Two surfaces on one object teaching two different things. |
| **Principle** | Consistency between existing affordances is free correctness. |
| **PINGO** | Audit message swipe vs the top of the message context menu; make them agree. |
| **Not copied** | Nothing. |

No rendering, no animation, no material. Pure audit.

### 4. An increased-contrast variant for every colour

| | |
| --- | --- |
| **Apple** | Define custom colours "with light and dark variants, **and an increased contrast option for each**" (`05 §2`). |
| **Problem** | Reducing transparency without raising contrast is half an answer. |
| **Principle** | Accessibility settings modify the design; they do not switch it off. |
| **PINGO** | Tokens have light and dark only. `prefers-contrast` is wired but changes no colour. Add the third variant. |
| **Not copied** | Nothing. |

The largest genuine accessibility gap the corpus surfaced.

### 5. Presentations grow from their source

| | |
| --- | --- |
| **Apple** | "An action sheet originates from the element that initiates the action, instead of from the bottom edge" (`04 §1`). |
| **Problem** | A sheet from the screen edge answers "what are my options" but not "options for *what*." |
| **Principle** | Source and destination are one object at two sizes. |
| **PINGO** | A Ping or view-once grows out of its bubble and collapses back into a spent cover. Reaction bar from the pressed bubble; context menu from the message. |
| **Not copied** | The "interact with the rest of the interface" behaviour, for a view-once viewer — that one *should* hold attention. Make it a decision, not an accident. |

Three constraints ride along, all from the sources: it must collapse back into
the bubble it came from (`02 §3`), it must be interruptible (`02 §5`), and the
spent state must be legible in a still frame because motion is never the only
channel (`05 §3`).

---

## Prototype before believing

### 6. Concentric corners

The rule is published and has a framework primitive behind it (`03 §3`). The team
that tried hardest rejected it: Slack's concentric header "fit great into the
device's shape, but that bottom edge didn't resolve quite well" (`06 §3`).

A rule from a document is a hypothesis; the device is the authority. Build the
variants, put them on the cheapest real phone, let that decide. PINGO's own
history agrees — CSS guesses here have been wrong twice.

### 7. Half sheets inset and translucent, full sheets opaque

Cheap, published (`03 §4`), and unverified on a mid-range WebView. Prototype
with the attach sheet.

---

## Decline, for now

### 8. The receding dock

Apple ties it to the tab bar and gets it free from the system (`03 §2`). On a
PINGO phone thread the dock is not rendered at all — the screen that would gain
most is the one screen it cannot reach. It buys a scroll listener per list
screen, in a codebase that has been bitten by a listener before, to
re-implement by hand what Apple inherits.

### 9. Adaptive tint and shadow from sampled luminance

The most expensive and most easily overdone item, and it competes directly with
rule 1 — if bubbles stop being glass at rest, most of what this would adapt no
longer exists. Reconsider only after 1 ships.

---

## Order of work

Slack sequences by **frequency of use first, muscle-memory risk last** (`06 §6`),
which is a better rule than the Material Study's cost-and-visibility ordering.
Applying it:

1. **Pointer-split on `glass-press`** — a media query, touches the most-used
   surfaces, changes no layout.
2. **Context-menu / swipe audit** — free, and it is a correctness bug today.
3. **Bubbles: flat at rest, glass on press** — the composer and thread are the
   most-used screens in the app, and this makes them cheaper, not dearer.
4. **Increased-contrast token variant** — bounded, and nobody is served by
   waiting.
5. **Ping / view-once morph** — the one that changes how the product feels, and
   the first item that rewires muscle memory. Deliberately after the four above.
6. **Prototype concentric corners and sheet opacity** — on device, together.

Items 8 and 9 are not on the list.

---

## Verification debt

Named rather than counted as done: nothing in PINGO has been checked under
increased contrast or reduced transparency on a real device, and Apple's
guidance is explicit that the testing burden falls on custom elements — which is
all of PINGO (`05 §1`). Every item above should be measured on the cheapest
Android device available before it ships, and `data-glass="0"` must keep working
as the answer when it does not.
