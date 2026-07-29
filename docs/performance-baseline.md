# PINGO — performance baseline

**Every number here was observed. Nothing is estimated, modelled or rounded up
from a guess.** Where a metric could not be measured, it says so.

This is the fixed point every later optimisation is compared against. It was
taken **before** Phase 1 (row-per-message + conversation index), which has not
been started.

---

## 1. Conditions of the run

| | |
| --- | --- |
| Date | 2026-07-29 |
| Build under test | `pingochat.pages.dev`, bundle `assets/index-BQ2D0itG.js` |
| Repository commit | `3dd232c` |
| Browser | Chrome 150.0.7871.187, headless (`headless: 'new'`) |
| OS | Windows 10 Pro 19045 |
| Harness | `apps/web/scripts/benchmark.mjs`, driving Chrome over CDP |
| Profile | `E:\ClaudeData\scratch\bench-profile` — isolated, signed in, reused across runs |
| Account | 6 conversations visible; server holds 1,927 messages, 0 encrypted |
| Iterations | 20 per condition, 60 total |

### The three conditions

| Condition | What it means |
| --- | --- |
| `empty` | HTTP cache disabled via CDP, CacheStorage emptied, service worker unregistered. The local database is **kept** — this measures a cold launch, not a first-ever install. |
| `warm` | Nothing cleared. Whatever the previous run left in place. |
| `persisted` | As `empty`, with `navigator.storage.persist()` granted first. Confirmed granted: `persisted: true`. |

### What "clean profile" had to mean

A genuinely fresh profile per run is a **signed-out** profile per run, and a
signed-out app has no conversation list to time — the headline metric would be
unmeasurable. So the profile is isolated from ordinary browsing but persistent
across runs, and cache state is controlled explicitly per run instead. This is
a deviation from the literal request and is recorded rather than glossed over.

---

## 2. Results

All values in milliseconds unless stated. **median / p95 / worst**, n=20 each.

### Cold launch, empty cache

| Metric | Median | p95 | Worst |
| --- | ---: | ---: | ---: |
| First Paint | 208.0 | 256.0 | 428.0 |
| First Contentful Paint | 856.0 | 1360.0 | 2020.0 |
| **Conversation list visible** | **2311.8** | **2924.3** | **3464.5** |
| First interaction possible | 2313.2 | 2926.1 | 3465.8 |
| Background sync complete | 2820.5 | 3457.3 | 3956.5 |
| **Open an existing conversation** | **144.1** | **165.6** | **295.4** |
| JS heap (MB) | 7.5 | 7.5 | 7.5 |
| IndexedDB (MB) | 2.3 | 2.4 | 2.4 |
| Network requests | 68 | 71 | 73 |
| Transferred (KB) | 529.6 | 987.7 | 989.8 |

### Warm launch

| Metric | Median | p95 | Worst |
| --- | ---: | ---: | ---: |
| First Paint | 60.0 | 132.0 | 396.0 |
| First Contentful Paint | 2164.0 | 2588.0 | 2768.0 |
| **Conversation list visible** | **2515.7** | **3044.4** | **3156.3** |
| First interaction possible | 2516.9 | 3054.4 | 3158.0 |
| Background sync complete | 2982.2 | 3485.9 | 3664.3 |
| **Open an existing conversation** | **149.8** | **245.3** | **247.2** |
| JS heap (MB) | 5.7 | 5.9 | 6.0 |
| IndexedDB (MB) | 3.0 | 3.1 | 3.1 |
| Network requests | 45 | 47 | 50 |
| Transferred (KB) | 2.5 | 3.0 | 4.3 |

### Cold launch, persistent storage granted

| Metric | Median | p95 | Worst |
| --- | ---: | ---: | ---: |
| First Paint | 208.0 | 440.0 | 468.0 |
| First Contentful Paint | 948.0 | 1212.0 | 1400.0 |
| **Conversation list visible** | **2410.3** | **2645.9** | **3075.9** |
| First interaction possible | 2413.1 | 2646.8 | 3078.7 |
| Background sync complete | 2976.2 | 3167.1 | 3613.0 |
| **Open an existing conversation** | **163.5** | **437.1** | **548.6** |
| JS heap (MB) | 7.5 | 7.6 | 7.6 |
| IndexedDB (MB) | 2.7 | 2.8 | 2.8 |
| Network requests | 69 | 74 | 75 |
| Transferred (KB) | 530.5 | 991.4 | 991.5 |

### Against the stated targets

