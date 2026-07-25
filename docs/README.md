# PINGO — Product & UX Blueprint

**Phase 1 — specification. No implementation.**

This is the design specification for PINGO. It is written to be *read before code is
written*, and to be the thing a reviewer points at when something doesn't feel right.

The [branding board](../README.md#design-system) is the single source of truth for
logo, icon, colour, typography and spacing. Nothing in these documents redesigns it.
The tokens in `packages/tokens` are that board translated to data; where this
blueprint names a value, it names the token.

---

## Documents

| # | Document | Covers |
| --- | --- | --- |
| 00 | [Principles & Motion Language](./00-principles.md) | The five laws, water/glass/air motion, spacing rhythm, density budget, the calm test, what PINGO deliberately lacks |
| 01 | [Onboarding & Authentication](./01-onboarding-auth.md) | Security model, Splash, Welcome, Login, three-way recovery, Emergency Password, Contact Support, ten-step registration, sessions, the E2EE upgrade path |
| 02 | [Messaging](./02-messaging.md) | Home, conversation list, empty states, chat thread, bubbles, the full composer |
| 03 | [Profile, Communities, Calls](./03-social-and-calls.md) | Profile with gallery/posts/moments/friends, communities and channels, voice/video/group calls, notifications, universal search |
| 04 | [Settings](./04-settings.md) | All thirteen sections, every setting with state, interaction and animation |
| 05 | [Components & Responsive](./05-components-responsive.md) | 24 components with anatomy/states/motion/rules; phone, tablet and desktop layout |
| 06 | [Accessibility & Inclusive Design](./06-accessibility.md) | Screen readers, dynamic type, reduced motion, contrast, targets, keyboard, cognitive and situational access |
| 07 | [Offline & Sync](./07-offline-sync.md) | Connection states, send queue, upload retry, conflict resolution, multi-device sync, first sync |
| 08 | [Microinteractions & Haptics](./08-microinteractions.md) | Per-interaction motion table, haptic vocabulary, optional sound, loading/success/error feedback |
| 09 | [Notifications & Presence](./09-notifications-presence.md) | All presence, activity, delivery and connection states; typing anti-flicker; receipts; privacy and reciprocity; push categories; quiet hours; badges; presence sync |
| 10 | [Media System](./10-media-system.md) | Upload and download pipelines, images, video, voice notes, documents, gallery, camera, compression by network, cache, viewer, future-ready constraints |

Documents 06–10 are **part of the design system, not appendices.** Every screen built
from 01–05 must also satisfy them.

---

## How to read this

**If you are about to design a screen** — start with
[00 § 6, the calm test](./00-principles.md#6-the-calm-test). Six questions; any "no"
is a blocker.

**If you are about to build a screen** — find it in 01–04 for behaviour, 05 for its
components, then check it against 06–10. Components marked ✅ already exist in
`packages/ui`.

**If you are building anything with state indicators** — 09 is the authority. It splits
the twenty "presence states" into four families with different scopes, owners and privacy
rules, because treating them as one flat set is what makes presence systems leak.

**If you are reviewing** — the "Rules" and "Fails review" lines are the checklist.
They are written as things that can *fail*, because a principle that cannot fail a
design is decoration.

---

## Security posture: no E2EE before the initial release

**PINGO does not use end-to-end encryption in Phase 1, Phase 2, or the initial public
release.** Messages use TLS in transit and an authenticated backend with encryption at
rest. Full detail in
[01 § Security model](./01-onboarding-auth.md#security-model-for-phase-1--initial-release).

Three things follow.

1. **Password reset loses nothing, so nothing is disclosed.** The server holds the
   messages. Reset, sign in, and the history is there. There are no Recovery Keys, no
   key-backup step, no message-loss warnings, and no disclosure screen anywhere in the
   product — inventing a risk that does not exist trains users to ignore real warnings.

2. **The account is now the entire security perimeter.** Under E2EE, a takeover on a
   new device yielded an *empty* account. Without it, a takeover yields the complete
   history server-side. So account recovery stops being a convenience feature and
   becomes the primary control protecting message content — which is why the 72-hour
   hold and one-tap veto on Contact Support recovery are not negotiable for support
   throughput.

3. **No surface may imply encryption we do not have.** No "end-to-end", no per-chat
   padlock, no "not even we can read this", no safety numbers or contact verification.
   Instead, Settings → Security carries a
   [Security overview](./04-settings.md#security-overview--the-page-content) that states
   plainly what is true — including the one uncomfortable line, because a security page
   listing only reassurances is marketing.

**The upgrade path stays open by design.** The product and architectural seams that keep
adding E2EE a backend project rather than a redesign are listed in
[01 § 10](./01-onboarding-auth.md#10-keeping-the-e2ee-upgrade-path-open) — including a
list of server-side features to *avoid building*, because each would become a feature
regression the day E2EE ships.

---

## Status of the codebase against this blueprint

**Built** (see the root [README](../README.md)) — design tokens, 12 components, mock
data layer, and first-pass screens for Splash, Onboarding, Chats, Profile, Settings,
Calls, Communities, plus the floating dock. Responsive from 360px to two-pane desktop.

**Specified here, not yet built** — the full auth and registration flow, Dialog,
BottomSheet, ContextMenu, Dropdown, Tooltip, Snackbar, SegmentedControl, Progress,
the navigation rail, the complete settings tree, Posts/Moments/Friends, community
channels, and all call surfaces.

The existing screens were built before this blueprint and **will not fully match it**
— notably the settings tree is a subset, and the onboarding is three panels rather
than the ten-step flow. Reconciling them is Phase 2 work, not a defect to file.

### Already satisfied from 06–08

The token layer and existing components were built with these concerns in mind, so
some requirements are already met:

| Requirement | Where |
| --- | --- |
| `prefers-reduced-motion` stops all loops, collapses transitions | `tokens.css` |
| `:focus-visible` only, never on pointer | `focus-ring` utility |
| No spring or bounce easing exists | `motion.ts` — only three curves, all monotonic |
| Only `transform`/`opacity` animated | All keyframes in `tokens.css` |
| Icon-only buttons require a label | `IconButton` type signature |
| Rows are buttons only when actionable | `ListRow` |
| Filter chips are a real `radiogroup` | `Chip` / `ChipGroup` |
| Voice notes are keyboard-operable sliders | `VoiceNote` |
| Skeletons pulse, never shimmer | `Skeleton` |
| The monogram is the only indeterminate indicator | `PingoMarkState` |
| Connection state already modelled | `ChatService.connectionState()` |
| Delivery states already distinguish `sending`/`sent`/`delivered`/`read`/`failed` | `types.ts` |

**Not yet satisfied, and needed early in Phase 2:** the `queued` message state and its
clock glyph ([07 § 2.2](./07-offline-sync.md#22-state-machine)), the connection strip,
dynamic-type scaling of the root, the haptics layer, and the audited dark theme.
