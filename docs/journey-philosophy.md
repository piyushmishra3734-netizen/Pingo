# Journey — the philosophy

**Status:** source of truth for every Journey feature, present and future.
**Rule:** a Journey change that conflicts with this document is wrong, even if
it is well built.

Journey is a **personal growth system**, not an achievement system. Users should
feel proud. Never pressured, never addicted, never punished. The reference points
are a GitHub contribution history and Spotify Wrapped — not a mobile game.

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
| Recent badges | Memories |
| Favourite badges | Personal statistics |
| Current streak | Pulse |
| Friendship milestones | |

Missions are private because a visible to-do list is a visible failure list.
Pulse is private because it names other people.

The reaction being designed for is *"this person has really been here"*, not
*"this person farmed"*.

## 6. Badges are memories, not rarity

"Friends Since 2026", "Weekend Caller", "Night Owl" — people should recognise
**stories**, not tiers. Rarity stays a single muted dot and never touches the
artwork. See `docs` for the badge library rules.

## 7. Weekly reflection, never ranking

One card on a Sunday evening: friendships strengthened, time spent talking,
badges earned, stories shared. No leaderboard, no comparison to last week framed
as a shortfall, no other users. Reflection only.

*Not yet built.*

---

## What exists now

| | |
| --- | --- |
| Badge library and registry | built, 37 checks |
| Journey screen — six sections | built, dummy data |
| Chats-list strip | built, dummy data |
| Daily card | built, once per local day |
| Language rules | built and centralised |
| Public Journey | **designed here, not built** |
| Weekly reflection | **designed here, not built** |
| Adaptive difficulty | **designed here, needs metrics** |

Everything above runs on `dummy-progress.ts` and `dummy-journey.ts`. Phase 2
replaces those imports and nothing else moves.