| Target | Measured (cold, median) | Verdict |
| --- | --- | --- |
| Conversation list < 100 ms | **2311.8 ms** | **23× over** |
| Existing chat open < 100 ms | **144.1 ms** | 1.4× over |
| Background sync non-blocking | completes 509 ms *after* the list paints | already non-blocking |
| Network: deltas only | 32 REST calls per launch | not yet |
| Memory bounded | 7.5 MB heap, flat across 20 runs | holding |

---

## 3. Where the cold-launch time goes

Captured separately, on one instrumented cold launch: **63 responses, of which
32 are Supabase REST calls**, before the list is on screen.

| Calls | Endpoint |
| ---: | --- |
| 8 | `profiles` |
| 4 | `conversation_members` |
| 3 | `chat_list_members` |
| 2 | `stories` |
| 2 | `story_muted_authors` |
| 2 | `device_keys` |
| 2 | `conversations` |
| 2 | `rpc/conversation_previews` |
| 2 | `rpc/my_streaks` |
| 2 | `messages` |
| 2 | `rpc/unread_notifications` |
| 1 | `chat_lists` |

Own-origin assets in the same launch: 1 document, 2 scripts, 1 stylesheet,
1 font, 2 images, 1 manifest, 2 fetches.

---

## 4. Unexpected behaviour, recorded before any fix

Per the standing rule, these are written down first and left alone.

### 4.1 Warm First Contentful Paint is 2.5× *worse* than cold

FCP is 856 ms cold and **2164 ms warm**, while First Paint moves the other way
(208 ms cold, 60 ms warm). So the warm run puts pixels up sooner and meaningful
content up much later.

Not explained. It is reproducible across 20 runs at every percentile, so it is
not noise. Whatever it is, it means the service worker is currently making the
*perceived* start worse rather than better.

### 4.2 Almost every startup request is made twice

`conversations`, `conversation_members`, `messages`, `device_keys`, `stories`,
`story_muted_authors`, and three RPCs all appear exactly twice in one launch.

This is a production build, where React StrictMode does **not** double-invoke
effects, so the usual explanation does not apply. Unverified.

### 4.3 `profiles` is fetched 8 times

The largest single group. Consistent with per-participant fetching rather than
one batched call, but the cause has not been confirmed.

### 4.4 Conversation-open p95 is 2.7× its median under `persisted`

163.5 ms median against 437.1 ms p95 and 548.6 ms worst — a much wider spread
than the same metric under `empty` (144.1 / 165.6 / 295.4). Only appears in the
persisted condition. Unexplained; may be storage-pressure bookkeeping, may be
noise that 20 runs is too few to settle.

---

## 5. Method, and what it does not measure

- **Bytes and request counts come from CDP**, not Resource Timing, which
  reports `transferSize: 0` for cached responses and would have flattered the
  warm condition — the exact number Phase 1 is meant to change.
- **"First interaction possible" is an approximation and not Lighthouse TTI.**
  It is: the list exists, then no long task for 500 ms. A lower bound, measured
  identically every run. Its near-identity with list-visible (within 3 ms in
  every condition) says the main thread is already quiet by the time the list
  appears — the wait is network, not CPU.
- **Not measured:** scroll frame rate, and behaviour on a long conversation.
  The 60 FPS target is unverified because the harness has no scroll driver yet.
- **Single machine, single network.** These numbers are a fixed point for
  comparison, not a claim about what users experience.

---

## 6. Phase 1 — milestone 1: local-first conversation index

Commit `112fea7`, bundle `assets/index-C1X5Vv7Y.js`. 20 runs per condition,
plus a repeat of `empty` because the first result looked wrong.

### The comparison had to be normalised, and here is why

**First Paint moved.** It is the control variable — it happens before any
application code runs, so nothing in this milestone can affect it.

| | Baseline | After M1 (run A) | After M1 (run B) |
| --- | ---: | ---: | ---: |
| First Paint, median | 208.0 | 504.0 | 448.0 |
| First Paint, p95 | 256.0 | 2100.0 | 1892.0 |

A control that moves 7× at p95 means the machine or the network is not what it
was five hours earlier. **Absolute timings from these runs cannot be compared
against §2 and are not presented as if they could be.**

### What can be compared: the gap between paint and list

The time between the page having painted something and the conversation list
being on screen. It is exactly the work this milestone changed, and it is
independent of how long the page took to arrive.

| Condition | Baseline median | After M1 | Change |
| --- | ---: | ---: | --- |
| `empty` | 1434.4 ms | **6.3 / 4.7 ms** | ~230× faster |
| `persisted` | 1428.4 ms | **7.8 ms** | ~183× faster |
| `warm` | 350.0 ms | **11.9 ms** | ~29× faster |

