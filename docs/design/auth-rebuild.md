# Account creation, rebuilt

What the sign-up and sign-in section should be, before any of it is written.
Sources: `docs/apple-research/`, plus HIG → Managing accounts, read for this.

---

## 1. Why it currently reads as an early demo

Not a matter of taste. Four concrete causes, all findable in the files.

### It has its own design system, and the app has another one

`AuthScreen.tsx` and `MethodCard.tsx` are built almost entirely from arbitrary
values: `text-[1.75rem]`, `text-[0.9375rem]`, `text-[0.8125rem]`,
`text-[0.6875rem]`, `tracking-[-0.03em]`, `tracking-[-0.01em]`, `rounded-[10px]`,
`shadow-[0_4px_20px_rgba(0,0,0,0.04)]`, and `ease-[cubic-bezier(0.23,1,0.32,1)]`
repeated seven times.

The rest of PINGO uses `text-body`, `text-caption`, `text-h2`, `rounded-lg`,
`shadow-sm`, `duration-base`, `ease-standard`. So the funnel cannot match the
app it opens, because it is not drawing from the same scale — every size is a
number somebody picked once. **This is the single largest cause**, and it is
LTK's finding again: the same problem solved twice
(`06_design_process.md §9`).

### One of those values is a theme bug

`shadow-[0_4px_20px_rgba(0,0,0,0.04)]` is a raw `rgba`. `FunnelBackdrop`'s own
docstring records this exact mistake being fixed for the mesh — "it was painted
in light greys … which meant that on a dark phone the sign-in funnel arrived as
a sheet of near-white over a black app" — and the panel shadow was left behind.
`01_materials_and_glass.md §4`: a material chosen because it looked right in one
theme is a bug in the other.

### The background is the busiest thing on screen

`FunnelBackdrop` paints four radial gradients, two blurred breathing orbs, and a
vignette — three decorative layers behind a form with two fields. Apple's rule
is the opposite: the functional layer is where the attention goes and the
content layer stays quiet. Decoration is doing the work that type and spacing
should do, which is precisely what makes a screen read as *trying* to look
finished.

### The form sits in a card, on a page, for no reason

`AuthScreen` wraps its children in
`rounded-2xl border border-line bg-surface p-4 shadow`. That edge fights the
screen edge, insets every field from the margin the rest of the app uses, and
turns a full screen into a widget floating on a wallpaper. `artifact-design`'s
rule and Apple's agree: not everything is a card, and a border says "separate
object" — the form is not a separate object from the screen that exists to hold
it.

### Smaller, but visible

- **Method rows are list rows dressed as cards** — border, shadow, chevron,
  each. Three treatments for "tap this to continue".
- **The progress bar is a 2px hairline at the very top edge**, which reads as a
  page-load bar rather than progress through a flow.
- **Back is the word "Back"** in 13px text with a chevron. Apple uses the
  chevron and the previous screen's name, or the chevron alone.
- **No screen says why an account is needed.** HIG → Managing accounts:
  "write a brief, friendly description of the reasons for the requirement and
  its benefits. **Display this message in your sign-in view.**" Nothing does.
- **The method labels are bare nouns** — "Google", "Phone". HIG: "Always
  identify the authentication method you offer … title it using a phrase like
  'Sign In with Face ID' instead of a generic phrase."

---

## 2. The rules this has to satisfy

From the corpus, all published, all cited:

| Rule | Source |
| --- | --- |
| Explain why an account is needed, in the sign-in view | HIG Managing accounts |
| Name the method: "Continue with Google", not "Google" | HIG Managing accounts |
| Only offer methods available in this context | HIG Managing accounts |
| Postpone nonessential setup; default what you can | `07 §2` |
| Ask for a permission where it is used, not up front | `07 §3` |
| Onboarding is fast and optional | `07 §1` |
| Async buttons must show they are working | `01_first_run.md`, fixed |
| Motion is brief, reversible, interruptible | `02_motion.md` |
| **Account deletion must be possible in-app** | HIG Managing accounts |

That last one is not a nicety: "If you help people create an account within your
app, you **must** also help them delete it, not just deactivate it." PINGO's
Delete Account currently reads "Not yet". Rebuilding account *creation* without
scheduling account *deletion* leaves the section half-built by the same standard
being applied to the rest of it.

---

## 3. Who already exists — checked, not assumed

From `auth.users` on the live project:

| Provider | Accounts | Note |
| --- | --- | --- |
| `email` | 25 | **but 9 are `@phone.pingo.chat`** — derived addresses for phone users |
| `google` | 18 | |
| `phone` | 4 | real phone identities, from the OTP work |
| none | 1 | |

So there are **16 genuine email accounts** — and the operator's call is that
email goes from **both** sign-up and sign-in, with username login as the way
back in for anyone who needs it. That only holds if those people *have* a
username, so it was checked rather than assumed:

| Kind | Accounts | With a username | With a password |
| --- | --- | --- | --- |
| Google only | 17 | 17 | 0 |
| Real email account | 16 | **12** | 16 |
| Phone (derived address) | 9 | 7 | 9 |
| Phone identity only | 4 | 0 | 4 |
| Google + email | 1 | 1 | 1 |

