# Journey — the philosophy

**Status: FROZEN at v1.** Source of truth for every Journey feature, present
and future.
**Rule:** a Journey change that conflicts with this document is wrong, even if
it is well built.

**No new rules are to be added to this document.** Journey v1 is complete. What
comes next is bugs, performance, sync, offline, notifications, voice notes and
calls — and real beta use. Fifty to a hundred people should live with this
before anything else is designed into it; the rules below were written without
a single real user's behaviour to check them against, and the next honest
version of this document is one edited by what those people actually do.

Tuning numbers — a ceiling, a weight, a threshold — is not a new rule and does
not need this section reopened.

Journey is a **personal growth system**, not an achievement system. Users should
feel proud. Never pressured, never addicted, never punished. The reference points
are a GitHub contribution history and Spotify Wrapped — not a mobile game.

> **Every Journey event must represent a memory worth remembering.**
> If an interaction would not matter to the user one year from now, it should
> probably not become Journey progress.

That is the first test anything must pass. It is stricter than "is this a
meaningful interaction", and it is the one that settles arguments about
borderline metrics: not *did something happen*, but *would anybody remember it*.
Every event kind answers it in writing, in `features/journey/events.ts`, and the
evaluator reads that answer rather than a comment.

**PINGO celebrates meaningful relationships. It does not maximise screen time.**
Every Journey feature should make somebody proud of the connections they built,
and never pressured to keep a number alive. That sentence outranks everything
below it and settles any argument the rest of this document does not.

The test: when somebody opens Journey they should remember **who they became**,
not what they unlocked.

### The test applied, once, so it is not abstract

The first draft of the daily missions was "Send 5 messages". It reads like a
mission and is a screen-time quota: five messages to one person and five
one-word messages to five people complete it identically. It rewards activity,
which is the thing being ruled out.

Missions now name a relationship and can only be finished by doing something
*with someone* — reply to somebody waiting, call a friend, check in on someone
quiet. Counts stay small, because the target is a **shape, not a volume**.
Adaptive difficulty moves the number without changing the shape.

---

## 1. Language is the mechanism, not the decoration

Vocabulary is how one of these systems turns into the other. "XP", "claim",
"collect", "reward", "grind" each carry a game with them: they describe a
currency being farmed. Once a screen reads that way, people play it that way —
and then feel punished on the day they do not.

| Never | Instead |
| --- | --- |
| XP, points | moments |
| claim, collect | earned |
| reward | — say nothing, or `+50 moments` |
| grind, farm | — |
| streak broken, lost, failed | Welcome back |

Enforced in `features/journey/language.ts`, in one file, so a future screen
cannot reintroduce the old vocabulary in a corner nobody re-reads.

**The internal field is still `xpReward`.** The registry is not being rewritten
to satisfy a copy rule, and an identifier is not what anybody reads. Only display
strings changed.

## 2. Nothing may punish

No streak that breaks. No red state. No reset animation. No count of days
missed. Coming back is the behaviour being encouraged, so it is the behaviour
being greeted — `WELCOME_BACK`, and the journey continues.

This rules out most of what makes retention mechanics work, deliberately.

## 3. Nothing may dominate

The chats list is for talking to people. The Journey strip there is one row at a
fixed low height with no artwork and no call to action — placed where it will be
seen and sized so it can be ignored. The moment it pulls attention from the
conversations below it, it has become the thing this document forbids.

The daily card is not a modal: nothing behind it is disabled, there is no scrim,
it never takes focus, it leaves after five seconds and can be swiped away. It is
a greeting, not a gate.

## 4. Adaptive difficulty, so activity is never punished

Missions scale with behaviour. A new user's "send 1 message" and a heavy user's
"send 30" are the same feeling and a different number. Nobody is given a harder
day for being more active — the target moves so the *achievability* stays put.

New accounts get missions completable in two to five minutes. Early success, not
early grind.

*Not yet built: needs real behaviour to adapt to. The mission shape supports it.*

## 5. Journey is public, in part

Another person's Journey is worth opening. What they see is what tells a story;
what stays private is what would turn it into a scoreboard or expose the user.

