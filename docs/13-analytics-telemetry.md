# 13 — Analytics & Telemetry Policy

What PINGO measures, what it will never measure, and the mechanisms that make the second
list true rather than aspirational.

---

## 0. The commitment

> **We measure whether the app works. We never measure what you say.**

Concretely:

| We measure | We never collect |
| --- | --- |
| Crashes and errors | **Message content** — text, ever, in any form |
| Performance timings | **Photos, videos, voice notes, files** — or anything derived from them |
| Whether a feature was used | **Who you talk to** — no social graph, no contact lists |
| Delivery success rates | **Search queries** |
| Device and OS class | **Draft text**, even unsent |
| Connection quality | **Names, handles, bios, phone numbers** in any event |
| — | **Precise location.** No feature needs it, so it is never requested |
| — | **Third-party identifiers** — no ad IDs, no fingerprinting |

### 0.1 Why this document is strict about the mechanism

The two lists above are easy to write and easy to violate by accident. Almost nobody sets
out to log message content — it arrives through an exception message that happens to
contain a variable, or through a "feature usage" event that includes a conversation ID and
thereby reconstructs a social graph.

So the substance of this document is § 3–§ 5: **an allowlist, a schema registry, and
scrubbing.** Those are what make the commitment real. Everything else is intent.

### 0.2 It also protects the E2EE upgrade

