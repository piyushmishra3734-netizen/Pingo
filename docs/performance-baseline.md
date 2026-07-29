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

## 7. Raw data

One JSON file per condition, every individual run included:
`E:\ClaudeData\scratch\bench\results\{empty,warm,persisted}-<timestamp>.json`

Reproduce with:

```
node apps/web/scripts/benchmark.mjs --runs 20 --condition empty
node apps/web/scripts/benchmark.mjs --runs 20 --condition warm
node apps/web/scripts/benchmark.mjs --runs 20 --condition persisted
```