| Public | Private |
| --- | --- |
| Level | Today's missions |
| Joined | AI conversations |
| Badges they have earned | Memories |
| Favourite badges | Personal statistics |
| Current streak | Pulse |
| Friendship milestones | |

Missions are private because a visible to-do list is a visible failure list.
Pulse is private because it names other people.

The reaction being designed for is *"this person has really been here"*, not
*"this person farmed"*.

## 6. Every metric answers one question

**Does this represent a meaningful human interaction?** If the answer is no, it
does not contribute to Journey. Three consequences, and none of them is
optional:

- **Never reward spam.** Every metric names a ceiling — per day, and usually per
  person.
- **Never reward repetition.** Every metric names what does *not* count: the
  same thing again, the same person again, the identical message twice.
- **Never reward inactivity.** Nothing counts a login, a day, or a streak. There
  is no metric that goes up for being present.

### The pipeline

```
Events → Meaning Evaluator → Journey Metrics → Badge Evaluator → Journey UI
```

Nothing counts itself. A surface emits **events** — something happened, between
people, at a time — and has no opinion about what they are worth. The
**evaluator** (`features/journey/evaluate.ts`) applies the one-year test, the
ceilings, the exclusions and the mutual rules, and returns moments, metrics, and
every rejection with its reason. The Badge Evaluator and the UI are unchanged
downstream of it.

This is why it exists: stories, communities, meetups and the calendar all have
the same shape, and if each grows its own counter then each grows its own
version of "does this count" — which is how a philosophy erodes without anybody
deciding to change it.

**Rejections are returned, never dropped.** A number nobody can explain is a
number nobody trusts.

**Weight is where "quality before quantity" becomes arithmetic.** A message is
worth one and runs into a ceiling; a long conversation is worth a great deal and
has no equivalent. Checked: three hundred messages in a day count as thirty and
are worth 30, while one forty-five-minute call is worth 113. The suite fails if
volume ever wins.

`features/badges/metrics.ts` is now a **source**, not a counter: it turns
messages into events and knows nothing about their value. What it does not emit
is as deliberate as what it does — the policy counts voice notes the recipient
*played*, and nothing records a play, so no `voice.played` event is invented.
Approximating it with "sent" is how a metric quietly stops meaning what its
policy says.

Written out one metric at a time in `features/badges/metric-policy.ts`, with the
already-rejected ones kept beside them and the reason they were rejected.
`verify:badges` fails if a badge watches a metric that has not been through the
question, or if a policy has no ceiling or no exclusion — so the rule is
answered *before* anything is wired, which is what was asked for.

### Real Life needs the other person

The Real Life badges — Met Offline, Coffee Together, Birthday Wish, Celebrated
Together — are the only ones about the app being put down, and none of them can
be earned alone. A real-life badge one person can tap on their own is worth
nothing the moment somebody notices. `MUTUAL_METRICS` records that constraint
and the suite checks it.

The confirmation surface does not exist yet, so these stay locked for everybody.
That is the honest state, and better than inventing a proxy.

## 7. Badges are memories, not rarity

"Friends Since 2026", "Weekend Caller", "Night Owl" — people should recognise
**stories**, not tiers. Rarity stays a single muted dot and never touches the
artwork. See `docs` for the badge library rules.

## 8. Life Chapters

Journey grouped by year: joined, first friend, first night owl, met Baani. A
badge collection answers *what have I got*; a chapter answers *what happened*,
and the year heading is what turns a list of unlocks into a period of somebody's
life.

Rules, all checked in `verify:chapters`:

- A moment happened **once**. Anything that can go up again next week belongs in
  Statistics — an entry that keeps changing is not a memory.
- **A quiet year is not a chapter.** A year with nothing in it is absent, not
  drawn empty with "no moments yet" under it. That would be a record of absence,
  and §2 forbids it.
- **No counts.** No per-year totals. A chapter with a number becomes a year to
  beat, and next January starts at zero.
- **Months, never days.** "March", not "14 March, 21:40" — tone, and privacy on
  a public Journey.
- Nothing predates joining, and a badge removed from the library leaves no hole.

## 9. On this day, and friendship chapters