p95, same measure: `empty` 1843.1 → 27.8 / 121.4 · `persisted` 1630.7 → 41.3 ·
`warm` 614.1 → 41.8.

The list now appears with first contentful paint rather than a second and a
half after it. Everything still on the clock is the app shell arriving, not
data being fetched.

### One absolute number that survived the noise

`persisted` improved even against a slower network: **2410.3 → 1280.4 ms**
median to list visible, a 47% reduction. Offered as a single observation, not
as the headline.

### What did not improve, and why

- **Network requests: 68 → 75.** Unchanged by design. This milestone stops the
  screen *waiting* for those calls; it does not remove any of them. Reducing
  the count is milestone 3 (delta sync) and the separate duplicate-request
  investigation.
- **Conversation open: 144.1 → 147.9 ms** (`persisted`). Unchanged as expected —
  threads were already cache-first, so there was nothing here to fix.
- **The < 100 ms target is still not met in absolute terms.** The data is no
  longer the constraint; the app shell is. Getting the total under 100 ms is a
  bundle and service-worker problem, not a storage one, and it is not what
  Phase 1 is for.
- **Transferred bytes: unchanged.** Same reason as request count.

### Method note

Two `empty` runs are recorded rather than one. The first produced a p95 of
7701 ms and I did not publish it as a result, because a First Paint p95 of
2100 ms in the same run said the environment was degraded. The repeat behaved
the same way, which confirmed the environment rather than the code. Both are in
the raw data.

---

## 7. Phase 1 — milestone 2: row-per-message, dual-write

Commit `5707a50`. 20 runs, `empty`. Dual-write only: rows are written beside
the blob and nothing reads them for display, so any change here is **cost, not
benefit** — the benefit arrives in milestone 3.

### Verified on real data first

| Conversation | Server messages | Expected (50-page cap) | Rows written |
| --- | ---: | ---: | ---: |
| `08db6020` | 10 | 10 | **10** |
| `68d0ed53` | 59 | 50 | **50** |
| `cb1a9a20` | 65 | 50 | **50** |

111 rows across 4 conversations. All sealed, keys chronological, and no
plaintext found on disk. The row store mirrors the blob exactly.

### What it cost

| Metric | Baseline | M1 | **M2** |
| --- | ---: | ---: | ---: |
| FCP → list gap, median | 1434.4 | 4.7–6.3 | **33.2** |
| Conversation open, median | 144.1 | 169.6 | **332.1** |
| IndexedDB size | 2.3 MB | 3.1 MB | **5.5 MB** |
| Requests | 68 | 75 | **75** |

**Conversation open roughly doubled**, from 169.6 ms to 332.1 ms. The gap also
went from ~5 ms to 33.2 ms. Both are still far better than the 1434.4 ms
baseline, but the direction is wrong and the cause is not mysterious.

### Why, and what it means for milestone 3

Sealing a page as one blob is **one** AES-GCM encrypt. Sealing it as fifty rows
is **fifty**. Dual-write therefore does 51 encrypts where the old path did 1,
and reading fifty rows back would likewise be fifty decrypts against one.

That is worth stating plainly because it complicates the plan: **row-per-message
is not cheaper than the blob for reading a whole page — it is dearer.** What it
buys is incremental sync, lazy history and eviction, none of which the blob can
do at all. The bet is that once milestone 3 lands, a full fifty-row read
becomes rare: a quiet conversation reads nothing and appends nothing.

If that bet turns out wrong when measured, the honest conclusion would be to
keep a small blob for the newest page and rows only for history — and that
decision should be made on numbers from milestone 3, not on this table.

### Unchanged, as expected

Requests stayed at 75 and bytes did not move. Milestone 2 does not touch the
network, and request-count work was explicitly out of scope.

---

## 8. Phase 1 — milestone 3: delta sync

Commits `90e7fc8` (the `updated_at` column) and `b32cba5` (the delta path),
bundle `assets/index-D5aGATZU.js`. 20 runs, `empty`.

This is the milestone §7 deferred its conclusion to, so it is measured against
the question §7 actually asked: does making a full page read *rare* pay for
having made it *dearer*?

### The latency bet paid

| Metric | Baseline | M1 | M2 | **M3** |
| --- | ---: | ---: | ---: | ---: |
| **Conversation open, median** | 144.1 | 169.6 | 332.1 | **124.1** |
| Conversation open, p95 | 165.6 | — | — | **143.3** |
| FCP → list gap, median | 1434.4 | 4.7–6.3 | 33.2 | **3.8** |
| IndexedDB size (MB) | 2.3 | 3.1 | 5.5 | **6.2** |
| Requests | 68 | 75 | 75 | **78** |
| Transferred (KB) | 530 | 991 | 992 | **993** |