[01 § 10](./01-onboarding-auth.md#10-keeping-the-e2ee-upgrade-path-open) records: *no
message content in analytics or logs — non-negotiable now, and impossible to retrofit once
the habit exists.* If content ever reaches a log, adding E2EE later means auditing and
unpicking every pipeline that touched it. Never starting is the only cheap path.

---

## 1. The three streams

Separate on purpose, because they have different consent models, retention and risk.

| Stream | Contains | Consent | Retention |
| --- | --- | --- | --- |
| **Stability** | Crashes, unhandled errors, ANRs | **On by default**, opt-out | 90 days |
| **Performance** | Timings, frame rates, network success | **On by default**, opt-out | 90 days |
| **Product** | Feature usage, flow completion | **Off by default, opt-in** | 180 days |

### 1.1 Why the split

**Stability and performance default on, and this is defensible.** They contain no content,
no identity and no social information. Without them we ship an app that crashes for a
subset of users and cannot find out — which harms those users far more than an anonymous
stack trace does. Opting out is one tap.

**Product analytics defaults off.** Knowing which features people use is useful to *us*;
it is not necessary for the app to work. For a product whose entire claim is privacy, "we
watch how you use it unless you object" is the wrong default. Users who want to help can
turn it on, and the setting says plainly what it gives us.

This asymmetry is the whole position: **we collect what keeps the app working by default,
and what helps us plan only by invitation.**

---

## 2. What we measure

### 2.1 Stability

| Field | Example | Notes |
| --- | --- | --- |
| Exception type | `TypeError` | |
| **Scrubbed** stack trace | `at ConversationRow (ConversationRow.tsx:84)` | See § 5 |
| App version / build | `0.1.0 (12)` | |
| OS and version | `Android 14` | |
| Device class | `mid-range` | **Not** the exact model — that narrows an anonymity set |
| Locale | `en-IN` | Language and region only |
| Free memory / storage bucket | `low` \| `normal` | Bucketed, never exact |
| Screen the crash occurred on | `route: /chats/:id` | **The route pattern, never the resolved path** |
| Breadcrumbs | `navigate → open_composer → send` | Event **names** only, from the allowlist |

`route: /chats/:id` and not `/chats/c-anaya` is the difference between a useful diagnostic
and a record of who someone messaged.

### 2.2 Performance

Timings only. Targets in [11](./11-performance-budget.md); production p95 is the truth.

| Metric | Notes |
| --- | --- |
| Cold / warm / hot start duration | |
| Time to interactive | |
| Chat open duration | Bucketed by cached / uncached, not by conversation |
| Send → local echo | The [11 § 2](./11-performance-budget.md#2-interaction-latency) critical metric |
| Send → acknowledged | |
| Frame drops per interaction | Interaction **type**, not target |
| Memory peak bucket | |
| Network success rate, retries | By operation type |
| Sync duration and item **count** | Counts, never content |
| Media upload/download success rate | By type and size bucket, never filename |
| Battery drain bucket | Foreground / background |

### 2.3 Product *(opt-in only)*

| Event | Carries |
| --- | --- |
| Feature opened | Feature name from the allowlist |
| Flow completed / abandoned | Flow name + the step reached |
| Setting changed | Setting **key** and whether it moved on/off. **Never** the value of a free-text setting |
| Message sent | A **counter increment only** — no id, no recipient, no length, no content |
| Attachment sent | Type only: `image` \| `video` \| `audio` \| `file` |
| Call started | `voice` \| `video`, and duration bucket |
| Search performed | A counter and the result-type distribution. **Never the query** |
| Empty state seen | Which one — a genuine signal about onboarding |
| Error surfaced to user | Error class from the allowlist |

**"Message sent" is a counter, not an event with properties.** The moment it carries a
conversation ID, aggregating a week of events reconstructs who talks to whom and how often
— a social graph assembled from data that individually looked harmless. This is the most
common way privacy-respecting analytics stops being privacy-respecting.

---

## 3. What we never collect

Absolute. No feature, experiment, debugging session or support escalation may override
these.

| Never | Including |
| --- | --- |
| **Message content** | Text, length, word count, language detection, sentiment, hashes, embeddings, or any derived signal |
| **Media** | Files, thumbnails, dimensions tied to a message, filenames, EXIF, perceptual hashes |
| **Voice** | Audio, waveforms, transcripts, duration tied to a message |
| **Social graph** | Contact lists, conversation IDs, recipient IDs, participant counts per conversation, message counts per contact |
| **Search** | Query strings, results, or the fact that a specific term was searched |
| **Identity in events** | Names, handles, bios, phone numbers, email, avatar URLs |
| **Drafts** | Including unsent text at crash time |
| **Precise location** | GPS, Wi-Fi SSIDs, cell IDs, or IP-derived geolocation beyond country |
| **Device fingerprint** | Exact model, advertising ID, IDFA/GAID, MAC, canvas or font fingerprinting |
| **Cross-app** | Installed apps, browsing history, clipboard |
| **Keystrokes** | Timing patterns included — they are biometric |
| **Screen recordings** | Session replay of any kind, heatmaps, scroll-depth-with-content |

### 3.1 Session replay is prohibited outright

It is worth naming separately because it is a popular product-analytics tool and it is
categorically incompatible with a messaging app. Any tool that reconstructs a user's
screen has, by definition, captured their messages. Masking rules are a mitigation that
fails open — one unmasked node leaks a conversation.

---

## 4. The allowlist

**The mechanism that makes § 3 enforceable.**

### 4.1 Principle

An event may be sent **only if it is registered in the schema registry.** Not "anything not
on the banned list" — that is a blocklist, and blocklists fail on everything nobody thought
of.

```
packages/core/src/telemetry/registry.ts   ← the single source of truth
```

Every event declares its name and the exact shape of its properties. The telemetry client
accepts **nothing** else: an unregistered event is dropped at runtime and fails at compile
time.

### 4.2 Property type rules

Enforced by the registry's types.

| Allowed | Prohibited |
| --- | --- |
| Enum from a fixed set | **Any free-text string** |
| Boolean | Any user-supplied value |
| Bucketed number (`small` \| `medium` \| `large`) | Raw IDs of any kind |
| Duration in ms, rounded to 10ms | Timestamps precise enough to correlate with a message |
| Count, capped and bucketed above 100 | Unbounded counts |
| Route **pattern** | Resolved paths |

**No event property may be a free-text string.** This one rule closes the majority of
accidental leaks — an enum cannot contain a message, and a bucket cannot contain a name.

### 4.3 Adding an event

An RFC-lite in the PR, answering four questions:

1. What decision will this event inform? *(If none, it is not collected.)*
2. Which stream — stability, performance, or product?
3. Could it, combined with other events, identify a person or a relationship?
4. What is the coarsest form that still answers question 1?

Question 4 is the important one. **Coarsen until it barely answers the question, then
collect that.** Reviewed by whoever owns this document plus one engineer.

Question 3 is the correlation check, and it is where most proposals get coarsened: events
are rarely dangerous alone.

---

## 5. Crash-report scrubbing

The highest-risk path in the whole system, because crash reporters are designed to capture
context and context is where content lives.

| Vector | Mitigation |
| --- | --- |
| **Exception messages** | Truncated to the type and a registered code. Free-text messages are **dropped, not sent** — `Error("Failed to send: " + body)` is a content leak |
| **Local variables** | Variable capture **disabled entirely** in the crash SDK |
| Stack frames | Function and file names only. No arguments |
| Breadcrumbs | Allowlisted event **names** only. No properties, no route params |
| Route in the trace | Pattern only — `/chats/:id` |
| Network breadcrumbs | Method, host, status, duration. **No request or response bodies, no query strings** |
| Console logs | **Never** attached to crash reports |
| Screenshots | **Never** attached |
| Device logs | Never uploaded |
| User-submitted reports | The description is user-written and intentional. Attachments are **itemised and shown before sending**, and are opt-in per item ([04 § 11](./04-settings.md#11-help)) |

### 5.1 Log discipline in the product

| Rule | |
| --- | --- |
| Never log a `Message.body` | Lint rule ([12 § 6.1](./12-design-governance.md#61-lint-rules)) |
| Never interpolate user content into an error | `Error(\`Failed: ${body}\`)` is a defect, not a debug convenience |
| Never log attachment filenames | |
| Production logs | Redacted by default; a field must be explicitly marked safe to appear |
| Local dev | May log content **locally only**. Verbose logging is stripped from release builds at build time, not at runtime |

**Verbose logging is removed at build time.** A runtime flag can be flipped, forgotten, or
defaulted wrong in one release.

---

## 6. Identifiers & retention

### 6.1 Identifiers

| Identifier | Used for | Properties |
| --- | --- | --- |
| **Install ID** | Deduplicating crashes and sessions | Random per install. **Not** the user ID. Rotates on reinstall, and manually resettable in Settings |
| Session ID | Grouping events in one session | Random, in-memory, discarded on app exit |
| User ID | **Never sent in telemetry** | — |
| Phone number | **Never sent in telemetry** | — |

**Telemetry is never joinable to an account.** The install ID cannot be mapped to a user
server-side, which means a subpoena for "this user's analytics" has nothing to return —
and that is a design goal, not a side effect.

### 6.2 Retention

| Data | Retention | Then |
| --- | --- | --- |
| Crash reports | 90 days | Deleted |
| Performance events | 90 days raw | Aggregated to daily percentiles, raw deleted |
| Product events | 180 days | Deleted |
| Aggregates (no identifiers) | Indefinite | Cannot identify anyone |
| Support cases | 1 year after closure | Deleted |
| IP addresses | **Not stored.** Country derived at ingest, IP discarded | — |

Retention is enforced by **automated deletion jobs, not policy.** A retention period
nobody enforces is a retention period of forever.

---

## 7. Third parties

| Rule | |
| --- | --- |
| **No third-party analytics SDK** | Onboarding promises "no third-party trackers" ([01 § 7 step 9](./01-onboarding-auth.md#step-9--notifications)). An SDK would break it |
| **No advertising SDKs** | Ever. There are no ads |
| **No attribution or install-referrer SDKs** | |
| Crash reporting | **Self-hosted** (Sentry self-managed or equivalent). If a hosted service is ever used, it is a data processor under contract, named in the Privacy Policy, with variable capture off |
| Push delivery | APNs and FCM are unavoidable transport. **Payloads carry no message content** — the client fetches the message after being woken ([09 § 5](./09-notifications-presence.md#5-push-notifications)) |
| Data residency | Telemetry stays in the primary region. Never replicated to an analytics vendor |
| New third party touching user data | **RFC + Privacy Policy update, before integration** |

### 7.1 The push payload note matters

A push payload containing message text means the message passes through Apple's or
Google's infrastructure in the clear. PINGO's payloads carry an identifier and a count;
the client wakes and fetches the content over TLS. Slightly more work, and it keeps the
notification path consistent with everything else here.

---

## 8. User controls

In Settings → Privacy → **Analytics & Diagnostics**, per [04 § 8](./04-settings.md#8-privacy).

| Setting | Description | State |
| --- | --- | --- |
| Crash reports | *Send anonymous crash reports so we can fix problems.* | `Toggle(on)` |
| Performance data | *Send anonymous timing data so we can keep PINGO fast.* | `Toggle(on)` |
| Product analytics | *Share which features you use. Off by default — turn it on to help us prioritise.* | `Toggle(off)` |
| What we collect | Opens a plain-language page listing every registered event | `Action` |
| Reset install ID | *Start a new anonymous ID. Old data can't be linked to the new one.* | `Action` |
| Download my telemetry | Everything associated with this install ID | `Action` |
| Delete my telemetry | Deletes it, and stops collection | `Action` danger |

### 8.1 "What we collect" is generated, not written

That page is **generated from the schema registry** (§ 4.1), so it cannot drift from
reality. A hand-written list is accurate on the day it is written and wrong within a month.

This is the single highest-trust element in this document: the user can read the actual
allowlist, and adding an event necessarily updates what they see.

---

## 9. Enforcement

| Rule | Mechanism | Fails |
| --- | --- | --- |
| Only registered events | Types + runtime drop | **Compile**, then runtime |
| No free-text properties | Registry types | Compile |
| No message content in logs | Lint rule | Build |
| No user content interpolated into errors | Lint rule | Build |
| No third-party analytics SDK | Dependency denylist | Build |
| No variable capture in crash SDK | Config, asserted in a test | Test |
| Verbose logging stripped in release | Build config, asserted in a smoke test | Release |
| Retention | Automated deletion jobs, monitored | Alert |
| "What we collect" page current | Generated from the registry | N/A — cannot drift |
| New event reviewed | PR label + owner review | PR |

### 9.1 Quarterly audit

1. Every registered event still answers a real question — unused events are **deleted**,
   not kept in case.
2. Sample 100 real crash reports and grep for anything resembling content.
3. Verify retention jobs actually ran.
4. Re-run the § 4.3 correlation check across the **current** event set. An event that was
   safe alone may not be safe alongside three added since.
5. Confirm the Privacy Policy matches the registry.

Step 4 is the one that catches drift. Privacy erosion in analytics is almost never a single
bad event; it is an accumulation of individually reasonable ones.

---

## 10. What we give up, stated plainly

An honest accounting, so nobody is surprised later and proposes "just a little more."

| We cannot | Consequence |
| --- | --- |
| Build funnels through message-sending behaviour | Onboarding is optimised from flow-completion events and research, not from message data |
| Know which conversations are most active | We cannot rank or recommend — which we do not do anyway ([00 § 7](./00-principles.md#7-what-pingo-deliberately-does-not-have)) |
| A/B test on engagement metrics | We test on task completion and error rates instead |
| Debug a specific user's issue from telemetry | Support relies on the user's own description and opt-in diagnostics |
| Measure retention per cohort with precision | Aggregate, coarse retention only |
| Do content moderation proactively at scale | Reactive, on user reports. A real trade-off, and the honest one for this architecture |

**The last row is the genuine cost**, and it should be acknowledged rather than glossed.
Reactive moderation is slower than proactive scanning. It is also the only option
consistent with not reading messages — and it is where the product will end up anyway once
E2EE ships, so building the reactive path now is the right order.

---

*Previous: [12 — Design Governance](./12-design-governance.md) · Back to [index](./README.md)*
