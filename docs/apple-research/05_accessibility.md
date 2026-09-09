# 05 · Accessibility as a modifier on the material

**Sources.** HIG → Materials · Technology Overviews → Adopting Liquid Glass ·
HIG → Motion. **Not** the HIG Accessibility page: it was checked and covers
vision, hearing, mobility, speech and cognitive guidance generally, with no
Liquid Glass section. The material rules live in the two documents above. Worth
recording, because looking for them in the obvious place returns nothing.

---

## 1. The settings change the material; they don't switch the design off

**What Apple specifies.** The appearance of the glass variants "can differ in
response to certain system settings, like if people choose a preferred look for
Liquid Glass in their device's settings, or turn on accessibility settings that
reduce transparency or increase contrast."

And on testing: "Translucency and fluid morphing animations contribute to the
look and feel of Liquid Glass, but can adapt to people's needs … These settings
can remove or modify certain effects. If you use standard components from system
frameworks, this experience adapts automatically. **Ensure you test your app's
custom elements, colors, and animations with different configurations.**"

**The principle.** These are not an off switch bolted to the side. Each one
changes layers *within* the design, and the design is expected to still be
itself afterwards.

**Status in PINGO: built, in this session's earlier work.**
`prefers-reduced-transparency` and `prefers-contrast` are both wired in
`SettingsContext.tsx`, feeding the same `data-glass` attribute the in-app
preference drives, with the explicit choice winning. `prefers-reduced-motion` is
honoured in `app.css`. This closes the Material Study's item 2.

**What is still open.** Apple's sentence is about *testing*, and the emphasis is
on custom elements — which is all of PINGO. Nothing here has been checked under
increased contrast on a device. That is a verification gap, not a code gap, and
it should be named as such rather than counted as done.

---

## 2. Colour needs three variants, not two

**What Apple specifies.** "If you do apply color to these elements, leverage
system colors, or define a custom color with light and dark variants, **and an
increased contrast option for each variant**."

**Implication for PINGO.** PINGO's tokens define light and dark. There is no
increased-contrast variant of the pink, or of anything else. Under
`prefers-contrast: more`, PINGO currently reduces transparency but keeps the
same accent — which is half the answer. This is a concrete, bounded token job
and it is the largest genuine accessibility gap the corpus surfaces.

---

## 3. Motion is never the only channel

**What Apple specifies.** "Make motion optional … avoid using it as the only way
to communicate important information," supplementing with "haptics and audio."

**Implication for PINGO.** Binding on the morph work. If a Ping's expand and
collapse is the only thing that says "this was opened and is now spent," then
under reduced motion nothing says it. The spent state must be legible in a still
frame, and the animation is decoration on top of a state that already reads.

---

## 4. Every icon carries a label, regardless

**What Apple specifies.** "Regardless of what you show in the interface, always
specify an accessibility label for each icon. This way, people who prefer a text
label can opt into this information."

**Implication for PINGO.** Not a design decision and not negotiable. Belongs in
the same pass as the toolbar icon audit in `04`.
