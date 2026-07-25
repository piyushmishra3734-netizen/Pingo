# 01 — Onboarding & Authentication

The complete new-user journey, screen by screen, at full fidelity. Three sign-in methods:
**Google · Email · Phone.**

Wireframes are drawn at a fixed 38-column inner width. They are layout and copy
specifications, not sketches — the words in them are the shipping copy.

---

## Security model for Phase 1 → initial release

**PINGO does not use end-to-end encryption in Phase 1, Phase 2, or the initial public
release.** Messages are protected by TLS in transit and stored in an authenticated backend
with encryption at rest. E2EE is a future upgrade, and the architecture keeps its seams
open ([§ 20](#20-keeping-the-e2ee-upgrade-path-open)).

Four things get simpler as a result:

| | |
| --- | --- |
| **Password reset loses nothing** | The server holds the messages. Reset, sign in, and the full history is there. No warnings, no disclosure screen, no "start fresh" fallback |
| **Message search covers everything** | Server-side, across the whole history ([03 § 5.3](./03-social-and-calls.md#53-search-scope)) |
| **New devices are instant** | Sign in and the history arrives. No pairing, no QR transfer needed |
| **Backup is not the user's problem** | Messages live on the account. Export is a convenience, not a safety net |

### The one thing that gets harder

**The account is the entire security perimeter.** Under E2EE, an attacker who took over an
account on a new device got an *empty* account. Without it, they get **the complete
history, immediately, server-side.**

So account recovery is not a convenience feature — it is the primary control protecting
message content. That is why the 72-hour hold and one-tap veto on Contact Support recovery
([§ 16.4](#164-the-waiting-period-is-the-control)) are not negotiable for support
throughput later.

### ⚠️ Copy integrity — non-negotiable

"Connect. Privately." remains true and defensible: no ads, no data sold, no third-party
trackers, strong per-user privacy controls, TLS everywhere, encryption at rest.

It is **not** a claim of end-to-end encryption. Prohibited until E2EE actually ships:

- The phrase "end-to-end encrypted", anywhere in product, store listing, or marketing
- A padlock glyph beside a conversation, or any per-chat "encrypted" indicator
- Copy of the form "only you and X can read this" / "not even we can read this"
- A "verify contact" or safety-number surface, which is meaningless without E2EE

Settings → Security carries a **Security overview** stating plainly what is and is not true
([04 § 9](./04-settings.md#9-security)).

---

## 1. Identity model — one account, three doors

**A PINGO account is one identity with one or more attached sign-in methods.** Not three
account types. This distinction decides most of the behaviour below.

| Method | Verifies | Creates a PINGO password? | Can be added later? |
| --- | --- | --- | --- |
| **Google** | A Google account | No — identity is delegated | Yes |
| **Email** | An email address | Yes | Yes |
| **Phone** | A phone number | Yes | Yes |

### 1.1 Rules

1. **Sign-up chooses the first method. It is never the only one.** Every account can attach
   the other two afterwards from Settings → Account.
2. **At least one method must always remain.** Removing the last one is blocked with a
   plain explanation, not a silent failure.
3. **An email or phone that already belongs to an account never creates a second one.** It
   triggers linking ([§ 17](#17-account-linking--conflicts)).
4. **Phone is optional for Google and Email sign-ups** — but contact discovery needs it, so
   Home's empty state offers to add it rather than nagging at signup.
5. **A PINGO password is only created where a method needs one.** A Google-only account has
   no password, so "Forgot password" does not apply to it and is not shown.

### 1.2 Recovery differs by method — this is the important consequence

Recovery is only as strong as the channels the account actually has.

| Account has | Recovery path, in order |
| --- | --- |
| **Google only** | Google account recovery → *(if the Google account itself is lost)* Contact Support |
| **Email + password** | Email reset link → Emergency Password → Contact Support |
| **Phone + password** | **Emergency Password** → Contact Support |
| Phone + Email + password | Email reset link → Emergency Password → Contact Support |

**The Emergency Password matters most for phone-only accounts**, because they have no
second verified channel. So:

| Sign-up method | Emergency Password |
| --- | --- |
| Phone | **Required.** It is the only offline recovery path |
| Email | **Offered, strongly recommended.** Email is a channel, but inboxes get lost too |
| Google | **Not applicable at signup.** Offered later if the user adds a password |

This is why the flow branches at [§ 7](#7-emergency-password--phone-required-email-recommended)
rather than asking everyone the same question.

---

## 2. The complete journey

```
                        SPLASH
                          │
                       WELCOME
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
     GOOGLE             EMAIL             PHONE
        │                 │                 │
   OAuth consent    Enter email       Enter number
        │                 │                 │
        │            Verify code       Verify code
        │                 │                 │
        │           Create password   Create password
        │                 │                 │
        │           Emergency pwd     Emergency pwd
        │            (recommended)      (required)
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                    PROFILE SETUP
              (photo optional · name · @username)
                          │
                     CHOOSE THEME
                          │
                    NOTIFICATIONS
                          │
                      CONTACTS
                          │
                        HOME
```

**Google is three screens to Home. Phone is seven.** Both are legitimate, and the Welcome
screen states the difference honestly so the user chooses with knowledge rather than
discovering it midway.

### 2.1 Global rules for the whole flow

| | |
| --- | --- |
| Progress bar | 2px, brand gradient, top edge. Animates `quick` on advance. **No step numbers** — "3 of 7" makes 7 feel long |
| Back | Always works, always preserves what was entered |
| Skippable | Photo, Bio, Theme, Notifications, Contacts. Skips are text buttons, never hidden |
| Not skippable | Any auth step, Name, Username |
| Keyboard | Up on mount for text steps. The primary button sits above it |
| One question per screen | One `h1`, one field group, one primary action |
| Resume | App killed mid-flow resumes at the last completed step. Verification persists |

---

## 3. Splash

```
┌──────────────────────────────────────┐
│                                      │
│                                      │
│                                      │
│                                      │
│                                      │
│                 *                    │
│                ┌─┐                   │
│                │P│                   │
│                └─┘                   │
│                                      │
│              P I N G O               │
│                                      │
│        CONNECT. PRIVATELY.           │
│                                      │
│                                      │
│                                      │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Background | `bg-brand-wash` — one heavily blurred orb. No gradient mesh |
| Mark | Monogram 96px, wordmark 22px, tagline `caption` uppercase, 0.28em tracking |
| Motion | Content `fade-in` 240ms. The orb drifts ≤ 12px over 20s. Stopped under reduced motion |
| Duration | **Exactly 1400ms**, then route |
| Progress | **None.** A splash showing progress is a loading screen |

**Routing on exit**

| Condition | Destination |
| --- | --- |
| Valid session | Home |
| Onboarded, no session | Log In |
| Never onboarded | Welcome |

The splash never exceeds 1400ms **even if the session check is slower** — it routes to Home
and lets Home show its own loading state. A splash that waits for the network is a splash
that hangs on a bad connection ([11 § 1.1](./11-performance-budget.md#11-the-splash-is-a-ceiling-not-a-spinner)).

---

## 4. Welcome

```
┌──────────────────────────────────────┐
│                                      │
│                 *                    │
│                ┌─┐                   │
│                │P│                   │
│                └─┘                   │
│                                      │
│           Welcome to PINGO           │
│                                      │
│              Private.                │
│             Beautiful.               │
│                Calm.                 │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │  G   Continue with Google      > │ │
│ │      Fastest — no password       │ │
│ ├──────────────────────────────────┤ │
│ │  @   Continue with Email       > │ │
│ │                                  │ │
│ ├──────────────────────────────────┤ │
│ │  #   Continue with Phone       > │ │
│ │      Helps friends find you      │ │
│ └──────────────────────────────────┘ │
│                                      │
│      Already have an account?        │
│               Log In                 │
│                                      │
└──────────────────────────────────────┘
```

### 4.1 Why there is no gradient button here

This is a **triage screen**, not an action screen — there is no single thing the user came
to do. Law 1 ([00 § 1](./00-principles.md#1-the-five-laws)) requires one primary action
*when there is one*; the same reasoning applies to the Forgot Password triage
([§ 14](#14-forgot-password--triage)).

Elevating Google with a gradient would be the obvious choice and it is the wrong one.
Google is genuinely fastest, and its caption says so — but a product whose thesis is
privacy should not visually pressure users toward the option that tells a data company they
use it. **Equal weight, honest captions, user decides.**

### 4.2 Specification

| Element | Spec |
| --- | --- |
| Title | `h1` 32 / SemiBold |
| Three words | `h2` 20 / Medium, one per line, centred, `text-secondary` |
| Method rows | One `ListGroup`, three `ListRow`s with a leading glyph, label, caption and chevron |
| Google glyph | The official Google "G" mark, per their brand requirements. **The only third-party mark in the product** |
| Email glyph | `@`, from the PINGO icon set |
| Phone glyph | Keypad glyph, from the PINGO icon set |
| Captions | Only where they say something true and useful. Email has none because there is nothing to add |
| Log In | Text button, centred, below. Findable without competing |
| Motion | Title → words → card → Log In. `rise` 240ms, staggered 60ms |
| Whitespace | ≥ 35% of the viewport empty |

No carousel. No feature tour. No permission requests. A user who taps a method has already
decided; a tour delays them to reassure us, not them.

### 4.3 Google privacy caption

Tapping Google shows the OS consent sheet, which lists the scopes. Beneath the method rows,
one `caption` in `text-tertiary`:

```
│  Google shares your name, email and       │
│  profile photo with PINGO. Nothing else.  │
```

Stated before the choice, not discovered in a consent dialog.

---

## 5. Sign-up — Google

### 5.1 Consent

Handed to the platform. **Never a webview** — webview OAuth is a phishing vector and Google
blocks it outright.

| Platform | Mechanism |
| --- | --- |
| iOS | `ASWebAuthenticationSession` |
| Android | Credential Manager / Sign in with Google |
| Web | Google Identity Services, popup mode |

```
┌──────────────────────────────────────┐
│                                      │
│                                      │
│                                      │
│                                      │
│              Connecting              │
│               to Google              │
│                                      │
│               *  *  *                │
│                                      │
│                                      │
│                                      │
│                                      │
│                Cancel                │
│                                      │
└──────────────────────────────────────┘
```

Interstitial only, shown while the OS sheet is in flight. The three dots are the brand
loading state. `Cancel` returns to Welcome with nothing created.

**Scopes requested:** `openid`, `email`, `profile`. Nothing else — no Drive, no Contacts,
no Calendar. A scope we do not need is a scope we do not ask for.

### 5.2 On success

| Received | Used for |
| --- | --- |
| Google account ID | The stable identifier. Email changes do not break the link |
| Email, verified | An attached Email method, already verified |
| Name | Prefills Profile Setup |
| Profile photo URL | Fetched once, stored as **our own copy**, prefills the photo |

We store our own copy of the photo rather than hot-linking Google's CDN — otherwise a
signed-out Google account breaks avatars across the product.

### 5.3 What Google sign-up skips

No verification code, no password, no Emergency Password. Straight to Profile Setup with
name and photo already filled.

**The user can add a password later** from Settings → Account, at which point the Emergency
Password is offered.

---

## 6. Sign-up — Email & Phone

### 6.1 Email address

```
┌──────────────────────────────────────┐
│ ▬▬▬░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ <  Back                              │
│                                      │
│  What's your email?                  │
│                                      │
│  We'll send a code to confirm        │
│  it's yours.                         │
│                                      │
│  Email                               │
│  ┌────────────────────────────────┐  │
│  │ piyush@example.com             │  │
│  └────────────────────────────────┘  │
│                                      │
│                                      │
│                                      │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           Continue             │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Keyboard | `email` — no autocapitalise, no autocorrect |
| Autofill | `username` / `email` hints honoured |
| Validation | Structural only on this screen. Existence is proven by the code |
| Continue | Disabled until structurally valid |
| Already registered | **Does not say so here.** Handled at [§ 17](#17-account-linking--conflicts) after verification, so this screen is not an enumeration oracle |

### 6.2 Phone number

```
┌──────────────────────────────────────┐
│ ▬▬▬░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ <  Back                              │
│                                      │
│  What's your number?                 │
│                                      │
│  We'll send a code to confirm        │
│  it's yours.                         │
│                                      │
│  ┌────────┐ ┌───────────────────┐    │
│  │ IN +91 │ │ 98765 43210       │    │
│  └────────┘ └───────────────────┘    │
│                                      │
│                                      │
│                                      │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           Continue             │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Country selector | Pill with flag + dial code. Opens a searchable bottom sheet |
| Default country | **From device locale, never from IP** — IP reveals travel |
| Field | `tel` keyboard, auto-formats per country as typed |
| Continue | Disabled until structurally valid for that country |
| Motion | Border grows on focus, `instant`. **No shake on error** |

### 6.3 Verification code

Identical for both methods.

```
┌──────────────────────────────────────┐
│ ▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ <  Back                              │
│                                      │
│  Enter the code                      │
│                                      │
│  Sent to +91 98765 43210             │
│                                      │
│   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐      │
│   │ 4│ │ 9│ │ 2│ │  │ │  │ │  │      │
│   └──┘ └──┘ └──┘ └──┘ └──┘ └──┘      │
│                                      │
│  Resend in 0:42                      │
│                                      │
│                                      │
│                                      │
│                                      │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Boxes | Six, auto-advance, **auto-submit on the last digit** — no Continue button needed |
| Paste | Whole code accepted and distributed across the boxes |
| Autofill | SMS one-time-code autofill where the OS supports it |
| Backspace | Moves to the previous box and clears it |
| Resend | Visible countdown, 60s. After two failed resends: `Call me instead` (phone) or `Check your spam folder` (email) |
| Wrong code | Boxes border `danger`, caption below, content cleared, focus returns to box 1. **No shake** |
| Attempts | 5, then a cooldown with a visible countdown and a reason |

**This is the only OTP in the account's life.** It proves the address or number is real. It
is *not* the login mechanism — [§ 13](#13-returning-user--log-in) uses a password.

---

## 7. Emergency Password — phone required, email recommended

Created **before** the login password, deliberately: a user who abandons at the recovery
step should not already have a half-made account.

### 7.1 The code

```
┌──────────────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ <  Back                              │
│                                      │
│  Your recovery code                  │
│                                      │
│  If you forget your password,        │
│  this gets you back in. Save it      │
│  now — we can't show it again.       │
│                                      │
│  ┌────────────────────────────────┐  │
│  │                                │  │
│  │      7K4M - 92XR - PL38        │  │
│  │                           Copy │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │          Save as file          │  │
│  └────────────────────────────────┘  │
│                                      │
│  [x] I've saved my code              │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           Continue             │  │
│  └────────────────────────────────┘  │
│                                      │
│        Set my own instead            │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Code | **System-generated**, ~64 bits, ambiguity-free alphabet — no `0/O`, no `1/I/l` |
| Display | Monospace, three groups of four, generous tracking, on a `sunken` card |
| Copy | Icon button, confirms via snackbar |
| Save as file | Plain `.txt` containing the code and one line of context |
| Checkbox | **Continue stays disabled until checked.** Deliberate friction — this is the only moment this code exists |
| Escape hatch | `Set my own instead` → a password field enforcing strength **and rejecting anything similar to the login password** |

### 7.2 Why generated, not user-chosen

A second *user-chosen* static secret tends to be weak, similar to the login password, or
written on the same piece of paper — doubling the attack surface for no recovery gain.

Refusing SMS OTP as the primary recovery path is also right: **SIM-swap is a real, common
account-takeover attack** and OTP-based recovery is defenceless against it. A generated code
keeps that intent and removes the duplicate-weak-secret failure mode.

**There is exactly one code in this flow.** No recovery key, no encryption key, no second
secret. A user leaves onboarding holding one password they chose and one code they saved.

### 7.3 The email variant

For email sign-ups the screen is identical except the checkbox row, which gains a skip:

```
│  [x] I've saved my code              │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           Continue             │  │
│  └────────────────────────────────┘  │
│                                      │
│   Skip — I'll use email recovery     │
```

Allowed, because email is a genuine second channel. Worded so the trade is visible rather
than framed as a warning.

---

## 8. Create Password

```
┌──────────────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░░░░░░ │
│ <  Back                              │
│                                      │
│  Create a password                   │
│                                      │
│  This is what you'll use to          │
│  sign in.                            │
│                                      │
│  Password                            │
│  ┌────────────────────────────────┐  │
│  │ ••••••••••••              (o)  │  │
│  └────────────────────────────────┘  │
│                                      │
│  Strength                            │
│  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░  Strong        │
│                                      │
│  [/] At least 10 characters          │
│  [/] Not a common password           │
│  [ ] Letters and numbers             │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           Continue             │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Reveal | Eye icon. **Held** to reveal on touch, toggled on desktop |
| Meter | Four segments, gradient-filled as strength rises, `quick` transition |
| Checklist | Live. Met items get a brand check, unmet stay hollow — **never red.** An unmet requirement on a password still being typed is not an error |
| Minimum | 10 characters, checked against a breached-password list |
| **No confirm field** | The reveal toggle solves the typo problem better than typing it twice, and halves the work |
| Autofill | `new-password` hint, so password managers offer to generate and save |

### 8.1 On "Confirm Password"

The reference flow included a confirm field. It is deliberately **not** here.

A confirm field exists to catch typos in a value the user cannot see. Once the value *can*
be seen — one tap — the field is pure duplicated effort, and it is a measurable drop-off
point. Password managers, which are what we actually want users to use, make it worse: they
fill one field and the user fights the second.

If a strength meter, a live checklist and a reveal toggle are all present, a confirm field
adds nothing but friction.

---

## 9. Profile Setup

Photo, name and username on one screen. **The photo is optional and framed as such.**

```
┌──────────────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░ │
│ <  Back                              │
│                                      │
│  Set up your profile                 │
│                                      │
│            ┌────────┐                │
│            │        │                │
│            │   PM   │  (+)           │
│            │        │                │
│            └────────┘                │
│                                      │
│      Add a photo — or keep your      │
│        monogram, it looks good.      │
│                                      │
│  Name                                │
│  ┌────────────────────────────────┐  │
│  │ Piyush Mishra                  │  │
│  └────────────────────────────────┘  │
│                                      │
│  Username                            │
│  ┌────────────────────────────────┐  │
│  │ @ piyush                  [/]  │  │
│  └────────────────────────────────┘  │
│  pingo.chat/piyush · Available       │
│                                      │
│  Bio                        Optional │
│  ┌────────────────────────────────┐  │
│  │ Building calm software.        │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           Continue             │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

### 9.1 The photo is optional — and the design says so

| | |
| --- | --- |
| Default | The **live monogram**, rendered with its real deterministic gradient from the user's id |
| Framing | Presented as *a default*, not as an empty slot. `(+)` adds a photo; there is no placeholder silhouette and no "required" marker |
| Copy | *"Add a photo — or keep your monogram, it looks good."* |
| No skip button needed | The field is already satisfied. A skip link would imply it wasn't |
| Google sign-ups | Photo and name arrive prefilled. Both remain editable |
| Tap `(+)` | Bottom sheet: `Take photo` · `Choose photo` · `Remove` |
| Crop | Circular mask, pinch-zoom and drag. **Water motion — follows the finger** |

**"It looks good" is doing real work.** Most onboarding drop-off at a photo step is users
who do not have one they like. Removing that pressure is worth more than a filled avatar.

### 9.2 Name, username, bio

| Field | Spec |
| --- | --- |
| Name | Required. 50 chars, emoji allowed, **no first/last split**, real names not required. A nameless account is unusable for everyone who talks to it |
| Username | Required. `@` is a fixed prefix inside the field, not typed. Lowercase-normalised as you type, so the user is never corrected afterwards |
| Availability | Debounced 400ms. Trailing slot shows brand loading dots, then a check or a cross. Three alternatives offered on collision |
| URL preview | `pingo.chat/username` beneath, so the value is concrete |
| Bio | **Optional, labelled `Optional`** in the field's trailing label. 160 chars, counter appears at 140 |

---

## 10. Choose Theme

```
┌──────────────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░ │
│ <  Back                              │
│                                      │
│  Choose your look                    │
│                                      │
│  ┌───────────┐  ┌───────────┐        │
│  │ ▁▁▁▁▁▁▁▁▁ │  │ ▔▔▔▔▔▔▔▔▔ │        │
│  │ ▁▁▁▁  ▁▁▁ │  │ ▔▔▔▔  ▔▔▔ │        │
│  │ ▁▁▁▁▁▁▁▁▁ │  │ ▔▔▔▔▔▔▔▔▔ │        │
│  │           │  │           │        │
│  │  Light [/]│  │   Dark    │        │
│  └───────────┘  └───────────┘        │
│                                      │
│  ┌───────────┐                       │
│  │ ▁▁▁▁ ▔▔▔▔ │                       │
│  │ ▁▁▁▁ ▔▔▔▔ │                       │
│  │ ▁▁▁▁ ▔▔▔▔ │                       │
│  │           │                       │
│  │  System   │                       │
│  └───────────┘                       │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           Continue             │  │
│  └────────────────────────────────┘  │
│                                      │
│              Skip for now            │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Cards | Each is a **miniature of the real chat screen** — header, two bubbles, dock. Not a colour swatch |
| Selection | Brand ring + check. Applies to the live screen **immediately**, so the choice is felt rather than imagined |
| Transition | 240ms cross-fade. **Never a flash** |
| Default | System |

---

## 11. Notifications

```
┌──────────────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░ │
│                                      │
│                                      │
│               ┌───┐                  │
│               │ ! │                  │
│               └───┘                  │
│                                      │
│           Stay in the loop?          │
│                                      │
│    We'll only notify you about       │
│    messages and calls.               │
│    Nothing else. Ever.               │
│                                      │
│    You can change this anytime       │
│    in Settings.                      │
│                                      │
│                                      │
│  ┌────────────────────────────────┐  │
│  │    Turn On Notifications       │  │
│  └────────────────────────────────┘  │
│                                      │
│               Not now                │
│                                      │
└──────────────────────────────────────┘
```

**We ask before the OS asks.** The OS prompt can only be shown once — spending it without
context is how apps end up permanently muted. This screen earns the yes, *then* triggers
the real prompt. `Not now` never triggers it, so the option survives.

**"Nothing else. Ever."** is a commitment the product then keeps: no marketing pushes, no
re-engagement nudges, no "you have unread messages" reminders
([09 § 5.1](./09-notifications-presence.md#51-types-individually-configurable)).

---

## 12. Contacts

```
┌──────────────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │
│                                      │
│                                      │
│               ┌───┐                  │
│               │ o |                  │
│               └───┘                  │
│                                      │
│            Find your friends         │
│                                      │
│    PINGO can show you which of       │
│    your contacts are already         │
│    here.                             │
│                                      │
│    We match them on your device      │
│    and never upload your             │
│    address book.                     │
│                                      │
│  ┌────────────────────────────────┐  │
│  │      Allow Contacts            │  │
│  └────────────────────────────────┘  │
│                                      │
│                Skip                  │
│                                      │
└──────────────────────────────────────┘
```

**If that claim cannot be met by the implementation, the copy changes — not the claim.**

`Skip` leaves search-by-username fully functional, and Home's empty state points there.

For Google and Email sign-ups without a phone number, this screen adds one line:
*"Adding your number also helps friends find you."* with an `Add number` text button. Offered
once, here, and never nagged again.

---

## 13. Returning user — Log In

### 13.1 Method selection

```
┌──────────────────────────────────────┐
│ <  Back                              │
│                                      │
│                 *                    │
│                ┌─┐                   │
│                │P│                   │
│                └─┘                   │
│                                      │
│            Welcome back              │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │  G   Continue with Google      > │ │
│ ├──────────────────────────────────┤ │
│ │  @   Email                     > │ │
│ ├──────────────────────────────────┤ │
│ │  #   Phone number              > │ │
│ └──────────────────────────────────┘ │
│                                      │
│         New to PINGO?                │
│            Get Started               │
│                                      │
└──────────────────────────────────────┘
```

The last-used method is **moved to the top and captioned `Last used`**, because most
returning sign-ins repeat the previous method.

### 13.2 Password

```
┌──────────────────────────────────────┐
│ <  Back                              │
│                                      │
│  Enter your password                 │
│                                      │
│  +91 98765 43210          Change     │
│                                      │
│  Password                            │
│  ┌────────────────────────────────┐  │
│  │ ••••••••••••              (o)  │  │
│  └────────────────────────────────┘  │
│                                      │
│                  Forgot password?    │
│                                      │
│  ┌────────────────────────────────┐  │
│  │            Log In              │  │
│  └────────────────────────────────┘  │
│                                      │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Identity recap | `caption`, with a `Change` text button back to method entry |
| Reveal | Held on touch, toggled on desktop |
| Forgot password | Text button **above** the primary action — findable without being loud |
| Biometric | If enrolled, the Face/Touch prompt fires on mount. The password field stays available underneath |
| Autofill | `current-password` hint |
| Loading | Monogram dots replace the label, **width preserved** |

**On failure:** field border → `danger`, a caption appears — *"That password doesn't match.
Try again, or recover your account."* — and focus returns with the content selected.
**No shake animation.** A shake is a scold, and the user already knows.

**Rate limiting, surfaced honestly:** after 5 failures, a cooldown with a visible countdown
and a reason — *"Too many attempts. Try again in 4:58 — this protects your account."* Never
silently fail; a user who does not know they are throttled assumes the app is broken.

**Generic failure:** an unknown identity and a wrong password produce the *same* message,
here, at the end. Telling a stranger "no account with this number" is an enumeration oracle.

---

## 14. Forgot Password — triage

The options shown depend on which methods the account actually has
([§ 1.2](#12-recovery-differs-by-method--this-is-the-important-consequence)).

```
┌──────────────────────────────────────┐
│ <  Back                              │
│                                      │
│  Recover your account                │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │  @   Email a reset link        > │ │
│ │      To p•••••@gmail.com         │ │
│ │      Usually instant             │ │
│ ├──────────────────────────────────┤ │
│ │  K   Emergency Password        > │ │
│ │      The code you saved when     │ │
│ │      you joined                  │ │
│ ├──────────────────────────────────┤ │
│ │  ?   Contact Support           > │ │
│ │      Takes up to 3 days. Use if  │ │
│ │      you've lost both.           │ │
│ ├──────────────────────────────────┤ │
│ │  <   Try Again                 > │ │
│ │      Go back and re-enter your   │ │
│ │      password                    │ │
│ └──────────────────────────────────┘ │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Ordering | Fastest first. `Try Again` last, because it is the option a panicking user forgets they have |
| Email row | Shown only if a verified email is attached. Address is **masked** |
| Descriptions | State the **real cost** up front. "Takes up to 3 days" is not discovered after submitting a form |
| No gradient | Triage screen — same reasoning as Welcome ([§ 4.1](#41-why-there-is-no-gradient-button-here)) |
| Google-only account | This screen is never reached. The Log In row for Google has no password, so instead: *"Your account uses Google. Recover it at accounts.google.com."* plus a `Contact Support` row |

---

## 15. Emergency Password recovery

### 15.1 Entry

```
┌──────────────────────────────────────┐
│ <  Back                              │
│                                      │
│  Emergency Password                  │
│                                      │
│  The recovery code you saved         │
│  when you joined.                    │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  ▢▢▢▢  -  ▢▢▢▢  -  ▢▢▢▢       │   │
│  └────────────────────────────────┘  │
│                                      │
│  2 attempts left                     │
│                                      │
│  ┌────────────────────────────────┐  │
│  │           Continue             │  │
│  └────────────────────────────────┘  │
│                                      │
│       Lost it? Contact Support       │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Format | Three groups of four, auto-hyphenated, case-insensitive, monospace |
| Paste | Accepted and normalised — strips spaces, hyphens, casing |
| Attempts | **3 total, then this path locks permanently** for the account. The remaining count is shown |
| On lock | Routes to Contact Support with a plain explanation. The code is not re-issuable without full recovery |
| Custom code | If the user set their own, this becomes a password field with the same 3-attempt limit |

Three attempts is deliberately harsh. A high-entropy code is either possessed or not —
brute-force tolerance buys an attacker far more than a legitimate user.

### 15.2 New password

```
┌──────────────────────────────────────┐
│                                      │
│  Create a new password               │
│                                      │
│  Password                            │
│  ┌────────────────────────────────┐  │
│  │ ••••••••••••              (o)  │  │
│  └────────────────────────────────┘  │
│                                      │
│  Strength                            │
│  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░  Strong        │
│                                      │
│  [/] At least 10 characters          │
│  [/] Not a common password           │
│  [/] Different from your last one    │
│                                      │
│  ┌────────────────────────────────┐  │
│  │        Save & Log In           │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

Same meter and checklist as [§ 8](#8-create-password), plus one rule: it may not match the
previous password.

The action reads **`Save & Log In`**, because the user's goal is getting back in, not
managing a credential. On success they land on **Home, signed in, with their full history
present.**

### 15.3 On completion

- Other sessions are **notified, not terminated.** A legitimate reset should not sign the
  user out of a device they are actively using.
- A security event is written to Settings → Security → Recent activity.
- The Emergency code is **consumed.** A new one is generated and must be saved before
  reaching Home — the same checkbox gate as [§ 7](#7-emergency-password--phone-required-email-recommended).
- **No banner, no warning, no disclosure.** Nothing was lost, so nothing is disclosed.

---

## 16. Contact Support recovery

Four stages. The design's job is to make the wait feel **deliberate rather than broken.**

```
Request  →  Verification  →  Waiting period  →  Reset
```

### 16.1 Request

```
┌──────────────────────────────────────┐
│ <  Back                              │
│                                      │
│  Recover your account                │
│                                      │
│  We'll review this by hand.          │
│  It usually takes 3 days.            │
│                                      │
│  Your account                        │
│  ┌────────────────────────────────┐  │
│  │ +91 98765 43210         locked │  │
│  └────────────────────────────────┘  │
│                                      │
│  Your name on the account            │
│  ┌────────────────────────────────┐  │
│  │                                │  │
│  └────────────────────────────────┘  │
│                                      │
│  Where can we reach you?             │
│  ┌────────────────────────────────┐  │
│  │ Email or another number        │  │
│  └────────────────────────────────┘  │
│                                      │
│  Anything that helps      Optional   │
│  ┌────────────────────────────────┐  │
│  │ Roughly when you joined,       │  │
│  │ names of people you talk to    │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │        Submit request          │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

The reachable contact may **never** be the account's own number or email — that is the
channel the user has lost.

Submit produces a **case reference, shown immediately and copyable.** A user who cannot see
proof their request exists will submit it five more times.

### 16.2 Verification — server-side requirements

Not a screen the user drives; a state they observe. Recorded here because these are product
decisions:

- **Two-person authorisation.** No single operator can complete a reset.
- **Fixed proof requirements**, identical for every case. An operator may not accept a
  persuasive story in place of the checklist — that discretion *is* the vulnerability.
- **Full audit trail:** who reviewed, what was accepted, when, from where.

### 16.3 Waiting

```
┌──────────────────────────────────────┐
│                                      │
│                 *                    │
│                ┌─┐                   │
│                │P│                   │
│                └─┘                   │
│                                      │
│      We're reviewing your request    │
│                                      │
│           Case PG-4K92-XR       Copy │
│                                      │
│   ●────────●────────○────────○       │
│  Sent   Review    Wait     Reset     │
│                                      │
│  Usually within 3 days.              │
│  We'll message you at                │
│  p•••••@gmail.com                    │
│                                      │
│                                      │
│           Cancel request             │
│                                      │
└──────────────────────────────────────┘
```

| | |
| --- | --- |
| Stepper | Four states, current marked with the purple dot. **Air motion only** |
| Contact | Masked, so a shoulder-surfer learns nothing |
| Cancel | Always available. Instant, and notifies all sessions |
| Polling | Push-driven. If polling is required, ≥ 60s and never a visible spinner |

### 16.4 The waiting period is the control

Once verification passes, a **72-hour hold** begins before the reset is usable. During it:

- Every active session gets a **full-screen, unmissable notice**: *"Someone requested a
  password reset for your account. If this wasn't you, tap here to stop it."*
- **One tap from any signed-in session cancels the reset and locks the path for 30 days.**
- **The hold cannot be shortened by support.** There is no expedite. If an operator can
  waive the delay, an attacker can talk an operator into waiving the delay.

That is the entire security model of Contact Support: **the real owner has a device, and
gets a veto.**

**Product cost, stated plainly:** a user who has genuinely lost every device waits three
days. That is the correct trade. And **without E2EE the stakes are higher, not lower** — a
successful takeover here hands over the complete server-side history, not an empty account
on a new device. This hold protects message content, so it is not a support-metric problem
to optimise away in a later release.

---

## 17. Account linking & conflicts

Three doors into one identity produces collisions. Handling them badly creates duplicate
accounts, which is unrecoverable in a messaging product — the wrong account has the
conversations.

| Situation | Behaviour |
| --- | --- |
| **Google sign-up, email already on an account** | Do **not** create a second account. *"You already have a PINGO account with this email."* → sign in with that method, then Google is attached automatically |
| **Email sign-up, address already registered** | Same. Route to Log In with the address prefilled: *"Looks like you're already with us."* |
| **Phone sign-up, number already registered** | Same, after verification succeeds — so the screen never confirms an account exists to someone who cannot prove control of the number |
| **Adding a method already on another account** | Blocked. *"That email is on a different PINGO account."* Merging accounts is not offered — silently combining two message histories is worse than refusing |
| **Google account's email changes** | Link survives. We key on the Google account ID, not the email |
| **Removing the last sign-in method** | Blocked, with a reason: *"Add another way to sign in first."* |
| **Same person, two accounts already** | Not merged. Support can help transfer a username, nothing more. Stated in Help rather than hidden |

**Linking always requires proving control of the existing account first.** Otherwise
"attach my Google to your account" is an account-takeover primitive.

---

## 18. Session & device management

| | |
| --- | --- |
| Session length | Indefinite while the device is trusted |
| Re-auth required for | Changing a password, changing the Emergency code, viewing active sessions, adding or removing a sign-in method, deleting the account |
| Re-auth method | Biometric if enrolled, else password. **Never a fresh OTP** |
| Google-only accounts | Re-auth via a fresh Google assertion |
| New device sign-in | All existing sessions notified with device, approximate location, time — plus a one-tap *"That wasn't me"* |
| Remote sign-out | Any session can terminate any other, from Settings → Security |
| App lock | Optional biometric / PIN with timeout: immediately · 1 min · 5 min · 1 hour |

---

## 19. Error & edge states

| Situation | Behaviour |
| --- | --- |
| Offline at any step | Inline caption above the button: *"You're offline. We'll retry when you're back."* Input preserved. **Never a blocking dialog** |
| Code never arrives (phone) | After two failed resends, offer `Call me instead` |
| Code never arrives (email) | After two, offer `Check your spam folder` and a `Resend to a different address` link |
| Google consent cancelled | Return to Welcome. Nothing created, nothing said |
| Google returns no email | Rare but possible. Fall back to the Email flow to collect and verify one |
| Username taken at submit (race) | Inline, keeps the input, offers three alternatives |
| App killed mid-flow | Resume at the last completed step. Verification persists; nothing before Name is re-asked |
| Emergency path locked | Route to Contact Support with a plain explanation of why |
| Reset requested while a hold is active | Show the existing case. **Do not open a second one** |
| Signing in on a new device | History loads with a progress state, never a blank list ([07 § 6](./07-offline-sync.md#6-first-sync-on-a-new-device)) |

---

## 20. Keeping the E2EE upgrade path open

E2EE is deferred, not abandoned. Adding it later should be a backend and key-management
project — **not a product redesign.** These seams cost nothing now.

### 20.1 Product seams

| Seam | Why it matters later |
| --- | --- |
| **No copy claims E2EE** | Nothing to retract, and the eventual launch is an announcement rather than a correction |
| **Security overview is a screen, not a string** | E2EE changes its content, not its existence |
| **Per-conversation settings exist** | A future per-chat encrypted state has a home. Disappearing messages already live there |
| **Backup framed as export** | When E2EE lands and backup gains a key, the framing shifts without contradicting earlier copy |
| **Device list exists** | Multi-device key management needs a device surface. Already built, already familiar |
| **Search scope is stated in the UI** | A caption already tells the user what search covers. When it narrows to on-device, the caption changes — the pattern does not |
| **Emergency Password is a code, not a key** | It authenticates; it does not decrypt. Adding key escrow later does not have to reuse or explain around it |

### 20.2 Architectural seams in `packages/core`

| Seam | Requirement |
| --- | --- |
| `ChatService` is the only data boundary | An `EncryptedChatService` decorator can wrap any implementation. No screen imports a concrete service |
| `Message.body` is opaque to the UI | No component parses, indexes or transforms content. Bodies arrive ready to render |
| Search is behind `service.search()` | Swapping server search for a local index is one implementation change |
| Attachments referenced by `url` | Content addressing and per-blob keys slot in behind the same field |
| Events are the single source of state change | Key exchange becomes new `ChatEvent` variants; no reducer is rewritten |
| Auth methods are a list, not a type | Adding a key-bearing method later is a new entry, not a schema change |
| No message content in analytics or logs | Non-negotiable now, impossible to retrofit once the habit exists ([13](./13-analytics-telemetry.md)) |

### 20.3 Do not build these

Server-side features E2EE would have to remove. Each works today and becomes a **feature
regression** the day encryption ships:

- Server-composed notification text ([09 § 7.1](./13-analytics-telemetry.md#71-the-push-payload-note-matters))
- Server-side message translation
- Server-side OCR, transcription or object recognition ([10 § 14.2](./10-media-system.md#142-the-constraint--and-it-is-the-important-part))
- Link previews resolved server-side
- Server-side full-text search as the *only* search implementation

Where a choice exists, prefer the client-side implementation now even if it is harder.

---

*Previous: [00 — Principles](./00-principles.md) · Next: [02 — Messaging](./02-messaging.md)*
