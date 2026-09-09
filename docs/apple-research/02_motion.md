# 02 · Motion

**Source.** HIG → Motion (`developer.apple.com/design/human-interface-guidelines/motion`,
change log: Liquid Glass guidance added 9 Sep 2025).

---

## 1. Motion is input-dependent

**What Apple specifies.** The single most concrete Liquid Glass statement in
this document: the material's movement "responds to direct touch interaction
with greater emphasis to reinforce the feeling of a tactile experience, but
produces a more subdued effect when a person interacts using a trackpad."

**The problem being solved.** A finger is on the glass; a cursor is not. The
same animation that reads as tactile under a thumb reads as fussy under a
pointer.

**The principle.** Motion amplitude belongs to the input device, not to the
component.

**Implication for PINGO.** PINGO runs on phones and desktop from one bundle.
`glass-press` currently does one thing everywhere. The published rule says it
should be stronger on `pointer: coarse` and subdued on `pointer: fine` — which
is a media query, not new code. This is the cheapest item in the whole corpus
and it is also the one nobody would have guessed without the source.

**What not to copy.** Nothing.

---

## 2. Motion must be optional, and never the only channel

**What Apple specifies.** "Make motion optional … avoid using it as the only way
to communicate important information," and supplement with "haptics and audio."

**Implication for PINGO.** `prefers-reduced-motion` is already respected in
`app.css`. The part not yet true: anything where motion *carries* meaning needs
a second channel. The morph proposed for Ping and view-once is exactly this
risk — if the expand/collapse is the only signal that a view-once was spent,
somebody with reduced motion learns nothing. The spent state has to be visible
in the still frame.

---

## 3. Feedback follows the gesture

**What Apple specifies.** "Strive for realistic feedback motion that follows
people's gestures and expectations." The example is precise: a view revealed by
sliding down from the top is not expected to dismiss sideways.

**The principle.** The reverse of a gesture is that gesture, backwards. Anything
else disorients.

**Implication for PINGO.** Directly constrains the morph work. If a Ping grows
out of its bubble, it must collapse back *into that bubble* — not fade, not
slide to an edge. Same for the reaction bar and the context menu: they return to
what they came from.

---

## 4. Brevity beats prominence, and frequent interactions get nothing

**What Apple specifies.** "Aim for brevity and precision in feedback animations"
— brief, precise motion "can often convey information more effectively than
prominent animation." And separately: "generally avoid adding motion to UI
interactions that occur frequently."

**Implication for PINGO.** A hard limit on where the morph pattern is worth
spending. Opening a Ping is rare and consequential — it earns an animation.
Sending a message is the most frequent action in the app and by this rule earns
none. Any "send" flourish is against published guidance.

---

## 5. Never make people wait for an animation

**What Apple specifies.** "Let people cancel motion … don't make people wait for
an animation to complete before they can do anything, especially if they have to
experience the animation more than once."

**Implication for PINGO.** The morph must be interruptible — a tap during the
expand lands on the viewer, and a dismiss during the collapse is honoured. This
is the kind of requirement that is cheap while writing the animation and
expensive to retrofit, so it belongs in the first version.
