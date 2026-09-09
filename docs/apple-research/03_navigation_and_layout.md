# 03 · Navigation, search and layout

**Source.** Technology Overviews → Adopting Liquid Glass
(`developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass`),
sections: Navigation, Menus and toolbars, Windows and modals, Organization and
layout, Search, Platform considerations.

---

## 1. Scroll edge effect — and PINGO already has it

**What Apple specifies.** "Scroll views offer a scroll edge effect that helps
maintain sufficient legibility and contrast for controls by obscuring content
that scrolls beneath them." System bars get it by default; a *custom* bar with
content scrolling beneath must register for it explicitly.

**Status in PINGO: built.** `.thread-fade` in `app.css:454` is a static
mask-image on the thread scroller, top and bottom, with the comment "no scroll
listener, no sampling, no second backdrop pass." Applied at
`ChatThread.tsx:1436`.

**What the source adds.** The rule is about *every* custom bar, not just the
thread. PINGO's list screens have a floating dock over scrolling rows and no
edge effect. That is the same defect, one screen over.

---

## 2. The bar recedes on scroll — and Apple made it one line

**What Apple specifies.** "Tab bars can help elevate the underlying content by
receding when a person scrolls up or down," opt-in via
`.tabBarMinimizeBehavior(.onScrollDown)`; it "expands when a person scrolls in
the opposite direction."

**Implication for PINGO.** This is the Material Study's demoted item, and the
source does not rescue it. Apple ties the behaviour to the *tab bar*, and on a
PINGO phone thread the dock is not rendered at all (`AppShell.tsx:84`) — the
screen that would benefit most is the one screen it cannot reach. It remains a
list-screens-only win, and it still costs a scroll listener per screen in a
codebase that has been bitten by one before.

**Correction to the corpus, not the study.** Apple gets this for free because
the system owns the scroll view. PINGO would be re-implementing a system
behaviour by hand. That asymmetry is the honest reason to keep it late.

---

## 3. Concentric shapes are a stated rule with an API behind them

**What Apple specifies.** "The shape of the hardware informs the curvature, size,
and shape of nested interface elements," and Apple shipped `ConcentricRectangle`
specifically to maintain it. Controls adopt "rounder forms to elegantly nestle
into the corners of windows and displays."

**Implication for PINGO.** Confirms the Material Study's concentric-corners item
and raises its standing: this is not a detail Apple mentions once, it is a shape
primitive they added to the framework. PINGO's dock sits `1.25rem` from the
bottom; its radius should be the display's corner radius minus that inset.

**What not to copy.** The API. The web cannot read the device corner radius, so
this stays a per-form-factor constant. Better than a uniform `rounded-lg`,
short of what Apple does.

---

## 4. Half sheets peek; full sheets go opaque

**What Apple specifies.** "Half sheets are inset from the edge of the display to
allow content to peek through from beneath them. When a half sheet expands to
full height, it transitions to a more opaque appearance to help maintain focus
on the task."

**The principle.** Translucency is proportional to how much of your attention
the sheet is claiming. A partial sheet admits the world behind it; a full one
does not.

**Implication for PINGO.** The attach sheet and group-info sheet are one
appearance at every height today. The rule gives a cheap upgrade: inset and
translucent while partial, opaque at full height.

---

## 5. Custom backgrounds fight the system — and PINGO is all custom background

**What Apple specifies.** "Reduce your use of custom backgrounds in controls and
navigation elements. Any custom backgrounds and appearances you use in these
elements might overlay or interfere with Liquid Glass or other effects that the
system provides, such as the scroll edge effect."

**Why this matters more than it looks.** Every rule in this corpus assumes a
system that owns the material. PINGO has no such system — `glass-water` and
`lens.ts` *are* the custom background Apple is warning about. The guidance
cannot be adopted literally; what carries over is the reason behind it, which is
that two things painting the same region is how the seams appear.

---

## 6. Layout: room to breathe, and title case

**What Apple specifies.** Lists, tables and forms have "a larger row height and
padding," sections have "an increased corner radius to match the curvature of
controls." And a specific, checkable one: section headers now use "title-style
capitalization" rather than rendering entirely in capitals.

**Implication for PINGO.** The uppercase-with-letter-spacing label is used
throughout PINGO's settings and sheets. Apple moved away from it deliberately,
for legibility. Worth an audit — this is the sort of change that reads as
"updated" without anyone being able to say why.

---

## 7. Search goes where the hands are

**What Apple specifies.** In iOS, "when a person taps a search field to give it
focus, it slides upwards as the keyboard appears." And the search *tab*, if
there is one, is placed by the system "at the trailing end."

**Implication for PINGO.** Confirms the Material Study's search proposal and
sharpens it: the movement is tied to the keyboard's arrival, not to a
breakpoint. PINGO's search pill stays at the top at rest and moves down on
activation, where the keyboard is about to be.

---

## 8. Combine custom glass effects for performance

**What Apple specifies.** "Combine custom Liquid Glass effects to improve
rendering performance … using a `GlassEffectContainer`, which helps optimize
performance while fluidly morphing Liquid Glass shapes into each other."

**Implication for PINGO.** The nearest published confirmation of `lens.ts`'s own
cost model — that the expensive part is per-element setup, and that shapes
sharing one container are cheaper *and* morph better. If PINGO ever groups the
dock's buttons under one lens rather than one each, this is the reasoning that
supports it, and it is the same insight the file already reached alone.
