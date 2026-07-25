# 01 — Onboarding & Authentication

Covers the first second of the product through to Home: Splash, Welcome, Login,
the three-way password recovery, the Emergency Password, Contact Owner recovery,
and the ten-step registration.

---

## ⚠️ Read first: three consequences of the chosen auth model

The specified model is **phone + password, with a second static "Emergency
Password" for recovery, and human-mediated "Contact Owner" as the last resort.**
It is designed and specified in full below. Three consequences follow from it that
change the *design*, not just the implementation — so they belong here, before the
screens.

### Consequence 1 — A password reset cannot recover message history

This is the important one.

"Connect. Privately." implies end-to-end encryption. Under E2E, messages are
readable only by keys held on the user's devices. The server does not have them,
which is the entire point.

So a server-side password reset restores **access to the account**, not **access to
the history**. A user who resets on a new device with no old device available gets
an empty, working account.

This is not a flaw — it is the correct behaviour, and it is exactly what a
privacy-first product should do. But it *must* be designed, or it becomes the worst
support experience in the product: a user recovers their account, feels relief, and
then discovers years of conversation are gone with no warning.

**Design requirements:**
- Registration includes a **Recovery Key** step (see step 4a), stated plainly:
  this is what restores your messages; your password only restores your account.
- The reset flow states the consequence **before** the reset completes, not after.
- The post-reset Home shows a persistent, dismissible banner: *"Your messages stay
  on your other devices. Sign in there to restore them."*
- If the user has another active device, the reset flow offers device-to-device
  restore **first**, and treats "start fresh" as the fallback.

### Consequence 2 — Two passwords is a usability risk before it is a security win

A second user-chosen static secret tends to be weak, similar to the first, or
written on the same piece of paper — at which point it has doubled the attack
surface and added no recovery capability.

The offline-recovery goal is genuinely good: it avoids SMS OTP, and **SIM-swap is a
real, common account-takeover attack** that OTP-based recovery is defenceless
against. Refusing OTP as the primary path is the right call.

**Recommendation, adopted in the spec below:** keep the Emergency Password as the
user-facing concept and name, but make it a **system-generated recovery code**
(step 4a) rather than a user-typed password — with a "set my own" escape hatch that
enforces genuine strength and rejects any similarity to the login password. This
preserves the intent exactly, and removes the failure mode where both secrets are
the same weak string.

### Consequence 3 — "Contact Owner" is the product's largest attack surface

Human-mediated recovery is the single most exploited path in account security.
An attacker who cannot break cryptography will simply ask a support agent nicely,
with a convincing story.

It is specified below with the controls that make it survivable: mandatory delay,
veto window on existing sessions, two-person authorisation, and an audit trail. The
delay is not friction to be optimised away later — **it is the control.** A recovery
that completes in minutes is a takeover that completes in minutes.

None of this blocks the design. It shapes it, and the shaping is below.

---

## 1. Splash

**Purpose:** a brand moment. Not a loading screen.

```
┌──────────────────────────────┐
│                              │
│                              │
│                              │
│              P•              │
│                              │
│            PINGO             │
│      CONNECT. PRIVATELY.     │
│                              │
│                              │
│                              │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Background | `bg-brand-wash` — one heavily blurred orb, no gradient mesh |
| Content | Monogram 96px, wordmark 22px, tagline caption |
| Motion | Content `fade-in` 240ms. The orb drifts on a 20s loop, ≤ 12px travel |
| Duration | 1400ms fixed, then route |
| Progress | **None.** A splash that shows progress is a loading screen |

**Routing on exit**

| Condition | Destination |
| --- | --- |
| Session valid | Home |
| Onboarded, no session | Login |
| Never onboarded | Welcome |

**Rule:** the splash never exceeds 1400ms, even if the session check is slower. If
the check is still pending, route to Home and let Home show its own loading state.
A splash that waits for the network is a splash that hangs on a bad connection.

---

## 2. Welcome

**Purpose:** state what PINGO is in three words, and get out of the way.

```
┌──────────────────────────────┐
│                              │
│                              │
│              P•              │
│                              │
│      Welcome to PINGO        │
│                              │
│           Private.           │
│          Beautiful.          │
│            Calm.             │
│                              │
│  ┌────────────────────────┐  │
│  │      Get Started       │  │  ← gradient
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │        Log In          │  │  ← secondary
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Title | `h1` 32 / SemiBold |
| Three words | `h2` 20 / Medium, one per line, centred, `text-secondary` |
| Motion | Title, then words, then buttons — `rise` 240ms, staggered 60ms |
| Whitespace | ≥ 40% of the viewport is empty. This is the spec, not a side effect |

