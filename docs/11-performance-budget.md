# 11 — Performance Budget

Part of the design system. A budget that cannot fail a build is a wish list, so every
number here has a measurement method and an enforcement point.

---

## 0. Two rules that make the rest meaningful

**1 · A budget without a reference device is not a budget.**
"Cold start < 2s" on a flagship is trivially true and tells you nothing. Every number
below is stated against a **reference device**, and the reference is deliberately modest.

**2 · A budget without a percentile is an average, and averages hide the problem.**
p50 tells you the experience is usually fine. **p95 tells you how often it isn't**, and
that is the number that decides whether people trust the product. All budgets are stated
at p95 unless marked otherwise.

### Reference devices

| Tier | Device | Why |
| --- | --- | --- |
| **Baseline** *(budgets are set here)* | Moto G-class Android, 4GB RAM, mid-range SoC | Where most of the world actually is |
| Baseline iOS | iPhone SE (2020) | Oldest actively supported |
| Baseline web | Chrome on a 2019 laptop, 4× CPU throttle | Approximates the baseline phone in DevTools |
| Reference network | 4G, 40ms RTT, 8 Mbps down / 2 Mbps up | Median mobile, not Wi-Fi |
| Stress network | 3G, 300ms RTT, 400 kbps | Must remain usable, not fast |

**Flagship devices are not a tier.** If it works on baseline it works on a flagship;
measuring the reverse proves nothing.

---

## 1. Startup

