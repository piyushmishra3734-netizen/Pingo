# 01 · First run — experience audit

Audited: Splash → Intro → Welcome → sign-up / log-in (email, phone, username,
Google) → setup (name, username, photo, permissions) → `/chats`.
Read-only audit; nothing changed.

**Summary.** The funnel is unusually well documented and mostly well built —
no enumeration oracle, generic password failures, reduced-motion handling,
progress-as-fraction, all cited to source and actually implemented. The five real
gaps are small and concrete: two async actions drop the app's own spinner
convention on the most common sign-up path; the Google interstitial's Cancel
always lands on sign-up regardless of where you came from; the intro carousel
renders remote art without verifying it, unlike Splash which solves that exact
problem one file over; setup, password and Google screens hardcode English past
the app's own two-voice catalog even where the keys already exist; and the two
method-choice screens are the only place in the funnel with no visible Back.

---

## Splash — `/`

Always has pixels from mount (`SplashScreen.tsx:60-62`, cache then bundled
fallback). IndexedDB checked in parallel (`:193-198`), and live art only swaps in
after `preloadImage` confirms it decodes (`:82-90`) — it never trusts a URL it has
not verified. `HARD_MAX_MS = 7000` (`:38, 168-170`) means a dead network cannot
trap anyone. `onError` just marks painted and moves on (`:246`).

**Nothing missing. This is the strongest screen in the area** — its
verify-before-swap pattern is the one Intro should reuse (fix 3).

## Intro — `/intro`

Five full-bleed images, swipeable, not skippable for first-time users (`:34`).
Per-slide pulse placeholder until ready (`:39, 168-184`);
`loadIntroSlideUrls()` never rejects (`onboarding-slides.ts:69-107`). Hardware
back is intercepted to step backward through slides rather than leave the funnel
(`:81-96`) — deliberate and correct. The dot indicator carries
`aria-label="Slide N of M"` (`:192`).

**Missing — per-image failure.** Once ready, `<img>` and `<source>` render with
no `onError` (`:169-179`). If an operator-uploaded slide points at a storage path
that later 404s, that slide shows a broken-image icon with no recovery — on the
first full-bleed screen a new user sees.

**Minor.** The track transform on next/prev/swipe (`:141-147`) is the one
animation here not covered by `funnel-motion.css`'s reduce-motion block. A single
300ms translate, so not vestibular — but it is a gap against a stated rule.

## Welcome — `/welcome`

Static, no network. `funnel-enter` staggered fade-up at 20–70ms delays — brief,
reduced-motion safe, and on a screen seen at most once per session, so correct
per `02_motion.md §4`. No Back, correctly — it is the funnel root.

## Method screens — `/signup`, `/login`

`MethodCard` rows use only transform and opacity (`MethodCard.tsx:32-37`) —
cheap, right for a pick list. Log-in promotes the last-used method with a "Last
used" badge (`LoginMethodScreen.tsx:55-58, 94`) from `readLastMethod()` — a real
continuity win for returning users.

**Gap — no visible Back on either.** Both render via `FunnelBackdrop` rather than
`AuthScreen`, so neither gets the chevron every downstream screen has
(`AuthScreen.tsx:66-87`). The only way back to Welcome is an invisible gesture.

## Sign-up: phone, code, email, password

Phone (`SignUpPhoneScreen.tsx`): sending state disables Continue (`:42, 81`),
inline error (`:75`), Continue gated on `isStructurallyValidPhone` (`:46, 81`),
`onBack` to `/signup` (`:74`).

Code (`SignUpPhoneCodeScreen.tsx`): `autoComplete="one-time-code"` for platform
autofill (`:136`), focus-and-select recovery on error (`:88-89`), resend cooldown
(`:52, 57`), resend failure surfaced separately (`:100-108`). No shake on error,
deliberately — retyping a code is frequent, and frequent interactions earn no
motion.

**Gap, twice — no spinner during the network wait.** Both `phoneOtp.start`
(`SignUpPhoneScreen.tsx:77-85`) and `phoneOtp.verify`
(`SignUpPhoneCodeScreen.tsx:118-121`) only swap the button's text label and never
pass `loading`. `Button` has a purpose-built treatment that preserves width and
swaps to an animated `PingoDot` (`packages/ui/src/primitives/Button.tsx:107-128`),
used correctly by `CreatePasswordScreen.tsx:120`, `LoginPasswordScreen.tsx:163`
and `UsernameScreen.tsx:147`. On a slow connection the most common sign-up path
renders as a dimmed button with static text — hard to tell from broken.

Email (`SignUpEmailScreen.tsx`): clean, structural validation only by design
(`:15-17`), no network so no loading state needed.

Password (`CreatePasswordScreen.tsx`): uses `loading={saving}` correctly
(`:120`); the `identity_exists` collision redirects to log-in carrying the
identity in router state (`:96-99`) so nothing is retyped — a genuinely good
continuity move. `onBack` branches on identity kind (`:112`).

