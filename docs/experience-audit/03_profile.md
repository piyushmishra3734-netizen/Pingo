# 03 · Profile and social — experience audit

Audited: `/profile`, `/profile/:handle`, `/profile/edit`, `/profile/journey`,
`/profile/mission`, `/profile/achievements`, `/requests`, `/stories/archive`,
`/r/:code`, `features/profile/**`. Read-only audit; nothing changed.

**Summary.** The area is well built and unusually self-aware — most files carry
their rationale in comments, and `ProfileScreen.tsx` already follows the
title-case rule (`SectionHead`, `:1112`). But everything **one tap deeper** —
Journey, Mission, Achievements — regressed on exactly that rule: every section
heading there is forced uppercase. Journey also has two always-on layout
defects: a "Today's missions" section that is permanently fake with no signal
that it is fake, and Mythic/Legendary badge rows structurally guaranteed to sit
one or two tiles alone in a six-column grid. On the visitor side,
`/profile/:handle` swallows every fetch failure into the same empty state a
genuinely empty account shows.

**Journey is frozen at v1.** None of the fixes below propose new Journey rules,
mechanics or numbers — all are presentation, hiding or layout.

---

## `/profile` versus `/profile/:handle`

Both render `ProfileScreen.tsx`, gated throughout by `isSelf` (`:111`).

| | Own | Other | Decided at |
| --- | --- | --- | --- |
| Header action | menu → post/edit/share/settings | more → share/copy/mute/block/report | `:521-539, 945-1003` |
| Primary actions | Edit, Share | Add friend, Message, calls (disabled until mutual) | `:694-787` |
| Media tab | present | **absent entirely** — not disabled, not locked | `:336, 875-913`, rationale `:85-92` |
| Friends/Groups stats | open a list sheet | inert numbers | `:685-691` |
| Achievements shelf | full shelf | nothing but the `AchievementMark` by the name | `:810-836` vs `:662` |
| Journey | static teaser, link-out only | live badge row from `publicJourney()` | `:848-855` vs `:857-862` |
| Shared history | n/a | `SharedWithPanel`, two-sided, absent if empty | `:790` |
| Blocked | n/a | **banner text only** — does not hide posts, stats or tabs | `:781-785` |

A coherent split, and the best-documented part of the area (`:69-93`). Two weak
points, both on the visitor side: the Journey row cannot tell loading from empty
(fix 4), and `blocked` changes only a caption while their posts stay visible —
worth a product decision rather than being asserted here as a bug.

`/profile/journey`, `/mission` and `/achievements` take no `:handle` — they are
always your own, reachable only through `isSelf`-gated links. A visitor's only
window into someone else's Journey is that badge row.

---

## Screen by screen

### ProfileScreen

First paint: cover → avatar pulled up `-mt-[68px]` (`:559-622`) → name +
achievement mark → handle and bio → three stats → actions → shared history
(other) → achievements shelf (self) → Journey → tabs → post grid.

**Present:** loading (`:315`), not-found (`:317-328`), posts and media states
(`:887-913`), blocked banner, follow-pending, realtime updates (`:232-259`).

**Missing — an error state, anywhere.** Every read in the load effect catches to
`undefined` / `[]` / silence: stats (`:167-170`), `listPosts` (`:172-175`),
`listChatMedia` (`:178-181`), `sharedWith` (`:183-186`), `isBlocked` (`:187-190`),
`publicJourney` (`:200-203`). A network failure is indistinguishable from "this
person really has nothing." `listPosts` catching to `[]` (`:175`) is the sharpest
case — it renders the exact empty-account component (`:889-892`), with no retry.

**Missing — loading versus nothing published,** for another person's Journey.
`journey` starts `null` (`:147`), resets on handle change (`:157`), and stays
`null` on error (`:203`); `ProfileJourney.tsx:57-58` treats no-badges and
not-yet-loaded identically. Both render nothing.

Layout is clean on an 8pt rhythm (`:541-546`). Stat tiles share a fixed
three-column grid (`:1134-1198`); `PostGrid` fills to exactly three squares with
matching empty slots so nothing sits alone. Motion is decorative on top of state
that reads without it (`:1219-1223`). No violations.

### EditProfileScreen

Clean. Loading (`:178-184`), debounced username availability (`:113-141`), save
error (`:402-412`). No all-caps. **Good, no changes needed.**

### JourneyScreen

**`TodaysMissions` renders `DUMMY_MISSIONS`** (`:30, 166`; data at
`features/journey/dummy-journey.ts:72-90`) — fixed, static, fake progress shown
to every user forever, with nothing distinguishing it from the genuinely live
sections beside it (level, Pulse, badge library, all real per
`useJourneyProgress.ts`).