| Metric | Budget (p95) | Definition |
| --- | --- | --- |
| **Cold start** | **< 2000ms** | App icon tap → conversation list interactive, with cached data |
| **Cold start, first ever** | < 3000ms | Includes first sync stage 1 ([07 § 6.1](./07-offline-sync.md#61-staged-loading)) |
| **Warm start** | **< 800ms** | Process alive, activity recreated → interactive |
| **Hot resume** | < 200ms | Back from background, nothing recreated |
| Splash dwell | **exactly 1400ms** | Fixed by design ([01 § 1](./01-onboarding-auth.md#1-splash)) |
| First paint | < 600ms | Something branded on screen |
| Time to interactive | < 2000ms | Taps do something |

### 1.1 The splash is a ceiling, not a spinner

The splash holds for exactly 1400ms and then routes **whether or not the session check has
returned**. If it hasn't, we route to Home and Home shows its own loading state.

This makes cold start's *perceived* time constant, and it means a slow network can never
produce a hanging splash. It is also why "cold start < 2s" is achievable at p95 on a
baseline device: 1400ms of it is deterministic.

### 1.2 Startup phase budget

Cold start decomposed, so a regression can be attributed rather than guessed at.

| Phase | Budget | Notes |
| --- | --- | --- |
| Process init → first frame | 400ms | Platform-dominated; little we control |
| JS parse + execute | **250ms** | Directly proportional to bundle size (§ 4) |
| Token / theme application | 20ms | CSS custom properties, one pass |
| Session read (local) | 50ms | Local storage only. **Never a network call on the critical path** |
| Conversation list from cache | 150ms | Local database |
| First render | 100ms | |
| **Sum** | **970ms** | Leaves ~1000ms of headroom against the 2000ms budget |

**No network call is on the startup critical path.** The list renders from cache; the
network updates it afterwards. This is what keeps p95 close to p50 — the tail of a startup
distribution is almost always a network call someone put in the wrong place.

---

## 2. Interaction latency

Thresholds come from perception research, not preference: ~100ms reads as instant, ~200ms
as responsive, past ~1s attention wanders.

| Interaction | Budget (p95) | Notes |
| --- | --- | --- |
| **Chat open** | **< 200ms** | Tap row → first message painted, from cache |
| Chat open, uncached | < 600ms | Shows a skeleton within 100ms |
| Tap feedback | **< 50ms** | Visual response to any touch. Non-negotiable |
| Send → bubble on screen | **< 100ms** | Local echo. Independent of the network |
| Send → `sent` acknowledged | < 800ms | Network-dependent, and the tick reflects reality |
| Keystroke → glyph | < 16ms | One frame. A laggy composer is unusable |
| Screen push / pop | < 300ms | Including the 240ms transition |
| Search first results | < 150ms | Local results. Server results merge in behind |
| Media viewer open | < 250ms | Includes the 320ms expand, which starts immediately |
| Settings toggle | **< 50ms** | Optimistic. Never waits for the service |
| Scroll | **60fps sustained** | No dropped frames on a 500-row list |
| Tab switch | < 150ms | Preserves each tab's scroll position |

**Send → bubble < 100ms is the single most important number in this document.** It is the
core loop, it happens hundreds of times a day, and it must never depend on the network.
The message appears; the tick tells the truth about delivery separately.

---

## 3. Rendering & frames

| Metric | Budget |
| --- | --- |
| Frame rate | **60fps sustained**, 120fps where the display supports it |
| Frame budget | **16.67ms** at 60fps · 8.33ms at 120fps |
| Our share of a frame | **≤ 10ms** — the rest is compositing and system work |
| Dropped frames, scroll | **0** on the reference device |
| Dropped frames, transition | ≤ 2 total. More than 2 → the transition is **simplified, not optimised later** |
| Jank score (long tasks > 50ms) | 0 during any interaction |
| Layout thrash | **0 forced synchronous layouts** inside an animation frame |

### 3.1 Hard constraints

Restating from [08 § 6](./08-microinteractions.md#6-performance-budget) because they are
budget items, not style preferences:

| | |
| --- | --- |
| Animatable properties | `transform` and `opacity` **only** |
| Never animated | `width`, `height`, `top`, `left`, `margin`, shadow blur, `filter` on large surfaces |
| Concurrent animations | ≤ 3 on screen. Stagger beyond that |
| Stagger cap | 6 items — beyond that the last item's delay is a visible wait |
| **Glass surfaces** | **≤ 2 backdrop-filtered surfaces on screen** |
| List virtualisation | Required beyond 50 rows |
| Images | Always explicitly sized. An unsized image is a guaranteed layout shift |
| CLS (web) | **< 0.05** |

**The glass budget is the tightest real constraint.** The dock plus a sticky header is
already two. A third means one of them goes opaque on that screen — and that is a design
decision to make deliberately, not a performance bug to discover later.

---

## 4. Bundle size

### 4.1 Web — measured against the current build

| Asset | Current | Budget | Headroom |
| --- | --- | --- | --- |
| JS, gzip | **101 KB** | **175 KB** | 74 KB |
| JS, brotli | 88 KB | 150 KB | 62 KB |
| CSS, gzip | **7.8 KB** | **20 KB** | 12 KB |
| CSS, brotli | 6.9 KB | 18 KB | 11 KB |
| HTML | 1.5 KB | 4 KB | — |
| **Total transfer, first load** | **~110 KB** | **200 KB** | 90 KB |
| Fonts | 0 (CDN today) | **60 KB** self-hosted, subset | — |

Current JS is almost entirely React 19 + react-dom + react-router. Product code is a small
fraction, which is why the headroom is real: the remaining screens from
[01](./01-onboarding-auth.md)–[04](./04-settings.md) fit inside it if they are built with
the existing primitives rather than new dependencies.

### 4.2 Budget rules

| | |
| --- | --- |
| Route splitting | Every route lazy-loaded except Chats. Splash and Onboarding are **never** in the main chunk — they run once per install |
| Heavy features | PDF viewer, video player, GIF picker, emoji data: all dynamically imported on first use |
| Emoji data | Never bundled. Fetched and cached on first picker open |
| **New dependency** | Requires an RFC ([12 § 4](./12-design-governance.md#4-dependencies-are-a-design-decision)) with its gzip cost stated |
| Dependency ceiling | No single dependency above **20 KB gzip** without an RFC |
| Prohibited | moment, lodash (whole), any CSS-in-JS runtime, any icon font, any UI kit |
| Icons | Inline SVG from `@pingo/ui`. **Never** an icon font or a sprite request |
| Tree shaking | Verified — a barrel export that defeats it is a defect |

### 4.3 Native

| | Budget |
| --- | --- |
| Android APK (universal) | < 30 MB |
| Android, per-ABI split | < 15 MB |
| iOS IPA, download | < 40 MB |
| Install footprint, fresh | < 80 MB |

---

## 5. Memory

| Scenario | Budget (peak RSS, baseline device) |
| --- | --- |
| Idle, conversation list open | **< 120 MB** |
| Active thread, 50 messages | < 160 MB |
| Long thread, 1000 messages scrolled | **< 220 MB** |
| Media viewer, full-resolution image | < 280 MB |
| Video playback, 1080p | < 320 MB |
| Active video call | < 380 MB |
| Background | **< 40 MB** |

### 5.1 Rules

| | |
| --- | --- |
| Message windowing | Max **200** messages in memory per thread. Older ones are released and re-read from the local database on scroll |
| Image cache | ≤ 60 MB in memory, LRU. Disk cache is separate and governed by [10 § 10](./10-media-system.md#10-cache--storage) |
| Bitmap sizing | Decoded to **display size, never source size**. A 4000px photo in a 200px tile is a 60 MB mistake |
| Leaks | **Zero tolerance.** Navigating away and back 20 times must return to the baseline ±5 MB |
| Listener discipline | Every subscription has a matching teardown. `MockChatService.dispose()` exists for exactly this reason |
| Low-memory warning | Drop the image cache, keep drafts and the queue |

**The 20×-navigation test is the one that catches real leaks.** A single navigation looks
fine even when a listener is retained.

---

## 6. Battery

The hardest budget to measure and the easiest to blow. These are targets with named
mechanisms, because battery is almost always caused by a specific behaviour rather than by
general inefficiency.

| Scenario | Budget |
| --- | --- |
| Background, idle, connected | **< 1% / hour** |
| Background, 24h realistic use | < 4% / day total |
| Foreground, reading | < 4% / hour |
| Foreground, active messaging | < 6% / hour |
| Voice call | < 8% / hour |
| Video call | < 18% / hour |

### 6.1 The mechanisms that decide it

| | |
| --- | --- |
| Socket keepalive | **≥ 60s** interval, aligned to the platform's push channel where possible. A 10s heartbeat is a battery fire |
| Background wake-ups | Push-driven only. **Zero polling timers.** Ever |
| Presence | Server-derived from connection state, so the client never wakes to report "still here" ([09 § 9](./09-notifications-presence.md#9-presence-sync)) |
| Typing broadcast | Throttled to one event per 2s, and it is the only user-driven periodic send |
| Ambient animations | **Paused when the app is backgrounded** and under low-power mode |
| Glass / blur | Disabled under low-power mode — backdrop filters are GPU-expensive |
| Location | **Never requested.** There is no feature that needs it |
| Uploads | Batched into the OS background-transfer session rather than holding a wake lock |
| Reconnect backoff | Exponential with jitter. A tight reconnect loop with no signal drains a battery in an hour |

**Zero polling is an architectural commitment, not an optimisation.** `ChatService` is
push-only by design ([07 § 5.1](./07-offline-sync.md#51-model)); adding a poll anywhere
would be a spec violation, not a performance choice.

---

## 7. Network

### 7.1 Per-operation budget

| Operation | Budget | Notes |
| --- | --- | --- |
| Cold start, cached account | **< 20 KB** | Delta sync only, never a full refetch |
| Cold start, first ever | < 400 KB | Stage 1 + 2 ([07 § 6.1](./07-offline-sync.md#61-staged-loading)) |
| Text message, sent | **< 1 KB** | Including envelope overhead |
| Text message, received | < 1 KB | |
| Idle socket, per hour | **< 3 KB** | 60 keepalives at ~50 bytes |
| Typing event | < 100 bytes | |
| Presence update | < 100 bytes | |
| Conversation open, cached | **0 bytes** | Cache-first. A cached thread makes no request |
| Read receipt | < 200 bytes | Batched — one call for a whole conversation, not per message |
| Image thumbnail | < 15 KB | |
| Image, display tier | < 350 KB | At Standard preset |
| Blur placeholder | **~20 bytes** | Inline in the message payload, zero requests |

### 7.2 Rules

| | |
| --- | --- |
| Total for a typical day | **< 5 MB** excluding media the user chose to load |
| Delta sync only | Reconnect sends last-seen sequence per conversation and receives the delta. **Never a full resync** |
| Batching | Read receipts, presence and typing coalesce over a 500ms window |
| Compression | All JSON payloads gzipped |
| Cache headers | Media is immutable and content-addressed, so it caches forever |
| Retry cost | Exponential backoff with jitter, so a server incident does not become a client-driven DDoS |
| Metered awareness | Auto-download drops to thumbnails ([10 § 9](./10-media-system.md#9-network-awareness)) |

**"Conversation open, cached = 0 bytes" is a real requirement.** Opening a conversation is
the most frequent action in the product; if it costs a request, a day of normal use becomes
hundreds of avoidable round-trips.

---

## 8. Enforcement

Where each budget actually fails something. Without this column, this document is
decoration.

| Budget | Enforced by | Fails |
| --- | --- | --- |
| Bundle size | `size-limit` in CI against `budget.json` | **The build** |
| New dependency | CI diff on `package.json` requires an RFC label | **The PR** |
| Prohibited dependency | Lint rule with an explicit denylist | The build |
| Animated property | Lint rule on transition/animation properties | The build |
| Raw hex colour | Lint rule ([12 § 6](./12-design-governance.md#6-mechanical-enforcement)) | The build |
| Frame rate, scroll | Automated scroll trace on the reference device, nightly | The nightly, and blocks release |
| Cold / warm start | Instrumented on the reference device, per release candidate | Blocks release |
| Interaction latency | Instrumented in the app, reported as p50/p95 ([13 § 2](./13-analytics-telemetry.md#2-what-we-measure)) | Blocks release on regression |
| Memory leak | 20×-navigation test in CI on an emulator | The PR |
| Battery | Manual 24h soak on a release candidate | Blocks release |
| Network per operation | Charles/HAR assertion in integration tests | The PR |
| CLS, web | Lighthouse CI | The PR |

### 8.1 The regression rule

A change that moves any p95 metric **more than 10% in the wrong direction** is a
regression, and it is treated as a bug — not as a trade-off to be accepted because the
feature is nice.

Exceeding a budget requires either a fix or a **recorded, dated exception in the PR
naming who accepted it and when it will be revisited.** Silent budget creep is how every
fast app becomes a slow one, and it never happens in one obvious step.

### 8.2 What is measured in production

Performance telemetry is collected — timings only, never content — under
[13 § 2](./13-analytics-telemetry.md#2-what-we-measure). The reference-device numbers are
the target; production p95 is the truth. When they disagree, production wins and the
reference device is re-examined.

---

## 9. Perceived performance

Real speed is necessary. Perceived speed is what users describe. These techniques are
required, not optional.

| Technique | Applied |
| --- | --- |
| **Optimistic UI** | Sends, reactions, settings, pin/mute all apply locally first |
| **Cache-first render** | Every screen paints from cache, then updates. Never a blank wait |
| **Skeletons that match** | Same shape and varied widths, so the transition is a fill rather than a replacement |
| **Minimum skeleton time** | 400ms, so a fast response does not flash ([08 § 5.1](./08-microinteractions.md#51-loading-by-expected-duration)) |
| **No spinner under 300ms** | A flash of loading state is worse than a brief wait |
| **Blur placeholders** | Media never pops in |
| **Reserved space** | Every image and bubble is sized before content arrives |
| **Immediate tap feedback** | < 50ms, always, even when the action itself is slow |
| **Deterministic splash** | 1400ms fixed, so the slowest path still feels the same as the fastest |

**The 400ms skeleton floor is counter-intuitive and correct.** Holding a skeleton *longer*
when data arrives in 80ms makes the app feel more stable, because a flash reads as a
glitch and a glitch reads as unreliability.

---

*Previous: [10 — Media System](./10-media-system.md) · Next: [12 — Design Governance](./12-design-governance.md)*