**Four email accounts have no username**, which would have locked them out
entirely. Looked at individually, all four are abandoned shells: none has a
profile row, none has sent a single message, none has returned since the day it
was made. One is the security audit's own test account on `@example.invalid`,
and one is a mistyped `gmai.com` that never completed a sign-in at all.

So removing email costs nothing real. The twelve with usernames keep username
login; the nine derived-address accounts sign in by phone number, which is what
they already do; Google accounts use Google.

## 4. The shape

### Creation: Google and phone only

Both are *the same action* for a new and a returning person — Google returns a
session either way, and a phone number that already has an account signs in
rather than signing up. That collapses two screens into none: there is no
"choose sign-up method" screen and no separate "choose log-in method" screen,
because the welcome screen is already the chooser.

### From nine stops to four

Today, a phone sign-up passes through nine screens before the app:

```
/  →  /intro  →  /welcome  →  /signup  →  /signup/phone
   →  /signup/code  →  /signup/password
   →  /setup/name  →  /setup/username  →  /setup/photo
   →  /setup/permissions  →  /chats
```

Proposed:

```
Google:  /welcome  →  /setup/username  →  /chats            2 stops
Phone:   /welcome  →  /signup/phone  →  /signup/code
                   →  /signup/password  →  /setup/username  →  /chats
```

What goes, and why each is safe:

| Removed | Why |
| --- | --- |
| `/signup` and `/login` method screens | With two methods that both do both jobs, the welcome screen *is* the chooser |
| `/signup/email` | Sign-up is Google and phone only |
| `/setup/name` | Google supplies a display name; phone can default to the username and be edited in the profile, where it already can be |
| `/setup/photo` | Optional by definition, and `/profile/edit` already does it. `07 §2`: postpone nonessential customisation |
| `/setup/permissions` | `07 §3`: PINGO's core function is messaging, which needs neither camera nor microphone. Camera permission belongs at `/camera` |

What stays and why:

- **`/signup/password` stays.** With phone login by password, one SMS is spent
  per account instead of one per sign-in — the decision already made, and the
  reason phone OTP is affordable at all.
- **`/setup/username` stays.** It is the one genuinely required fact: other
  people address you by it, and it cannot be defaulted without generating
  something nobody wants.
- **`/login/email`, `/login/phone`, `/login/username` stay.** Sixteen email
  accounts, nine derived-address phone accounts, and username login exist. Entry
  moves under "Already have an account?" rather than a top-level method screen.
- **`/intro` stays for now**, but `07 §1` says it must be skippable, must stay
  skipped, and must be findable afterwards. That is a separate check.

### Screen by screen

**Welcome** — the whole chooser.

- Brand mark, and one sentence saying what PINGO is.
- **One sentence saying why an account is needed** — the HIG requirement that is
  currently missing everywhere. Something true and short: messages are
  end-to-end encrypted to *you*, so there has to be a you.
- Two full-width buttons: **Continue with Google**, **Continue with phone**.
  Named methods, primary weight, no card around them, no chevrons — they are
  buttons, not list rows into a deeper menu.
- Below, quiet: **Already have an account?** → the existing login methods.
- Legal line, small, at the bottom. Not in a card.

**Phone → code → password** — three screens, already built and now correct
(spinner, resend timer, autofill, focus-on-error). They need the visual system
below, not new behaviour.

**Username** — one field, live availability, one button. Already good.

### The visual system

The fix is subtraction, and almost all of it is deleting arbitrary values.

1. **Every size, weight, radius, shadow and easing comes from the tokens.**
   `text-h1`/`text-body`/`text-caption`, `rounded-lg`, `shadow-sm`,
   `duration-base`, `ease-standard`. If a value does not exist in the scale, the
   scale is what changes — not the screen.
2. **Delete the card.** Fields sit on the page ground at the page's own margin,
   full width, the same margin the app uses.
3. **Reduce the backdrop to one layer.** Keep a single soft wash; drop the
   second orb and the vignette. The content layer stays quiet.
4. **Fix the shadow to a token**, so it inverts. It is the same bug the file
   already documents fixing once.
5. **Progress becomes a step count, not a hairline** — "Step 2 of 3" in caption
   type beside the back chevron, or nothing at all on a two-step path. A 2px bar
   at the screen edge is a loading affordance.
6. **Back is a chevron**, sized to the touch target, with no "Back" label.
7. **One button treatment**, the app's primary, at full width.

---

## 5. What this does not decide

Three things that need the operator, not the spec:

1. **Does `/intro` survive?** `07 §1` says onboarding is optional or it is not
   onboarding, and PINGO's is unskippable for first-time users
   (`IntroSlidesScreen.tsx:34`). Cutting it is a product call, not a design one.
2. **Account deletion.** Required by the same guidance this rebuild is following,
   and currently "Not yet". It needs server-side work — the note in
   `AccountScreen.tsx:227` is honest about why. Rebuilding creation without
   putting deletion on the roadmap is inconsistent.
3. **Does the derived-address scheme stay?** Nine accounts sign in as
   `919…@phone.pingo.chat`. Now that real phone identities exist (4 of them),
   there are two phone schemes in one database. Merging them is a migration, not
   a screen.
