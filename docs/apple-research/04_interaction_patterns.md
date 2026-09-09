# 04 · Interaction patterns

**Source.** Technology Overviews → Adopting Liquid Glass, sections: Controls,
Menus and toolbars, Windows and modals · HIG → Motion.

---

## 1. Presentations originate from their source — stated plainly

**What Apple specifies.** "An action sheet originates from the element that
initiates the action, instead of from the bottom edge of the display." And it
comes with an API requirement: "Position an action sheet's anchor next to the
control it originates from."

There is a second half people miss: "When active, an action sheet also lets
people interact with other parts of the interface." The presentation is not a
modal trap.

**The problem being solved.** A sheet from the bottom edge answers "what are my
options" but not "options for *what*." Growing from the source keeps the subject
attached to the menu about it.

**Implication for PINGO — this is the open item.** The Material Study's #3 is
the only one of its top four not yet built: a Ping or view-once photo should
grow out of its bubble and collapse back into a spent cover. This source
upgrades it from a nice idea to the documented pattern, and adds two
requirements the study did not have:

1. The anchor is the *bubble*, and must be passed through — not a screen-centre
   fallback.
2. Interaction outside should still be possible where it makes sense. For the
   reaction bar and context menu that is right; for a view-once viewer it is
   not, and that difference should be a deliberate choice rather than an
   accident of implementation.

**Constraint carried from `02_motion`.** It must collapse back into the bubble
it came from — "feedback motion that follows people's gestures" — and it must be
interruptible.

---

## 2. Controls become glass while touched

**What Apple specifies.** "For controls like sliders and toggles, the knob
transforms into Liquid Glass during interaction, and buttons fluidly morph into
menus and popovers."

**The principle.** The material is spent at the moment of interaction, not held
at rest. Same rule as the content-layer exception in `01`, seen from the
control's side.

**Implication for PINGO.** Bubbles are glass while long-pressed, flat while
scrolling. Fifty resting bubbles then cost nothing and one pressed bubble costs
one lens — which is both the Apple-correct answer and the WebView-affordable
one. It is rare for those to agree; here they do.

---

## 3. Context-menu actions must match swipe actions

**What Apple specifies.** "Match top menu actions to swipe actions. For
consistency and predictability, make sure the actions you surface at the top of
your contextual menu match the swipe actions you provide for the same item."

**Why this is the sleeper finding.** It is the only rule in the corpus that is
purely about *consistency between two existing surfaces* — it costs no
rendering, no animation, no material. It is free, checkable, and PINGO has both
surfaces on the same object: a message row has a swipe action and a long-press
context menu.

**Implication for PINGO.** A direct audit: whatever swipe does on a message must
be the first item in that message's context menu. If they disagree today, one of
them is teaching the wrong thing.

---

## 4. Don't crowd or stack glass

**What Apple specifies.** "Check for crowding or overlapping of controls. Prefer
to use standard spacing metrics instead of overriding them, and avoid
overcrowding or layering Liquid Glass elements on top of each other."

**Status in PINGO: already true, structurally.** The Material Study retracted
its own claim here — the composer replaces the dock on a phone thread rather
than stacking above it (`AppShell.tsx:82`), and on desktop the shell reserves
`pb-[8rem]` for the dock (`AppShell.tsx:190`). Nothing to build.

**What it constrains going forward.** Anything new that floats — a toast, a
bottom sheet raised over the composer, a mini-player — would create the overlap
that does not currently exist. The check is structural: can two `glass-water` or
`GlassPanel` surfaces be on screen at once?

---

## 5. Icons for common actions, labels for everyone

**What Apple specifies.** Represent common toolbar actions "with standard icons
instead of text" to declutter; "don't mix text and icons across items that share
a background." And without exception: "Provide an accessibility label for every
icon … always."

**Implication for PINGO.** The mixing rule is checkable in the composer and the
context menu, which currently do mix. The labels rule is not a design question
and belongs in the same pass.
