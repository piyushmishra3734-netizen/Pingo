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
| 01 | [Onboarding & Authentication](./01-onboarding-auth.md) | Splash, Welcome, Login, three-way recovery, Emergency Password, Contact Owner, ten-step registration, sessions |
| 02 | [Messaging](./02-messaging.md) | Home, conversation list, empty states, chat thread, bubbles, the full composer |
| 03 | [Profile, Communities, Calls](./03-social-and-calls.md) | Profile with gallery/posts/moments/friends, communities and channels, voice/video/group calls, notifications, universal search |
| 04 | [Settings](./04-settings.md) | All thirteen sections, every setting with state, interaction and animation |
| 05 | [Components & Responsive](./05-components-responsive.md) | 24 components with anatomy/states/motion/rules; phone, tablet and desktop layout |

---

## How to read this

**If you are about to design a screen** — start with
[00 § 6, the calm test](./00-principles.md#6-the-calm-test). Six questions; any "no"
is a blocker.

**If you are about to build a screen** — find it in 01–04 for behaviour, then 05 for
the components it needs. Components marked ✅ already exist in `packages/ui`.

**If you are reviewing** — the "Rules" and "Fails review" lines are the checklist.
They are written as things that can *fail*, because a principle that cannot fail a
design is decoration.

---

## Three decisions that shape everything downstream

These came out of specifying the auth model, and they are consequences rather than
preferences. Full reasoning in
[01 — Read first](./01-onboarding-auth.md#-read-first-three-consequences-of-the-chosen-auth-model).

1. **A password reset cannot recover message history.** Under end-to-end encryption
   the server has no keys, so resetting a password restores the *account*, not the
   *messages*. This is correct behaviour for a privacy-first product, but it must be
   disclosed before the reset completes — hence the Recovery Key step in registration
   and the mandatory disclosure screen in recovery.

2. **The Emergency Password is a generated code, not a typed password.** The offline
   recovery goal is right, and refusing SMS OTP as the primary path is right — SIM-swap
   is a real attack. But a second user-chosen static secret tends to be weak or
   identical to the first, doubling the attack surface for nothing. A generated code
   keeps the intent and removes the failure mode. A "set my own" escape hatch exists,
   with strength enforcement.

3. **"Contact Owner" recovery is gated by a 72-hour hold, not by an operator's
   judgement.** Human-mediated recovery is the most exploited path in account
   security. The hold — during which any signed-in session can veto with one tap — is
   the control. It cannot be expedited, because an operator who can waive the delay is
   an operator an attacker can persuade.

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