**Why three lines, not one sentence:** "Private. Beautiful. Calm." on three lines
reads as a statement of values. On one line it reads as marketing copy. The line
breaks are the design.

No carousel. No feature tour. No permission requests. A user who taps Get Started
has already decided; a tour delays them to reassure us, not them.

---

## 3. Login

Two steps, deliberately. Phone and password on one screen means an error can't tell
you *which* was wrong without leaking whether the account exists.

### 3.1 Phone number

```
┌──────────────────────────────┐
│  ‹                           │
│                              │
│    What's your number?       │
│                              │
│    We'll use this to sign    │
│    you in.                   │
│                              │
│  ┌──────┐ ┌───────────────┐  │
│  │ 🇮🇳 +91│ │ 98765 43210   │  │
│  └──────┘ └───────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │       Continue         │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

| Element | Behaviour |
| --- | --- |
| Country selector | Pill, flag + dial code. Opens a searchable bottom sheet |
| Default country | From device locale. Never from IP — that leaks travel |
| Number field | `tel` keyboard, auto-formats as you type per country |
| Continue | Disabled until the number is structurally valid for that country |
| Motion | Field grows its border on focus (`instant`). No shake on error |

**Error handling:** an unknown number and a wrong password produce the *same*
generic failure at the end of the flow, never at this step. Telling a stranger
"no account with this number" is an account-enumeration oracle.

### 3.2 Password

```
┌──────────────────────────────┐
│  ‹                           │
│                              │
│    Enter your password       │
│                              │
│    +91 98765 43210     Change│
│                              │
│  ┌────────────────────────┐  │
│  │ ••••••••••         👁  │  │
│  └────────────────────────┘  │
│                              │
│           Forgot password?   │
│                              │
│  ┌────────────────────────┐  │
│  │        Log In          │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

| Element | Behaviour |
| --- | --- |
| Number recap | Caption, with a `Change` text button back to 3.1 |
| Reveal toggle | Eye icon. Reveals while held on touch; toggles on desktop |
| Forgot password | Text button, above the primary action — findable without being loud |
| Log In | Shows `loading` (monogram dots), keeps its width |
| Biometric | If previously enrolled, Face/Touch prompt fires on mount; password remains available underneath |

**On failure:** the field border goes `danger`, a caption appears below —
*"That password doesn't match. Try again, or recover your account."* — and focus
returns to the field with content selected. **No shake animation.** A shake is a
scold, and the user already knows they were wrong.

**Rate limiting, surfaced honestly:** after 5 failures, a cooldown with a visible
countdown and an explanation: *"Too many attempts. Try again in 4:58 — this
protects your account."* Never silently fail; a user who doesn't know they're
throttled assumes the app is broken.

---

## 4. Forgot Password — the triage screen

```
┌──────────────────────────────┐
│  ‹                           │
│                              │
│    Recover your account       │
│                              │
│  ┌────────────────────────┐  │
│  │ 🔑 Emergency Password  ›│  │
│  │    Fastest. You set     │  │
│  │    this up when you     │  │
│  │    joined.              │  │
│  ├────────────────────────┤  │
│  │ 💬 Contact Owner      ›│  │
│  │    Takes up to 3 days.  │  │
│  │    Use if you've lost   │  │
│  │    both passwords.      │  │
│  ├────────────────────────┤  │
│  │ ↩  Try Again          ›│  │
│  │    Go back and re-enter │  │
│  │    your password.       │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

Three options as one `ListGroup`, each with a description stating **its real cost**.
"Takes up to 3 days" is stated up front, not discovered after submitting a form.
The ordering is fastest-first, and `Try Again` is last because it is the option a
panicking user forgets they have.

No option is a gradient button. This is a triage screen, not an action screen —
Law 1 holds because there is no single thing the user is here to do.

---

## 5. Emergency Password recovery

### 5.1 Entry

```
┌──────────────────────────────┐
│  ‹                           │
│                              │
│    Emergency Password        │
│                              │
│    The recovery code you     │
│    saved when you joined.    │
│                              │
│  ┌────────────────────────┐  │
│  │ ▢▢▢▢ - ▢▢▢▢ - ▢▢▢▢    │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │       Continue         │  │
│  └────────────────────────┘  │
│                              │
│    Lost it? Contact Owner    │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Format | Three groups of four, auto-hyphenated, case-insensitive, monospace |
| Paste | Accepted and normalised — strips spaces, hyphens, casing |
| Attempts | **3 total, then this path is locked permanently** for this account |
| On lock | Routes to Contact Owner with an explanation. The code is not re-issuable without full recovery |
| Custom passwords | If the user chose their own at registration, this becomes a standard password field with the same 3-attempt limit |

