# 01 · Materials and Liquid Glass

**Sources.** HIG → Materials (`developer.apple.com/design/human-interface-guidelines/materials`,
change log: Liquid Glass guidance added 9 Jun 2025, updated 9 Sep 2025) ·
Technology Overviews → Liquid Glass (`developer.apple.com/documentation/TechnologyOverviews/liquid-glass`).

---

## 1. Glass is a layer, not a texture

**What Apple specifies.** Liquid Glass "forms a distinct functional layer for
controls and navigation elements … that floats above the content layer." The
rule that follows is blunt: **"Don't use Liquid Glass in the content layer."**
Apple's reason is not aesthetic — putting it in the content layer "can result in
unnecessary complexity and a confusing visual hierarchy."

**The problem being solved.** A material that appears everywhere stops meaning
anything. If both the thing you read and the thing you press are glass, the
material no longer tells you which is which.

**The principle.** The material *is* the hierarchy. Glass means "this is a
control, and content is passing behind it."

**One stated exception, and it is the interesting one.** Controls inside the
content layer with "a transient interactive element like sliders and toggles"
*do* take on glass — but only "when a person activates it," to emphasise
interactivity.

**Implication for PINGO.** This is the published backing for the Material
Study's "lift into the material" item, and it makes it a rule rather than a
nicety. Message bubbles are content. They should not be glass at rest, and
`glass-water` on 50 scrolling bubbles is the exact pattern Apple names. Glass
belongs on the dock, the composer, the reaction bar, the context menu — and on a
bubble only while it is being pressed.

**What not to copy.** Nothing here. This one is a straight adoption, and it also
happens to be the cheapest thing PINGO could do for WebView performance.

---

## 2. Two variants, chosen by what is behind them

**What Apple specifies.** `regular` "blurs and adjusts the luminosity of
background content to maintain legibility"; it is what most system components
use, and is specified for components carrying "a significant amount of text,
such as alerts, sidebars, or popovers." `clear` is "highly translucent," for
components "that float above media backgrounds — such as photos and videos."

The guidance carries a number: over bright underlying content behind `clear`,
"consider adding a dark dimming layer of 35% opacity." Over sufficiently dark
content — or with AVKit's own controls, which dim themselves — none is needed.

**The problem being solved.** Legibility is a relationship with a background
that moves, not a fixed contrast value. One material cannot hold both jobs.

**Implication for PINGO.** PINGO ships custom wallpapers, which is exactly the
media-background case. Today `glass-water` is one material — `blur(5px)
saturate(160%)` — used in 36 places regardless of what is behind it. The split
that follows from this: composer and dock over a wallpaper want `clear` plus a
luminance-driven dim; sheets and menus carrying text want `regular`. The 35%
figure is a starting value Apple published, not a guess.

**What not to copy.** The variant *names*. PINGO has one hand-built material and
a displacement map of its own; adding an Apple-shaped API around it would be
vocabulary, not capability.

---

## 3. Sparingly, and only on the most important elements

**What Apple specifies.** "Use Liquid Glass effects sparingly." System components
get it automatically; custom ones should "limit these effects to the most
important functional elements." The reason given: the material "seeks to bring
attention to the underlying content," so overusing it "can provide a subpar user
experience by distracting from that content."

**The principle.** The material is a spotlight. Spotlighting everything is
lighting nothing.

**Implication for PINGO.** This turns the Material Study's tint audit from taste
into policy. `glass-water` is in 36 places; the honest question is which of
those are "the most important functional elements." Same audit the study
proposed for pink, now applied to the material itself.

---

## 4. Standard materials do the content-layer job

**What Apple specifies.** Below the glass, use standard materials — blur,
vibrancy, blending — "to convey a sense of structure in the content beneath."
Thickness is a real trade-off Apple states both ways: thicker materials "can
provide better contrast for text," thinner ones "help people retain their
context by providing a visible reminder of the content that's in the background."

Two further rules worth carrying:

- **Choose by semantics, not by colour.** "Avoid selecting a material or effect
  based on the apparent color it imparts," because system settings change how it
  looks. A material picked because it looked right in one theme is a bug in the
  other.
- **Vibrant colours on top of materials**, so nothing reads as too dark, bright
  or low-contrast as the backdrop changes.

**Implication for PINGO.** PINGO has no content-layer material story at all —
it has one glass and then flat surfaces. The gap is not "add more glass," it is
"the content layer needs its own quieter structure," which is a tokens question.

---

## 5. Adoption is selective, and Apple says so

**What Apple specifies.** "If you have an existing app, adopting Liquid Glass
doesn't mean reinventing your app from the ground up."

**Why this matters here.** It is the sentence that licenses everything in `99`.
The corpus is not a mandate to rebuild PINGO in Apple's image; it is a set of
principles to adopt where they earn their place.