## Log-in

Email, phone and username screens are structurally identical and clean — `t()`
copy, correct `onBack`, no enumeration leakage.

Password (`LoginPasswordScreen.tsx`): correct spinner (`:163`), rate-limit
lockout with a live countdown (`:135, 150-152`), and failure on **two** channels
— shake plus toast (`:147`) and an inline caption (`:154`) — which satisfies
"motion is never the only channel": the toast is decorative, the caption is the
record.

**But it improvises the lockout sentence** (`:150-152`) instead of calling
`authErrorMessage()`, which already formats this exact case with
`formatCountdown()` (`messages.ts:101-104`). That file's own docstring says the
point of it is that "the wording of a failure is a product decision rather than
something each screen improvises" (`messages.ts:6-9`). There are now two copies
that can drift.

## Google — `/auth/google`

One screen serving both OAuth legs, reasonable given Google forbids webview OAuth
(`:22-25`). Connecting (`:99-101`), error (`:83-91`), `access_denied` handled
silently per spec (`:57-60`).

**Real bug — Cancel always lands on `/welcome`.** Both `access_denied` (`:58`)
and manual Cancel (`:105-107`) hardcode `navigate('/welcome', { replace: true })`,
and neither entry point (`SignUpMethodScreen.tsx:32`, `LoginMethodScreen.tsx:32`)
passes any origin. A returning user who taps Continue with Google from **Log In**
and backs out lands on the **sign-up** landing page — it reads as "the app forgot
I have an account." The codebase already has the pattern: `RequireAuth` carries
`state={{ from: location.pathname }}` for exactly this reason
(`guards.tsx:49-54`).

**And the screen bypasses the voice catalog entirely** despite the keys existing:
`auth.connecting`, `auth.connectFail`, `auth.cancel` are all at
`catalog.ts:123-125` and `:911-913`. It does not import `useT` at all.

## Setup — name, username, photo, permissions

Name: clean, no Back by design (the account already exists, documented `:22-23`).

Username: debounced 400ms check with a `PingoDot` in the trailing slot,
available/taken states, and in-place recovery from a lost race against the unique
index (`:121-129`) — well handled.

Photo: uploading overlay (`:143-147`), size-limit error (`:51-54`), upload-failure
revert (`:78-81`), remove-photo failure (`:107-108`). Genuinely thorough for an
optional step.

Permissions: asking state, granted, denied but non-blocking with a Continue
(`:76-88`), unsupported browser proceeds silently (`:44-47`). Asking before
triggering the real browser prompt, so Skip never burns it, is well reasoned and
documented (`:20-26`).

**All three hardcode English** — "Continue", "Skip", "Take Photo", "Choose
Gallery", "Allow", helper lines and error strings — in screens that otherwise
call `t()` for title and label. `PhotoScreen` even uses a raw `label="Uploading"`
(`:145`) while `setup.photoUploading` exists at `catalog.ts:137`.

## AppLoader

20 lines, SVG only, honours reduced motion via `app-loader-arc`
(`styles/app.css:608-618`), ships no media. Good. Its one hardcoded label is on
the dev-only preview route — not worth fixing.

---

## Top five fixes

1. **SMS send and code verify have no spinner, unlike every sibling.**
   `SignUpPhoneScreen.tsx:77-85`, `SignUpPhoneCodeScreen.tsx:118-121`. Add
   `loading={sending}` / `loading={checking}`. **Trivial** — one prop each. This
   is the most common sign-up path rendering as a dead button on a slow network.

2. **Google Cancel always routes to `/welcome`.**
   `GoogleConnectingScreen.tsx:58, 105-107`. Pass
   `state={{ from: '/login' | '/signup' }}` at both call sites, mirroring
   `guards.tsx:49-54`, and read it back before falling back. **Small** — two call
   sites plus one screen.

3. **Intro renders remote art without verifying it.**
   `IntroSlidesScreen.tsx:169-179`. Add `onError` per image falling back to
   `localFallbackUrl()`, already available in `onboarding-slides.ts` — the
   pattern `SplashScreen.tsx:82-90` uses. **Small** — one handler.

4. **Setup, password and Google hardcode English past the two-voice catalog.**
   `CreatePasswordScreen.tsx:123`, `LoginPasswordScreen.tsx:150-152, 166, 176`,
   all of `GoogleConnectingScreen.tsx`, and the buttons and body copy in
   `UsernameScreen`, `PhotoScreen`, `PermissionsScreen`. Wire the keys that exist,
   add the ones that do not. A user on the second voice hits default-voice copy on
   every login error. **Medium** — ~7 files, one-line swaps each.

5. **`/signup` and `/login` are the only screens with no visible Back.**
   Either wrap both in `AuthScreen` — losing the current logo-centred layout — or
   add an equivalent chevron. **Medium**, because it is a deliberate layout call
   either way.
