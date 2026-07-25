# 12 — Design Governance

How the design system changes, who decides, and what stops a fourth button style from
appearing.

---

## 0. Why this exists

A design system does not decay through bad decisions. It decays through **reasonable
local decisions made without visibility** — a developer needs a slightly different card,
the existing one is 90% right, deadline is Friday, so a new one appears. Repeat twelve
times and the system is a suggestion.

Governance is not bureaucracy. It is the answer to *"where do I put this?"* so that
answering it correctly is faster than working around it.

**The test of this document:** a developer with a new UI need should reach the right
outcome in under five minutes without asking anyone.

---

## 1. The three tiers, and how hard each is to change

Not everything is equally negotiable. Most governance failures come from treating brand
identity and component internals with the same process.

| Tier | Contains | To change |
| --- | --- | --- |
| **1 · Brand identity** | Logo, app icon, wordmark, the six palette colours, the gradient, typeface, the type scale's five sizes | **Brand decision only.** Not an engineering decision. Requires the branding board to change first |
| **2 · Design system** | Semantic tokens, components, motion categories, interaction rules, the specs in `docs/` | **RFC** (§ 3) |
| **3 · Product surface** | Screens, copy, layouts, feature flows | Normal PR review |

### 1.1 Tier 1 is closed

The branding board is the single source of truth
([README](./README.md#security-posture-no-e2ee-before-the-initial-release)). Palette
values, the gradient, the typeface and the five type sizes are **not open to an RFC.** An
engineer who needs a colour the palette does not contain has found a design problem, not a
palette gap.

Adding a *semantic role* that maps to existing palette values is tier 2 and perfectly
normal. Adding a *new hue* is tier 1 and almost certainly wrong.

| Example | Tier | Verdict |
| --- | --- | --- |
| `--color-surface-warning` mapped to existing `away` amber | 2 | RFC, likely approved |
| A new teal for "verified" states | 1 | Rejected — use brand + a glyph |
| A sixth type size at 14px | 1 | Rejected — use weight, not size ([00 § 5](./00-principles.md#5-typography-discipline)) |
| A new `--radius-xs` at 4px | 1 | Rejected — nothing sharper than 8px |
| A spring easing for a playful screen | 2 | Rejected by spec — no springs exist ([00 § 2](./00-principles.md#2-motion-language-water-glass-air)) |

---

## 2. The decision tree

Before writing any UI, in order. Stop at the first yes.

```
I need a UI element.
│
├─ 1. Does a component already do this?
│     → Use it. Check packages/ui and docs/05.
│
├─ 2. Does one do it with a different prop value?
│     → Use it. Sizes, variants and tones already exist.
│
├─ 3. Can a new PROP on an existing component do it,
│     without changing its default behaviour?
│     → Add the prop. Normal PR. No RFC.
│
├─ 4. Is it a composition of existing components,
│     used on one screen only?
│     → Build it in the feature folder, NOT in packages/ui.
│       Not part of the design system. No RFC.
│
├─ 5. Is it a composition used on 3+ screens?
│     → RFC to promote it into packages/ui.
│
└─ 6. Is it genuinely new — a new interaction pattern?
      → RFC before any code.
```

### 2.1 The rule of three

**A component enters `packages/ui` when it has three real call sites, not before.**

Building a "reusable" component for one screen is how you get an API shaped by a single
use case, which then fights the second and third. Build it locally, let it be used twice
more, *then* generalise with three real examples in hand.

Corollary: duplicating a composition **twice** is fine and often correct. The third time
is the signal.

### 2.2 Where things live

| Location | Contains | Bar |
| --- | --- | --- |
| `packages/tokens` | Tier 1 + semantic roles | Brand for tier 1, RFC for roles |
| `packages/ui` | Components with 3+ call sites | RFC |
| `packages/core` | Domain, service boundary, product rules | Normal PR + architecture review |
| `apps/web/src/features/*` | Composite UI for one feature | **Normal PR.** This is the default home for new UI |
| `apps/web/src/components/*` | Cross-screen web-only pieces | Normal PR |
| `apps/web/src/screens/*` | Routes | Normal PR |

**`features/` is the default.** Most new UI belongs there and needs no ceremony. The RFC
path exists for the small fraction that becomes shared vocabulary — which is exactly why it
can afford to be rigorous.

---

## 3. The RFC process

### 3.1 Flow

```
Need identified
    ↓
Decision tree says RFC (§ 2)
    ↓
Write RFC  →  docs/rfcs/NNN-short-name.md
    ↓
Review  (design + engineering, 3 working days)
    ↓
┌─────────┬──────────┬──────────┐
│ Approve │ Revise   │ Reject   │
└────┬────┴────┬─────┴────┬─────┘
     │         └→ resubmit │
     ↓                     ↓
 Implement            Recorded with
     ↓                the reason why
 Add to docs/05
     ↓
 Status: experimental → stable
```

### 3.2 Timeboxes

| | |
| --- | --- |
| Review window | **3 working days.** Silence past that is **approval**, not a veto |
| Fast track | Accessibility fixes, bug fixes, and any change that only *removes* API surface — approved on normal review |
| Emergency | A production incident may bypass this. The RFC is written **within a week**, retroactively, and may result in the fix being redone |

**Silence is approval.** A process that stalls on an unresponsive reviewer gets bypassed,
and a bypassed process governs nothing.

### 3.3 RFC template

```markdown
# RFC NNN — <name>

**Status:** proposed | approved | rejected | superseded
**Author:** · **Date:** · **Tier:** 1 | 2

## Problem
What can't be built today. One paragraph. A real screen, not a hypothetical.

## Why existing components don't work
Walk the decision tree (§ 2) and show where it stopped. If this section is
thin, the RFC is probably unnecessary.

## Call sites
The three real places this will be used. Link the screens or specs.
Fewer than three → build it in features/ instead.

## Proposal
Anatomy · props · states · variants.

## Design system compliance
- Tokens used (no new tier-1 values)
- Motion category: water | glass | air
- Density budget impact (00 § 4)
- The calm test (00 § 6) — six answers
- Accessibility (06): announcement, targets, keyboard, dynamic type at 200%
- Motion & haptics (08): exact treatment
- Performance (11): bundle cost in KB gzip

## Alternatives considered
Including "do nothing" and why it loses.

## Migration
Does this replace something? What is deprecated, and on what timeline?
```

### 3.4 Reviewers

| Change | Reviewers |
| --- | --- |
| Tier 1 | Brand owner. Engineering does not decide this |
| New component | Design + engineering, both required |
| New token role | Design + engineering |
| Motion or interaction rule | Design |
| Spec change in `docs/` | Whoever owns that document |
| Accessibility change | Fast-tracked. **Never blocked on aesthetics** |

**Accessibility changes are never blocked on aesthetics.** If a fix makes something less
pretty, the fix ships and the aesthetics get solved afterwards.

---

## 4. Dependencies are a design decision

A dependency brings its own design opinions, and those opinions will leak.

| Dependency type | Process |
| --- | --- |
| **UI component library** | **Prohibited.** We have a design system; a second one is a conflict, not a shortcut |
| CSS framework beyond Tailwind | Prohibited |
| Icon library / icon font | Prohibited. Icons are inline SVG in `@pingo/ui` |
| CSS-in-JS runtime | Prohibited — a runtime style cost we do not need |
| Animation library | RFC required, and must justify why tokens + CSS are insufficient |
| Utility (date, validation, etc.) | RFC with gzip cost stated |
| Anything > 20 KB gzip | RFC regardless of category |

Every dependency RFC states: **gzip cost, what it replaces, its maintenance status, and
what removing it later would cost.** Budget in
[11 § 4.2](./11-performance-budget.md#42-budget-rules).

**Reasoning:** a component library is the single fastest way to destroy a design system.
It arrives with its own radii, its own motion, its own spacing rhythm, and within a
release the product has two visual languages that almost match — which is worse than
either one alone.

---

## 5. Component lifecycle

| Status | Meaning | Rules |
| --- | --- | --- |
| **Proposed** | RFC open | Not in `packages/ui` |
| **Experimental** | Merged, API may change | Marked in docs. Usable, but a breaking change needs no deprecation cycle |
| **Stable** | 3+ call sites, API settled | Breaking changes need an RFC and a deprecation cycle |
| **Deprecated** | Replacement exists | Lint **warning**. Docs name the replacement and the removal date |
| **Removed** | Gone | Lint **error** if referenced |

### 5.1 Deprecation policy

| | |
| --- | --- |
| Minimum notice | **One release cycle**, and never less than 30 days |
| Requirement | A deprecation must name its replacement. *"Don't use this"* with no alternative is not a deprecation, it is an obstruction |
| Migration | If mechanical, ship a codemod. If not, list every call site in the deprecation note |
| Enforcement | Warning while deprecated, error once removed |
| Removal | Only after every call site is migrated. **We do not break the app to tidy a package** |

### 5.2 Promotion to stable

Requires: 3+ call sites, complete docs entry in
[05](./05-components-responsive.md), accessibility verified against
[06 § 9](./06-accessibility.md#9-testing-requirements), motion assigned per
[08](./08-microinteractions.md), and no open API questions.

---

## 6. Mechanical enforcement

**Governance that relies on reviewers noticing does not work.** Every rule below is
machine-checked, so the common violations fail before a human looks.

### 6.1 Lint rules

| Rule | Level | Catches |
| --- | --- | --- |
| No raw hex / `rgb()` / `hsl()` outside `packages/tokens` | **error** | The most common drift |
| No arbitrary Tailwind colour values (`bg-[#...]`) | **error** | The workaround for the rule above |
| No arbitrary font sizes (`text-[14px]`) | **error** | Type scale drift |
| No arbitrary radii below 8px | **error** | "Nothing sharper than 8px" |
| No `cubic-bezier` with a negative control point | **error** | Springs and overshoot |
| No `transition`/`animation` on non-composited properties | **error** | Frame-rate regressions |
| No `!important` outside a documented reset | error | |
| No inline `style` except for genuinely dynamic values | **warn** | Style escaping the system |
| No `tabindex` > 0 | **error** | Broken focus order |
| Interactive element without an accessible name | **error** | |
| Touch target below 44×44 in a component | **warn** | Needs layout context to judge |
| Import from a deprecated component | **warn** → **error** on removal | |
| Cross-package import that inverts layering | **error** | `ui` must never import `core` |
| Direct import of a concrete `ChatService` outside the provider | **error** | Protects the E2EE seam ([01 § 10](./01-onboarding-auth.md#20-keeping-the-e2ee-upgrade-path-open)) |
| New dependency without an RFC label | **error** in CI | |
| Bundle over budget | **error** in CI | [11 § 8](./11-performance-budget.md#8-enforcement) |

### 6.2 The escape hatch

Every rule can be suppressed **with a reason**:

```tsx
// pingo-lint-disable-next-line no-raw-color -- one-off brand asset gradient,
// see RFC 014. Revisit when the illustration system lands.
```

| | |
| --- | --- |
| Reason | **Required.** A bare disable comment fails lint |
| Audit | Suppressions are counted per PR and reported. A rising count is a signal the rule is wrong or the system has a gap |
| Review | Quarterly. Each suppression is either fixed, or the rule is amended |

**A rule suppressed thirty times is a bad rule, not thirty bad developers.** The audit
exists to catch that, and amending the rule is a legitimate outcome.

---

## 7. Design review

For product surfaces (tier 3), which need no RFC but do need a check.

### 7.1 The gate

Every screen PR answers the six questions of
[the calm test](./00-principles.md#6-the-calm-test) in its description. Not a link — the
six answers, written out. Any "no" blocks merge.

### 7.2 Reviewer checklist

| | |
| --- | --- |
| One primary action? | [00 § 1](./00-principles.md#1-the-five-laws) |
| Tokens only, no raw values? | Lint covers most of it |
| ≤ 3 distinct vertical gaps? | [00 § 3](./00-principles.md#3-spacing-rhythm) |
| Within the density budget? | [00 § 4](./00-principles.md#4-density-budget) |
| Motion assigned a category? | [08](./08-microinteractions.md) |
| Empty, loading, offline and error states designed? | [00 Law 4](./00-principles.md#1-the-five-laws) |
| Screen reader: primary task with the display off? | [06 § 9](./06-accessibility.md#9-testing-requirements) |
| 360px and 200% type? | [06 § 2.2](./06-accessibility.md#22-what-must-survive-200) |
| Reduced motion: nothing confusing? | [06 § 3.2](./06-accessibility.md#32-the-critical-rule) |
| Copy: no E2EE implication? | [01 Copy integrity](./01-onboarding-auth.md#-copy-integrity--non-negotiable) |
| Telemetry: allowlisted events only? | [13 § 4](./13-analytics-telemetry.md#4-the-allowlist) |

---

## 8. Keeping specs and code honest

Documentation that drifts from the code is worse than none, because people trust it.

| Rule | |
| --- | --- |
| **Spec changes ship with the code** | A behaviour change and its doc update are the same PR. Never a follow-up |
| **Code is truth for values** | Where a doc and a token disagree, the token wins and the doc is a bug |
| **Docs are truth for behaviour** | Where code and a spec disagree on behaviour, the code is a bug |
| **Components marked ✅** | [05](./05-components-responsive.md) marks what exists. Building a specified component updates the mark in the same PR |
| **Deliberate divergence is recorded** | Where the code intentionally differs, `docs/README.md` says so — as it currently does for the pre-blueprint screens |
| **Quarterly audit** | Walk `packages/ui` against [05](./05-components-responsive.md). Undocumented components are either documented or deleted |

---

## 9. What needs no permission

Explicitly listed, so governance never becomes a reason not to improve things.

- Fixing a bug
- Fixing an accessibility defect
- Improving copy
- Adding a test
- Adding a prop that does not change existing behaviour
- Building composite UI in `features/`
- Improving performance without changing an API
- Adding a documented lint-rule suppression with a reason
- Deleting dead code
- Refining a comment or a doc for clarity

**If the change makes the product more correct, more accessible, or more honest, ship it.**
Governance exists to protect coherence, not to slow down improvement.

---

*Previous: [11 — Performance Budget](./11-performance-budget.md) · Next: [13 — Analytics & Telemetry](./13-analytics-telemetry.md)*
