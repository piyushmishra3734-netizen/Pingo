# 06 · How the teams who did it actually worked

**Source.** Meet with Apple → "Liquid Glass showcase: Slack"
(`developer.apple.com/videos/play/meet-with-apple/255/`), full transcript, Jaime
DeLanghe and Akshay Bakshi of Slack. Sibling showcases exist for LTK, CNN and
Tide Guide, plus the parent panel session.

Slack is the closest published analogue PINGO has: a messaging app, with
threads, a composer, conversation headers, theming and heavy custom UI. This is
the single most useful source in the corpus, and none of its value is about
glass.

---

## 1. Custom controls are the bill that comes due

**What they said.** The iPad redesign they wanted to ship got cut: "a few years
ago, we had taken the path of custom controls for the sidebar and navigation
patterns. That kind of slowed us down on the engineering front. So we scoped
this down."

**Why it matters here more than anywhere else in this corpus.** PINGO is *all*
custom controls — `glass-water`, `GlassPanel`, a hand-written displacement map,
its own dock, its own composer. Slack paid for a fraction of that and it cost
them a platform's worth of scope.

**The honest implication.** Every proposal in this corpus that says "adopt the
Apple behaviour" means *hand-build it and maintain it forever*, because there is
no system component to inherit from. That is not a reason to skip them. It is
the reason to take very few, and to take the ones that pay rent.

**What not to copy.** Their conclusion. Slack's answer was to move toward native
controls; PINGO has no native controls to move toward. The transferable part is
the cost model, not the remedy.

---

## 2. Brand is not in the chrome

**What they said.** The fear was that going native would dilute the product:
"wouldn't going more native affect our products brand? Well, not really, because
in Slack our products brand shines through in the voice and tone of our copy.
The user customization and theming and of course, our emojis."

**The principle.** Identity lives in what the product *says* and what the user
can *change*, not in the shape of its buttons.

**Implication for PINGO.** PINGO's identity is the pink, the wallpapers, Journey,
Pings, the copy. Not the bevel on the dock. This is the sentence that makes it
safe to adopt any of the material rules in `01`–`05` without the product
becoming anonymous — and it is worth remembering the next time a decision is
defended on the grounds that it is "very PINGO."

---

## 3. They prototyped four headers and shipped the boring one

**What they said, in full detail — this is the most valuable passage in the
corpus.** For the conversation header they built and tried on device:

- a **concentric** version that "fit great into the device's shape, but that
  bottom edge didn't resolve quite well";
- a **capsule** version that "felt really nice," but going back and forth from
  an all-light or all-dark conversation, "it sometimes felt like a primary
  button";
- a **gradient** version resembling first-party apps, but "with the variability
  of the content in our scroll views, it didn't work quite well."

They landed on "something that was closer to what we had previously."

**Why this is the corrective the corpus needed.** Concentricity is a published
Apple rule with a framework primitive behind it (`03 §3`), and the team that
tried it hardest rejected it because of how one edge resolved. A rule from a
document is a hypothesis. The device is the authority.

**Implication for PINGO.** Downgrade the concentric-corners item from "correct"
to "worth prototyping." And adopt the method: build the variants, put them on
the cheapest real phone, and let that decide. PINGO's own memory already says
this — CSS guesses here have been wrong twice.

---

## 4. Follow the OS because it is cheaper for the user, not because it is prettier

**What they said.** "If the whole OS is shifting to Liquid Glass, why should
Slack be different? Why should Slack be extra Slack? … our job is not to teach
people how to use our super cool software." And on timing the search move:
"Every single Apple app would be getting updated in the fall, and users could
learn this with all the other apps" — it "decreased the user learning curve."

**The principle.** Convention is a subsidy. Moving when the platform moves means
somebody else teaches your users.

**Implication for PINGO.** PINGO is a web app on Android and desktop, so there
is no fall update carrying users along. The subsidy is not available, which
means novel interaction patterns cost PINGO *more* than they cost Slack, not
less. Argues for taking the quiet, conventional option wherever the corpus
offers a choice.

---

## 5. The search change came from a journey, not a layout

**What they said.** The motivation was concrete: you are mid-reply in a thread,
you need to look something up, and you "got to go all the way back to home … And
then go all the way back to where you were typing that reply originally. This
isn't being a great host."

**Implication for PINGO.** The Material Study argued search placement from
thumb reach. Slack argued it from a task that breaks. The second is the stronger
case and PINGO has the same break: finding an old message means leaving the
thread you are writing in. Worth checking whether PINGO loses the draft when
that happens — if it does, that is a bug worth more than the placement.

---

## 6. Ship order: most-used first, muscle memory last

**What they said.** Day one covered "the most used elements" — create menu, tab
bar, conversation headers, composer. The changes that were "a rewiring of muscle
memory" — the glass header, search moving to the tab bar — came in a later
release, deliberately. Then media player chrome and canvas controls in November,
landscape in December. "You don't have to start on day one and have the entire
app updated."

**Implication for PINGO.** Directly reorders the work. The Material Study
sequenced by cost and visibility; Slack sequences by *frequency of use first,
muscle-memory risk last*. Under that rule PINGO's composer and dock come before
the Ping morph, and anything that moves a control somebody already knows waits.

---

## 7. Native is an accelerant; custom is a commitment

**What they said.** "When we use native controls, it really felt like we were
swimming with the OS and the OS was propelling us forward." Landscape support
followed nearly free. "Spend your time really optimizing the things that are
unique to your app and the things that only your app can do."

**Implication for PINGO.** The last sentence is the test to apply to every item
in this corpus: does this make PINGO better at the thing only PINGO does? A
scroll-edge mask, an accessibility variant and a context-menu/swipe audit are
cheap and pay for themselves. A hand-built receding dock is a commitment to
maintain a system behaviour forever, on a screen where it cannot even help.