**Mythic and Legendary are structurally near-empty.** The registry has exactly
1 mythic and 2 legendary against 12 rare, 8 epic, 5 common
(`features/badges/registry.ts`). Locked badges are shown by design (`:16-20`), so
these sections always render one or two tiles in `grid-cols-4 sm:grid-cols-6`
(`:261`) — a badge alone with five columns of dead space, at the bottom of the
page, in the section meant to feel rarest.

**Nine ALL CAPS headers from one component.** `features/journey/sections.tsx:28`
hard-codes `uppercase tracking-wide`, driving "Today" (`:194-201`), "Pulse"
(`:237`), "Recently earned" (`:313`), "Statistics" (`:365`), and via
`LifeChapters.tsx` "On this day" (`:55`) and "Life chapters" (`:79`). Rarity
sub-headers are separately hardcoded uppercase (`JourneyScreen.tsx:248`).

Good detail worth keeping: `MissionCard` pins its progress bar with `mt-auto`
(`sections.tsx:123-192`) so siblings' bars align regardless of title wrap.
Statistics is an honest "coming soon" with no invented numbers (`:358-381`).

### MythicMissionScreen

**The best state design in the audited set.** Skeleton matching the final layout
shape (`:622-642`), no-mission (`:131-134`), and unlocked versus in-progress as
two genuinely different modes rather than a label swap.

Six hardcoded uppercase headers (`:298, 325, 406, 512, 595`), five of them
repeating the identical class fragment inline rather than through a shared
component — worth extracting one `SectionLabel` while fixing the case.

### AchievementsScreen

Honest empty state, no upsell (explicit non-goal, `:25-30`). `SectionLabel`
(`:187-198`) hard-codes uppercase for "Collection", "Badge aura", "Profile
accent".

**And a corner-radius split.** This screen's local `Card` (`:209-211`)
deliberately uses `rounded-[1.25rem]`, with a rationale citing iOS
inset-grouped lists — it adopted the Apple radius rule. JourneyScreen's visually
equivalent cards use `@pingo/ui`'s generic `Card` at default `rounded-lg`
(`packages/ui/src/primitives/Surface.tsx:44`). Two screens one tap apart, same
object, two radii.

### FollowRequestsScreen

States complete: loading (`:97-98`), empty (`:99-104`), per-row busy, error
banner (`:88-95`).

**The one screen that does not use the shared `ScreenHeader`** — it hand-rolls
its own (`:73-85`) with a different back button and a title that is **always
left-aligned**, while `ScreenHeader.tsx:13-14` states the convention explicitly:
"title is centred when a back button is present."

### StoryArchiveScreen · ReferralLandingScreen

Archive: skeleton (`:60-64`), correct empty copy (`:66-70`), no all-caps.
**Good.** Referral: not a UI screen, records the code and redirects (`:47`);
the reasoning for having no screen is sound (`:9-32`).

---

## Top five fixes

1. **All-caps headers across Journey, Mission and Achievements.**
   `sections.tsx:28`, `LifeChapters.tsx:55,79`, `JourneyScreen.tsx:248`,
   `AchievementsScreen.tsx:191`, `MythicMissionScreen.tsx:298,325,406,512,595`.
   Nine-plus labels shout one tap into your own profile while
   `ProfileScreen.tsx:1112` already does not. Strings are already title case.
   **Small** — CSS only, ~4 files.

2. **"Today's missions" is permanently fake.**
   `JourneyScreen.tsx:30,166` → `dummy-journey.ts:72-90`. Hide the section until
   real mission data exists. A deletion, not a feature — compatible with the
   Journey freeze. **Small.**

3. **Mythic/Legendary sit alone in a wide grid.**
   `JourneyScreen.tsx:144-147, 261`. For a section with fewer entries than the
   column count, render a left-aligned flex row instead of a grid — the pattern
   `RecentUnlocks` already uses (`sections.tsx:314`). **Small-medium.**

4. **Another person's Journey cannot tell loading from empty.**
   `ProfileScreen.tsx:147,157,200-203` and `ProfileJourney.tsx:57-58`. Give
   `journey` a real three-state type — `undefined` not asked, `null` asked and
   empty, data — and skip rendering only on the second. **Small.**

5. **Every profile fetch failure renders as "this person has nothing."**
   `ProfileScreen.tsx:170,175,186,190,203`. At minimum for `listPosts` and
   `stats`, track a distinct error flag and show an inline retry instead of the
   empty-account copy. A visitor with a network blip currently sees a stranger
   with an empty life. **Medium** — several call sites, needs an error affordance.
