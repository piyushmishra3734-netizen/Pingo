# Apple design research → PINGO

Source-backed corpus. Every entry records: **what Apple specifies → the problem
it solves → the principle underneath → what it implies for PINGO → what not to
copy.** Apple's wording is quoted only in short attributed fragments; the rest is
extraction, not reproduction.

## What this corpus can and cannot be

Two corrections to the original plan, made before any work, so effort does not
go into folders that cannot be filled:

**There is no Apple corpus on "how Messages was designed."**
`developer.apple.com/documentation/messages` is the framework for building
iMessage *app extensions* and stickers — it documents an API surface, not the
design of the Messages UI. Apple has never published Messages' design rationale.
What exists is general and genuinely rich: the HIG, the Liquid Glass technology
overview, and the WWDC design sessions. Messages patterns are therefore read
*through* that general guidance, and where a Messages behaviour has no published
rationale, this corpus says so rather than inventing one.

**Several items on the original list are sections of one document, not sources.**
`regular`/`clear`, refraction, vibrancy, tint, shadow, morphing and adaptive
appearance all live inside Materials and the Liquid Glass overview. They are
covered as rules within `01`, not split into files that would make the corpus
look larger than it is.

## Files

| File | Covers | Status |
| --- | --- | --- |
| `01_materials_and_glass.md` | HIG Materials, Liquid Glass variants, layer rules | done |
| `02_motion.md` | HIG Motion, input-dependent motion, feedback | done |
| `03_navigation_and_layout.md` | tab bars, search, toolbars, sheets, scroll edge | done |
| `04_interaction_patterns.md` | context menus, long press, gestures, presentation | done |
| `05_accessibility.md` | reduce transparency, increase contrast, reduce motion | done |
| `06_design_process.md` | Slack showcase transcript, adopter case studies | done |
| `07_first_run_and_waiting.md` | HIG Onboarding + Loading: setup gating, permissions, placeholders | done |
| `99_pingo_translation.md` | the decisions, and what PINGO refuses | done |

## Prior work this builds on

The [PINGO Material Study](https://claude.ai/code/artifact/8d0e1f78-98e9-445f-abad-2589fff1eee0)
was the first pass, from the WWDC25 sessions alone. It stands, including its two
retractions. Items 1, 2 and 4 of its plan are now built (`thread-fade` in
`app.css`, the accessibility queries in `SettingsContext.tsx`, `glass-press`
across dock/composer/banner/download/notifications). Its item 3 — Ping and
view-once morphing out of their bubble — is the open one.