Three attempts is deliberately harsh. A recovery code is high-entropy and either
possessed or not — brute-force tolerance buys an attacker far more than it buys a
legitimate user.

### 5.2 Set a new password

On success, straight to a new-password screen with the strength meter from
registration (step 3). Then:

### 5.3 The history disclosure — mandatory, before completion

```
┌──────────────────────────────┐
│                              │
│    One thing to know         │
│                              │
│    Your messages are         │
│    encrypted on your         │
│    devices — not on our      │
│    servers.                  │
│                              │
│    Resetting your password    │
│    signs you in, but won't    │
│    bring your history to     │
│    this device.              │
│                              │
│  ┌────────────────────────┐  │
│  │ Restore from a device  │  │  ← gradient, if any active
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  Continue without it   │  │
│  └────────────────────────┘  │
│                              │
└──────────────────────────────┘
```

This screen is **not skippable and not dismissible.** It is the difference between
a user who understands their own privacy guarantees and a user who feels robbed.

If no other device is active, the primary action becomes `I understand` and the
copy drops the restore offer rather than offering something impossible.

### 5.4 On completion

- All other sessions are **notified**, not terminated. A legitimate reset should
  not lock the user out of their working device — that device is how they restore.
- A security event is written to Settings → Security → Recent activity.
- The Emergency code is **consumed**. A new one is generated and the user is
  required to save it before reaching Home.

---

## 6. Contact Owner recovery

The last resort. Four stages, and the design's job is to make the wait feel
*deliberate* rather than broken.

```
Request  →  Verification  →  Waiting period  →  Reset
```

### 6.1 Request

A single form, minimal by necessity — a locked-out user has nothing but their
identity to offer.

| Field | Purpose |
| --- | --- |
| Phone number | Prefilled, locked |
| Your name on the account | First proof point |
| A contact we can reach you on | Email or alternate number. **Never** the account's own number |
| Anything that helps | Free text. Optional. Approximate join date, names of frequent contacts |

Submit produces a **case reference** shown immediately and copyable. A user who
cannot see proof their request exists will submit it five more times.

### 6.2 Verification

Not designed as a screen the user drives — it is a state they *observe*. The
Waiting screen (6.3) reflects it.

Server-side requirements, recorded here because they are product decisions:

- **Two-person authorisation.** No single operator can complete a reset.
- **Fixed proof requirements**, identical for every case. An operator may not
  accept a persuasive story in place of the checklist — that discretion is the
  vulnerability.
- **Full audit trail:** who reviewed, what was accepted, when, from where.

### 6.3 Waiting

The screen a user returns to. It must always answer *"is this still happening?"*

```
┌──────────────────────────────┐
│                              │
│           P•                 │  ← monogram, loading state
│                              │
│    We're reviewing your      │
│    request                   │
│                              │
│    Case PG-4K92-XR           │
│                              │
│  ●───────●───────○───────○   │
│  Sent  Review  Wait   Reset  │
│                              │
│    Usually within 3 days.    │
│    We'll message you at      │
│    p•••••@gmail.com          │
│                              │
│           Cancel request     │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Stepper | Four states, current one marked with the purple dot. Air motion only |
| Contact | Masked, so a shoulder-surfer learns nothing |
| Cancel | Always available. Cancelling is instant and notifies all sessions |
| Polling | Push-driven. If polling is required, ≥ 60s and never a visible spinner |

### 6.4 The waiting period is the control

Once verification passes, a **72-hour hold** begins before the reset is usable.
During the hold:

- Every active session gets a **full-screen, unmissable notice**: *"Someone
  requested a password reset for your account. If this wasn't you, tap here to
  stop it."*
- A single tap from any signed-in session **cancels the reset and locks the path
  for 30 days.**
- The hold cannot be shortened by support. There is no expedite. If an operator can
  waive the delay, an attacker can talk an operator into waiving the delay.

This is the whole security model of Contact Owner: *the real owner has a device,
and gets a veto.*

**Product cost, stated plainly:** a user who has genuinely lost every device waits
three days. That is the correct trade. The alternative — fast human recovery — is
how accounts get stolen, and a messaging app that loses accounts to social
engineering has failed at "Privately."

---

## 7. Registration — ten steps

One decision per screen. A progress bar across the top, because a user who cannot
see the end of a form abandons it.

```
Phone → Password → Emergency → Name → Username
  → Photo → Theme → Notifications → Contacts → Home
