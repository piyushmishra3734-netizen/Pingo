# 07 · First run, and what happens while people wait

**Sources.** HIG → Onboarding
(`developer.apple.com/design/human-interface-guidelines/onboarding`) · HIG →
Loading (`.../loading`).

Read specifically for the experience audit rather than for the material. These
two pages carry the rules that decide whether a first-time user stays, and they
contradict PINGO's current shape in one important place.

---

## 1. Onboarding is optional, or it is not onboarding

**What Apple specifies.** "Ideally, people can understand your app or game
simply by experiencing it, but if onboarding is necessary, design a flow that's
fast, fun, and **optional**." If a tutorial is skipped, "don't present it again
on subsequent launches, but make sure it's easy for people to find … later," in
"a help, account, or settings area."

**The principle.** The best onboarding is the app. Anything in front of the app
is a toll, and a toll people cannot refuse is a wall.

**Implication for PINGO.** `/intro` (`IntroSlidesScreen.tsx`) is instructional
slides in front of the product. The rules to check it against are concrete: can
it be skipped, does skipping stick, and is it findable afterwards in settings?
If the answer to any is no, that is a defect with a published rule behind it,
not a matter of taste.

---

## 2. Postpone setup — the sharpest finding for PINGO

**What Apple specifies.** "**Postpone nonessential setup flows or customization
steps.** Provide reasonable default settings so most people can immediately
start interacting with your app or game without performing additional
configuration."

**Implication for PINGO — this is the one to act on.** PINGO gates the app
behind a four-step setup: `/setup/name`, `/setup/username`, `/setup/photo`,
`/setup/permissions`. Measured against the rule, only one of those is plausibly
essential to a chat app functioning at all — a username, because other people
address you by it. A display name can default. A photo can default and be set
later from the profile screen, where it already can be. Permissions are covered
by §3 below.

Each step is a place to leave. Three of the four are asking for configuration
before the person has seen a single reason to care.

**What to verify before changing anything.** Whether username is genuinely
required at creation, and whether anything downstream assumes a photo exists.
That is a code question, not a design one, and it comes first.

---

## 3. Ask for a permission where it is used, not up front

**What Apple specifies.** "If your app … needs access to private data or
resources **before it can function**, consider integrating the permission
request into your onboarding flow. In this scenario, making the request during
your onboarding flow gives you the opportunity to show people why … **Otherwise,
present a permission request when people first access the specific function**
that relies on private data or resources."

**The principle.** A permission prompt with no visible purpose is a prompt with
no reason to say yes. Context is the argument.

**Implication for PINGO.** `/setup/permissions` asks up front. The test Apple
gives is "before it can function" — and PINGO's core function is messaging,
which needs neither camera nor microphone. Camera permission belongs at
`/camera`, on first use, where the reason is on screen. Notifications are the
arguable case, and even there the stronger moment is the first time somebody
sends you a message.

Deferring also raises the yes-rate, which is the practical reason as well as the
correct one.

---

## 4. Keep onboarding about your app, not about phones

**What Apple specifies.** "Keep onboarding content focused on the experience you
provide. People enter your onboarding flow to learn about your app or game; they
don't need to learn how to use the system or the device."

**Implication for PINGO.** A checkable audit of the intro slides' copy: any
slide teaching a gesture the platform already teaches is a slide to cut.

---

## 5. Teach in place, not in advance

**What Apple specifies.** "Teach through interactivity … Consider providing a
collection of context-specific tips instead of a single onboarding flow," and
"when you have instructional content that refers to a specific area of the
interface, display these instructions near that area."

**Implication for PINGO.** The alternative to the intro carousel is not "no
onboarding," it is tips that appear where the feature is. PINGO has genuinely
unusual features — Pings, view-once, Journey — that a slide cannot teach and a
tip beside the control can. Worth noting as the replacement, so cutting the
carousel is not read as removing help.

---

## 6. The splash screen is a cost, not a feature

**What Apple specifies.** "Briefly display a splash screen if necessary … just
long enough for people to absorb the information at a glance **without feeling
that it's delaying their experience**." And onboarding "occurs after launching
is complete — it isn't part of the launch experience."

**Implication for PINGO.** `SplashScreen.tsx` should be measured, not admired.
The question is how long it holds and whether any of that time is spent waiting
on something that could have loaded behind it.

---

## 7. Show placeholders, not spinners

**What Apple specifies.** "Show something as soon as possible. If you make
people wait … before displaying anything, they can interpret the lack of content
as a problem with your app. Instead, **consider showing placeholder text,
graphics, or animations as content loads, replacing these elements as content
becomes available**."

**The principle.** A spinner says "wait." A placeholder says "this is what is
coming, and it is nearly here." The second is the same wait, correctly framed.

**Implication for PINGO.** `ChatThread.tsx:1438` renders
`<LoadingState label="Loading messages" />` — an indicator plus a label, on the
most-visited screen in the app. The published better answer is skeleton rows in
the shape of the messages that are about to arrive. Same for the chat list and
profile.

This is a bounded, high-frequency win and it costs no new dependency.

---

## 8. Let people do other things while waiting

**What Apple specifies.** "Let people do other things in your app or game while
they wait for content to load. Loading content in the background helps give
people access to other actions."

**Implication for PINGO.** Any full-screen loading state that blocks the whole
view is worth questioning — especially where the person could be typing. A
thread that is still fetching history can still accept a message into the
composer.

---

## 9. Determinate when you know, indeterminate when you don't

**What Apple specifies.** "You use a determinate progress indicator when you
know how long loading will take, and … an indeterminate progress indicator when
you don't."

**Implication for PINGO.** Media upload knows its own byte count and should show
progress. `AppLoader` is correctly indeterminate — it cannot know. The defect to
look for is the reverse: an indeterminate spinner standing in for something
whose length is actually known.