**On this day** — what happened on this date in an earlier year. The thing it
must not become is a memories feed: something shown daily whether or not there
is anything to show, with a button to post it again. So it renders **nothing**
on a day with no match, which is most days, and carries no share control. One
recollection at a time; two would be a list, and a list is scanned rather than
felt. Years are spelled out — a digit reads as data.

**Friendship chapters** — the same timeline narrowed to one person. Not a
second history: it is the moments you already have, filtered by who was there,
so the two can never disagree. It opens with the day you met rather than the day
you joined PINGO, because that is the story of the two of you.

*Built as data and checked. The friendship view has no screen yet: it needs the
pipeline to record who was in each moment, and until it does, every profile
would show the same dummy story.*

## 10. Journey may never go backwards

Counts come from what *this device* has cached. A fresh install, a trimmed
cache, or a restore that only brought back a year each produce a smaller number
than yesterday — and a level that drops because somebody changed phones is both
the punished feeling §2 forbids and simply untrue. The conversations happened.

So stored progress is a **floor**, never a source of truth: moments take the
larger value, badges are a union, an unlock keeps the earliest date it was ever
seen, and the story keeps its earliest beginning. Checked in `verify:progress`,
with the case that matters spelled out — a device that has seen a week of
history cannot reduce an account that had earned four thousand moments.

The curve is linear, not exponential: each level costs fifty more than the last.
An exponential curve is how a progression system tells somebody to play more.

## 11. Journey notices, and noticing is worth nothing

> Journey should occasionally notice meaningful moments that users never
> expected to be noticed. Those moments should never increase progress. They
> exist only to make people feel seen.

*"Today you replied to someone who had been waiting five days." "You checked in
with a friend it had been quiet with." "You spoke to your oldest friend here
again today."* Nothing was unlocked. The system simply noticed.

The second sentence is what protects the first. A notice that earned moments
would become something to trigger deliberately — reply late so the app calls you
kind — and a thing that can be farmed cannot make anybody feel seen. So noticing
returns no metric, no weight and no count, and `verify:noticing` asserts that a
day producing every notice the system has leaves the level exactly where it was.

Rarity is the feature: at most one a day, never the same one twice running, and
detectors deliberately conservative. Something that appears every time you open
a screen is furniture.

**The indicator is a feeling, not a score.** *Building new connections. Keeping
in touch. Growing steadily. Recently active. Quietly here.* No percentage, no
rank, no comparison — to last week or to anybody else. The quiet week is greeted
rather than judged, which is why it reads "Quietly here" and never "inactive".
This replaced "175 moments to level 7", which was a target wearing a caption.

*PINGO AI will one day notice out loud — "you've mostly been talking late at
night this week, everything okay?" — and it will be ignorable, unweighted and
rare, under exactly this rule. Not built.*

## 12. Weekly reflection, never ranking

One card on a Sunday evening: friendships strengthened, time spent talking,
badges earned, stories shared. No leaderboard, no comparison to last week framed
as a shortfall, no other users. Reflection only.

*Not yet built.*

---

## What exists now

| | |
| --- | --- |
| Badge library and registry | built, 28 badges, 46 checks |
| Metric policy | built, one entry per metric, checked |
| Event pipeline | built, 33 checks — evaluator, weights, rejections |
| Message source | built, 25 checks, **reading the real cache** |
| Level, and the no-going-back rule | built, 27 checks |
| Journey screen — seven sections | **live** — level, badges, Pulse, chapters |
| Life Chapters | **live**, from real unlock dates |
| On this day | **live** — and quiet until there is something |
| Today's missions | still stand-in: needs a call source and adaptive difficulty |
| Noticing | **live**, 18 checks, worth nothing by design |
| The feeling indicator | **live**, on Journey and the chats strip |
| Public Journey on a profile | **live** — level and the badges they earned |
| Friendship chapters | built as data, **no screen yet** |
| Chats-list strip | built, dummy data |
| Daily card | built, once per local day |
| Language rules | built and centralised |
| Weekly reflection | **designed here, not built** |
| Adaptive difficulty | **designed here, needs metrics** |

Everything above runs on `dummy-progress.ts` and `dummy-journey.ts`. Phase 2
replaces those imports and nothing else moves.