```

**Global rules for the flow**

- Progress bar: 2px, brand gradient, animates `quick` on advance. No step numbers —
  "3 of 10" makes 10 feel long.
- Back always works and always preserves what was entered.
- Every step except Phone, Password and Emergency is **skippable**, with the skip as
  a text button, never hidden.
- Keyboard is up on mount for text steps; the primary button sits above it.
- One `h1` question per screen, one field, one action.

### Step 1 — Phone

As Login 3.1. On Continue, a **single** OTP verifies the number is real — this is
number *verification*, not the login mechanism, and it happens exactly once in the
account's life.

```
┌──────────────────────────────┐
│    Verify your number        │
│                              │
│    Code sent to              │
│    +91 98765 43210           │
│                              │
│    ▢  ▢  ▢  ▢  ▢  ▢          │
│                              │
│    Resend in 0:42            │
└──────────────────────────────┘
```

Six boxes, auto-advance, auto-submit on the last digit, paste-aware, autofill from
SMS where the OS supports it. Resend has a visible cooldown.

### Step 2 — Create Password

```
┌──────────────────────────────┐
│    Create a password         │
│                              │
│  ┌────────────────────────┐  │
│  │ ••••••••••         👁  │  │
│  └────────────────────────┘  │
│                              │
│  ▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░  Good    │
│                              │
│  ✓ At least 10 characters    │
│  ✓ Not a common password     │
│  ○ Mix of letters & numbers  │
│                              │
│  ┌────────────────────────┐  │
│  │       Continue         │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Meter | Four segments, gradient-filled as strength rises. `quick` transition |
| Requirements | Live checklist. Met items go brand-checked, unmet stay hollow — **never red**. An unmet requirement on a password you are still typing is not an error |
| Minimum | 10 characters, and a check against a breached-password list |
| No confirm field | The reveal toggle solves the typo problem better than typing it twice |

### Step 3 — *(merged into Step 2)*

### Step 4 — Emergency Password