**Conversation open went 332.1 → 124.1 ms**, undoing milestone 2's regression
and landing 14% below the pre-Phase-1 baseline. It is also the tightest
distribution recorded here: p95 143.3, worst 147.5 across 20 runs, against a
baseline worst of 295.4. The fifty decrypts M2 added are no longer on the path
that opens a conversation.

The FCP → list gap also improved to 3.8 ms, the best of any run in this
document.

### The network goal was not met

**Requests went up, 75 → 78.** Milestone 3 was supposed to reduce them, and
this is the opposite. It is not noise: 78 median, and no run below 67.

`benchmark-delta.mjs` was written to find out why, because the timing table
cannot. It counts REST traffic attributable to the tap itself rather than to
the launch. Opening a conversation in which nothing had changed produced:

```
delta [200] /messages?select=*&conversation_id=eq.68d0ed53…&updated_at=gt.2026-07-28T13…
PAGE  [?]   /messages?select=*&conversation_id=eq.68d0ed53…&order=created_at.desc&limit…
```

**Both.** The delta question is asked, it succeeds, and the page is refetched
anyway — so milestone 3 currently *adds* a query rather than replacing one,
which is exactly the +3 in the table. The stated aim, "a quiet conversation
reads nothing and appends nothing", is not what the deployed build does.

Per the code, a page fetch after a delta means `#deltaMessages` returned
`undefined` and `listMessages` fell through to `#listMessagesFromNetwork` —
its only two callers are that fallback and explicit paging. So the fast path is
declining, not short-circuiting.

**How often it declines is not constant.** Two runs of the same probe against
the same conversation disagreed:

| Run | Warm opens that still refetched the page |
| --- | --- |
| 8 opens | **7 / 7** |
| 3 opens | **1 / 2** |

That range is reported rather than averaged, because two runs is not a rate and
presenting one would invent precision that was not measured.

### Why this could not be pinned down further

`ChatService.deltaReport()` exists for precisely this question —
`chat-service.ts:423`, commented "counted rather than logged so milestone 3 can
be measured on a real device instead of argued about". It has **no callers and
is not exposed on `window`**, so in the shipped bundle there is no way to read
`hits`, `misses` or `rowsFetched`. Whether the delta returns zero rows and
something else refetches, or returns rows that fail to decrypt and falls
through, is the difference between two unrelated bugs, and the instrumentation
built to distinguish them is unreachable. Making it reachable is the first step
of milestone 4, ahead of any further optimisation.

An attempt to distinguish the two from response sizes failed: CDP reported
`encodedDataLength: 0` for every REST response in this environment, so
per-query byte attribution is not available and is not presented.

### Conditions, and what is not comparable

First Paint — the control variable — was 452.0 median against the baseline's
208.0, with one run at 24.9 s. **Absolute launch timings from this run cannot
be compared against §2 and are not presented as if they could be.** The gap and
conversation-open figures are used instead, for the reason given in §6: both
are independent of how long the page took to arrive.

Conversation open is measured on one conversation of 59 messages. A quiet
conversation is the case milestone 3 is built for and the case measured; a busy
one is not covered here.

### Verdict

| §7 asked | Answer |
| --- | --- |
| Does a full page read become rare? | **No.** Still fetched on every open observed, sometimes twice over. |
| Does the row store pay for itself on latency? | **Yes.** 332.1 → 124.1 ms, below baseline. |

The row-per-message architecture is vindicated on the metric users feel and
unproven on the metric it was justified by. §7's fallback — "keep a small blob
for the newest page and rows only for history" — is **not** triggered, because
the latency it was meant to rescue is already fixed. What is open is a defect,
not a design question: the fallback fires when it should not.

---

## 9. Raw data

One JSON file per condition, every individual run included:
`E:\ClaudeData\scratch\bench\results\{empty,warm,persisted}-<timestamp>.json`

Delta-sync probes are saved alongside them as `delta-<timestamp>.json`.

Reproduce with:

```
node apps/web/scripts/benchmark.mjs --runs 20 --condition empty
node apps/web/scripts/benchmark.mjs --runs 20 --condition warm
node apps/web/scripts/benchmark.mjs --runs 20 --condition persisted

node apps/web/scripts/benchmark-gap.mjs            # normalised FCP -> list gap
node apps/web/scripts/benchmark-delta.mjs --opens 8 # what an open actually fetches
```