```
┌──────────────────────────────┐
│    Your recovery code        │
│                              │
│    This is how you get back   │
│    in if you forget your      │
│    password. Save it now —    │
│    we can't show it again.    │
│                              │
│  ┌────────────────────────┐  │
│  │  7K4M - 92XR - PL38    │  │
│  │                     ⧉  │  │
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │      Save as file      │  │
│  └────────────────────────┘  │
│                              │
│  ☐ I've saved my code        │
│                              │
│  ┌────────────────────────┐  │
│  │       Continue         │  │
│  └────────────────────────┘  │
│                              │
│    Set my own instead        │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Code | System-generated, ~64 bits, ambiguity-free alphabet (no `0/O`, `1/I/l`) |
| Display | Monospace, three groups, generous tracking, on a `sunken` card |
| Copy | Icon button, confirms via snackbar |
| Save as file | Downloads a plain `.txt` with the code and one line of context |
| Checkbox | Continue stays disabled until checked. Deliberate friction — this is the only moment this code exists |
| Escape hatch | `Set my own instead` → a password field that enforces strength **and rejects anything similar to the login password** |

### Step 4a — Recovery Key *(new, required by Consequence 1)*

Immediately after, because the two are easily confused and the difference matters:

```
┌──────────────────────────────┐
│    One more key              │
│                              │
│    Your recovery code gets    │
│    you into your account.     │
│                              │
│    This key restores your     │
│    messages. They're          │
│    encrypted, so only you     │
│    can unlock them.           │
│                              │
│  ┌────────────────────────┐  │
│  │  Back up automatically │  │  ← gradient
│  │  to iCloud / Drive     │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │   Save it myself       │  │
│  └────────────────────────┘  │
│                              │
│    Skip — I'll risk it       │
└──────────────────────────────┘
```

The wording distinguishes the two keys by **what they get you back**, not by their
names. "Recovery code" vs "recovery key" is indistinguishable to a user; "gets you
into your account" vs "restores your messages" is not.

Skipping is allowed — it is the user's data and the user's call — but the skip is
worded so the trade is unmistakable.

### Step 5 — Name

Single field. `h1`: *"What should we call you?"* Real names not required, no
first/last split, 50-char limit, emoji allowed. Not skippable — a nameless account
is unusable for everyone who talks to it.

### Step 6 — Username

```
┌──────────────────────────────┐
│    Pick a username           │
│                              │
│  ┌────────────────────────┐  │
│  │ @  piyush           ✓  │  │
│  └────────────────────────┘  │
│                              │
│    pingo.chat/piyush         │
│                              │
│    Available                 │
└──────────────────────────────┘
```

The `@` is a fixed prefix inside the field, not typed. Availability checks are
debounced 400ms; the trailing slot shows the dot in `loading`, then a check or a
cross. Three alternatives are offered on collision. Lowercase-normalised on the
fly so the user is never corrected after the fact.

### Step 7 — Profile Photo

```
┌──────────────────────────────┐
│    Add a photo               │
│                              │
│         ┌────────┐           │
│         │   PM   │           │  ← live monogram preview
│         │      + │           │
│         └────────┘           │
│                              │
│    Or keep your monogram —    │
│    it looks good.             │
│                              │
│  ┌────────────────────────┐  │
│  │       Continue         │  │
│  └────────────────────────┘  │
│                              │
│           Skip for now       │
└──────────────────────────────┘
```

The monogram is shown as the **default, not the absence of a photo** — with its
real gradient, already generated from their id. "It looks good" is doing real work:
most onboarding drop-off at a photo step is users who don't have one they like.

Tapping opens a bottom sheet: Camera / Choose photo / Remove. Cropping is a circular
mask with pinch-zoom and drag — water motion, follows the finger.

### Step 8 — Choose Theme

```
┌──────────────────────────────┐
│    Choose your look          │
│                              │
│  ┌────────┐ ┌────────┐       │
│  │ ▤▤▤▤▤▤ │ │ ▨▨▨▨▨▨ │       │
│  │ Light  │ │  Dark  │       │
│  │   ✓    │ │        │       │
│  └────────┘ └────────┘       │
│  ┌────────┐                  │
│  │ ▤▨▤▨▤▨ │                  │
│  │ System │                  │
│  └────────┘                  │
└──────────────────────────────┘
```

Three cards, each a **miniature of the actual chat screen** — two bubbles, a header,
the dock. Not a colour swatch. Selecting applies the theme to the live screen
immediately, so the choice is felt rather than imagined. Selection is a brand ring
plus a check; the transition is a 240ms cross-fade, never a flash.

### Step 9 — Notifications

```
┌──────────────────────────────┐
│    Stay in the loop?         │
│                              │
│    We'll only notify you      │
│    about messages and calls.   │
│    Nothing else. Ever.        │
│                              │
│    You can change this        │
│    anytime in Settings.       │
│                              │
│  ┌────────────────────────┐  │
│  │    Turn On Notifications│  │
│  └────────────────────────┘  │
│                              │
│           Not now            │
└──────────────────────────────┘
```

**We ask before the OS asks.** The OS prompt can only be shown once — spending it
without context is how apps end up permanently muted. This screen earns the yes,
then triggers the real prompt. `Not now` never triggers it, so the option survives.

"Nothing else. Ever." is a commitment the product then has to keep. No marketing
pushes, no re-engagement nudges, no "you have unread messages" reminders.

### Step 10 — Contacts

Same pattern, and the honest version of a request users are right to distrust:

> *"PINGO can show you which of your contacts are already here. We match them on
> your device and never upload your address book."*

If that claim cannot be met by the implementation, **the copy changes — not the
claim.** `Not now` leaves search-by-username fully functional, and the empty Home
state points there.

### Arrival

Home, with the first-run empty state (§ [02](./02-messaging.md)). No confetti, no
"You're all set!" modal, no product tour. The reward for finishing setup is the
product.

---

## 8. Session & device management

| | |
| --- | --- |
| Session length | Indefinite while the device is trusted |
| Re-auth required for | Changing password, changing Emergency code, viewing active sessions, deleting the account |
| Re-auth method | Biometric if enrolled, else password. Never a fresh OTP |
| New device sign-in | All existing sessions notified with device, approximate location, time — and a one-tap *"That wasn't me"* |
| Remote sign-out | Any session can terminate any other, from Settings → Security |
| Lock | Optional app lock (biometric / PIN) with timeout: immediately / 1 min / 5 min / 1 hour |

---

## 9. Error and edge states

| Situation | Behaviour |
| --- | --- |
| No connection at any step | Inline caption above the button: *"You're offline. We'll retry when you're back."* Input is preserved. Never a blocking dialog |
| OTP never arrives | After two failed resends, offer *"Call me instead"* |
| Number already registered (during signup) | Route to Login with the number prefilled: *"Looks like you're already with us."* |
| Username taken at submit (race) | Inline, keeps the input, offers the three alternatives |
| App killed mid-registration | Resume at the last completed step. Phone verification persists; nothing before Name is re-asked |
| Emergency path locked | Route to Contact Owner with a plain explanation of why |
| Reset requested while a hold is active | Show the existing case, do not open a second one |

---

*Previous: [00 — Principles](./00-principles.md) · Next: [02 — Messaging](./02-messaging.md)*
