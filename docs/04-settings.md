# 04 — Settings (Complete)

Thirteen sections, every setting specified. No placeholders.

---

## Conventions for this document

**Every setting is one row.** The columns below mean:

- **State** — the control type and its default. `Toggle(on)`, `Choice[a|b|c]`,
  `Value`, `Action`, `Info`.
- **Interaction** — what the user does and what happens on the wire.
- **Animation** — always one of the three motion categories from
  [§ 00.2](./00-principles.md#2-motion-language-water-glass-air).

**Global rules:**

| | |
| --- | --- |
| Persistence | Every change writes immediately. **There is no Save button** — a settings screen with unsaved state is a settings screen that can lie to you |
| Optimism | Local state updates first, then the service call. A failed write reverts the control and raises a snackbar with `Retry` |
| Toggle animation | Knob translates 180ms `ease-standard`; track cross-fades. Always **air** |
| Row animation | Press = `bg-pressed` wash, 120ms. Navigation = push, **water** |
| Destructive rows | `danger` label and icon, always confirmed by a dialog naming the consequence |
| Search | A search field at the top of the settings root, matching every row title and description across all sections |
| Grouping | `ListGroup` cards with an uppercase caption header, hairline dividers between rows, 32px between groups |

---

## Settings root

```
┌──────────────────────────────┐
│ ‹        Settings            │
│ ┌──────────────────────────┐ │
│ │ ⌕ Search settings        │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ┌──┐ Piyush Mishra     › │ │
│ │ │PM│ @piyush             │ │
│ │ └──┘                     │ │
│ └──────────────────────────┘ │
│                              │
│  👤 Account               ›  │
│  🎨 Appearance            ›  │
│  💬 Chats                 ›  │
│  🔔 Notifications         ›  │
│  ☎  Calls                 ›  │
│  📷 Camera                ›  │
│  💾 Storage               ›  │
│  🛡  Privacy               ›  │
│  🔒 Security              ›  │
│  🌐 Language              ›  │
│  ❓ Help                  ›  │
│  ℹ  About                 ›  │
│                              │
│  ⏏  Log Out                  │
│                              │
│            PINGO             │
│     Connect. Privately.      │
└──────────────────────────────┘
```

The account card is first and largest — it is what most visits are looking for.
The wordmark sign-off at 25% opacity closes the screen; it is the one purely
decorative element permitted in the product, and it earns its place by giving the
scroll a definite end.

---

## 1. Account

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Profile photo | The picture people see | `Value` (thumbnail) | Tap → bottom sheet: Camera / Choose / Remove. Circular crop with pinch-zoom | Sheet = water. Crop follows finger |
| Name | How you appear to others | `Value` "Piyush Mishra" | Tap → push to a single-field editor. 50 chars | Push = water |
| Username | Your unique @handle | `Value` "@piyush" | Push. Debounced availability check, 3 suggestions on collision. Warns the old handle frees immediately | Trailing slot: dot `loading` → check. Air |
| Bio | A line about you | `Value` or "Add a bio" | Push. 160 chars, live counter appearing at 140 | Counter fades in. Air |
| Phone number | Used to sign in | `Info` "+91 98765 43210" | Tap → Change number flow. Requires re-auth, then verifies the new number | Push = water |
| Linked email | For recovery contact only | `Value` or "Add email" | Push. Verification link sent | — |
| Devices | Where you're signed in | `Value` "3 devices" | Push → device list. Each row: name, last active, location. Swipe to sign out | Row removal collapses 180ms. Water |
| Request account data | A copy of everything we hold | `Action` | Tap → confirm → prepared and emailed within 48h. Shows a pending state until ready | Pending row shows dot `loading`. Air |
| Delete account | Permanently remove your account | `Action` danger | Tap → dedicated screen listing exactly what is deleted and what is not. Requires typing the username, then re-auth. 7-day grace period with cancel-by-sign-in | Dialog = glass |

**Delete account gets a screen, not a dialog.** A dialog cannot hold the disclosure
this decision requires, and shrinking the disclosure to fit a dialog is how users
delete things they didn't mean to.

---

## 2. Appearance

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Theme | Light, dark, or follow your device | `Choice[Light\|Dark\|System]` = System | Three preview cards, each a miniature of the real chat screen | Applies live. 240ms cross-fade, **never a flash** |
| Accent | The colour of buttons and highlights | `Choice` = Brand gradient | Six swatches, all derived from the board's palette. Brand gradient is first and default | Selected swatch grows a brand ring. Air |
| Chat wallpaper | The background behind your messages | `Choice` = Default | Push → gallery of soft brand-derived washes, plus "Choose photo". Applied per-conversation or globally | Preview updates live. Glass |
| Bubble style | How message bubbles look | `Choice[Rounded\|Compact]` = Rounded | Live preview of two bubbles above the control | Radius transitions 180ms. Air |
| Text size | Make text bigger or smaller | `Choice` 5 steps = Default | A slider with a live paragraph sample above it. Scales the whole type ramp proportionally, never one size | Sample re-renders live. No animation on text reflow |
| Bold text | Heavier text throughout | `Toggle(off)` | Shifts body weight regular → medium globally | — |
| Glass effects | Blurred, translucent panels | `Toggle(on)` | Off replaces `glass-surface` with an opaque `surface` + border. **Auto-off on low-power mode** | Cross-fade 180ms. Glass |
| Blur intensity | How much panels blur | `Choice[Subtle\|Standard\|Heavy]` = Standard | Maps to 16 / 24 / 36px. Disabled when Glass effects is off | Live. Glass |
| Reduce motion | Minimise animation throughout | `Toggle` = follows OS | On: stops all ambient loops, collapses transitions to 0.01ms. Independently settable above the OS value, never below | Instant by definition |
| Show avatars in groups | Picture beside each sender | `Toggle(on)` | Off reclaims 40px per cluster in group threads | Layout settles 180ms. Water |
| App icon | Choose your icon | `Choice` 4 variants | The four treatments from the board: Light, Gradient, Dark, Plain | Selection ring. Air |

**Text size scales the ramp, not a size.** Changing only `body` breaks the
relationships the type scale exists to hold.

---

## 3. Chats

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Enter sends message | Press Enter to send instead of a new line | `Toggle(on)` | Desktop only; hidden on touch where there is no discoverable Shift | — |
| Message preview in list | Show message text in your chat list | `Toggle(on)` | Off shows only sender and time | Preview line collapses 180ms. Water |
| Media auto-download | Download photos and videos automatically | `Choice[Never\|Wi-Fi\|Wi-Fi & mobile]` = Wi-Fi | Push → per-type matrix: Photos, Audio, Video, Documents × Wi-Fi / Mobile / Roaming | Checkbox grid. Air |
| Save to gallery | Copy received media to your device gallery | `Toggle(off)` | Off by default: writing another app's media into a user's camera roll is a decision they should make | — |
| Font | Typeface for message text | `Choice[Space Grotesk\|System]` = Space Grotesk | The brand face is default; System exists for users with dyslexia-friendly fonts installed | Re-render, no transition |
| Spell check | Underline misspelled words | `Toggle(on)` | Delegates to the platform | — |
| Archive muted chats | Move muted conversations out of your list | `Toggle(off)` | On: muted chats move to Archive and stay there | Rows animate out 240ms. Water |
| Keep archived chats archived | Don't unarchive on new messages | `Toggle(on)` | — | — |
| Read receipts | *(mirrored from Privacy)* | `Toggle(on)` | Same setting, surfaced in both places because users look for it in both | — |
| Export a copy of your chats | Save your messages to a file you keep | `Choice[Off\|Daily\|Weekly]` = Off | Push → destination (iCloud/Drive), frequency, include-media toggle. Shows last export time and size | Progress ring while exporting. Air |
| Transfer chats to a new phone | Move your history directly, device to device | `Action` | Push → QR pairing flow, local-network transfer, progress with item counts | Determinate progress. Air |
| Export chat | Save one conversation as a file | `Action` | Per-conversation from the thread menu; here it opens a chooser. With or without media | — |
| Clear all chats | Empty every conversation but keep them in your list | `Action` danger | Dialog naming the count. Requires re-auth | Dialog = glass |
| Delete all chats | Remove every conversation | `Action` danger | Dialog + typed confirmation | Dialog = glass |

**Export is a convenience, not a safety net.** Messages live on the user's account,
so signing in on any device restores them — the export exists for users who want their
own copy, and the row's title says exactly that. Framing it as "backup" would imply a
risk that does not exist today, and would then have to be un-implied.

**Transfer to a new phone stays** even though sign-in already restores history: a
local transfer is faster than a large download and works without a good connection.
It is an optimisation, and the copy presents it as one.

---

## 4. Notifications

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Messages | Notify me about new messages | `Toggle(on)` | Master switch for message notifications | Dependent rows dim to 45% and become inert. 180ms. Air |
| Message tone | The sound for new messages | `Choice` = Soft | Push → 6 short, soft tones. Each previews on selection | Selected row shows a brief waveform. Air |
| Message vibration | How it feels | `Choice[Off\|Short\|Long]` = Short | Fires the pattern on selection | Haptic |
| Show previews | Include the message text in notifications | `Toggle(on)` | Off shows `New message` with no sender or content — the lock-screen privacy setting | — |
| Reaction notifications | Notify me when someone reacts | `Toggle(off)` | Off by default. A reaction is not a message, and treating it as one is how notification fatigue starts | — |
| Calls | Notify me about incoming calls | `Toggle(on)` | — | — |
| Ringtone | The sound for calls | `Choice` = Default | Push → 6 tones, previewing on selection | Air |
| Call vibration | Vibrate for calls | `Toggle(on)` | — | Haptic |
| Mentions | Notify me when someone @mentions me | `Toggle(on)` | Applies in groups and communities even when that conversation is muted — an explicit mention is a direct address | — |
| Group notifications | How much groups can interrupt | `Choice[All\|Mentions only\|None]` = All | — | — |
| Community notifications | How much communities can interrupt | `Choice[All\|Mentions only\|None]` = Mentions only | Communities default lower than groups because they are larger by nature | — |
| Quiet hours | Silence notifications during set hours | `Toggle(off)` | On reveals two time pickers and a day selector | Rows expand 240ms. Water |
| Quiet hours start | | `Value` 22:00 | Time picker in a bottom sheet | Sheet = water |
| Quiet hours end | | `Value` 07:00 | Same | Water |
| Allow calls during quiet hours | Let calls through anyway | `Toggle(on)` | An emergency is usually a call | — |
| Notification badge | Show the unread count on the app icon | `Toggle(on)` | — | — |

**Turning off a master switch dims its dependents rather than hiding them.** Hiding
rows makes a settings screen change height as you use it (Law 5), and it conceals
what would come back if the user re-enabled it.

---

## 5. Calls

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Noise cancellation | Remove background noise from your voice | `Toggle(on)` | — | — |
| Echo cancellation | Stop your voice echoing back | `Toggle(on)` | — | — |
| HD audio | Higher quality voice, uses more data | `Toggle(on)` | Auto-drops on a poor connection with a one-time caption explaining why | — |
| HD video | Higher quality video, uses more data | `Choice[Auto\|Always\|Never]` = Auto | — | — |
| Video call data | Quality when on mobile data | `Choice[Low\|Standard\|High]` = Standard | — | — |
| Default microphone | Which mic to use | `Choice` = System default | Push → device list, live input level meter per device | Meter is air, opacity + height |
| Default camera | Which camera to use | `Choice` = Front | Push → live preview per device | — |
| Default speaker | Where call audio plays | `Choice` = System default | Push → device list | — |
| Start calls muted | Join with your microphone off | `Toggle(off)` | — | — |
| Start calls with video off | Join with your camera off | `Toggle(off)` | — | — |
| Ringing vibration | Vibrate while ringing out | `Toggle(on)` | — | Haptic |
| Low data mode | Use as little data as possible | `Toggle(off)` | On: caps video to 360p, disables HD audio, and dims those rows | Dependent rows dim. Air |
| Call waiting | Let a second call reach you | `Toggle(on)` | — | — |
| Auto-answer | Answer automatically after a delay | `Toggle(off)` | Accessibility feature. On reveals a delay choice | Row expands. Water |
| Mic & camera test | Check your setup before a call | `Action` | Push → live preview, input meter, playback loopback test | Meter is air |

---

## 6. Camera

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Photo quality | How much detail to keep | `Choice[Data saver\|Standard\|HD]` = Standard | Push → each option shows an example file size | — |
| Video quality | Resolution for recorded video | `Choice[480p\|720p\|1080p\|4K]` = 720p | Shows MB-per-minute beneath each | — |
| Compression | Shrink media before sending | `Choice[High\|Balanced\|Off]` = Balanced | `Off` warns about upload time on mobile data | — |
| HDR | Capture a wider range of light | `Toggle(on)` | Hidden entirely on devices without support — never a disabled row for missing hardware | — |
| Mirror front camera | Save selfies as you see them | `Toggle(on)` | Live preview flips on toggle | Preview flips 180ms. Air |
| Grid lines | Show a composition grid | `Toggle(off)` | — | Grid fades in. Glass |
| Level | Show a horizon guide | `Toggle(off)` | — | Air |
| Save originals | Keep an unedited copy | `Toggle(off)` | — | — |
| Save photos you send | Copy sent photos to your gallery | `Toggle(on)` | Distinct from *received* media in Chats — sending is your own content | — |
| Shutter sound | Play a sound when capturing | `Toggle(on)` | Locked on in regions that legally require it, with a caption explaining why | — |
| Geotag photos | Include where a photo was taken | `Toggle(off)` | **Off by default.** Location in shared media is a privacy leak most users don't expect | — |
| Default mode | Open the camera in photo or video | `Choice[Photo\|Video]` = Photo | — | — |
| Camera permission | Allow PINGO to use your camera | `Info` + `Action` | Shows granted/denied. Denied offers `Open Settings` | — |
| Microphone permission | Allow PINGO to use your microphone | `Info` + `Action` | Same | — |

---

## 7. Storage

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Storage used | What PINGO is taking up | `Info` "2.4 GB" | A segmented horizontal bar: Photos / Videos / Voice / Files / Cache, each brand-derived. Tapping a segment filters the list below | Bar segments grow left-to-right on mount, 320ms staggered. Water |
| Manage by conversation | See which chats use the most space | `Action` | Push → conversations sorted by size, each expandable into its media | Rows `rise` staggered 40ms |
| Photos | Space used by images | `Value` "1.1 GB" | Push → grid, multi-select, delete with undo | Selection scales tiles 0.96. Air |
| Videos | Space used by video | `Value` "820 MB" | Same | Air |
| Voice notes | Space used by voice messages | `Value` "94 MB" | Push → list with durations, playable inline | Air |
| Files | Space used by documents | `Value` "310 MB" | Push → sortable list | — |
| Cache | Temporary files PINGO can rebuild | `Value` "180 MB" | `Clear cache` action. **No confirmation** — nothing is lost | Value counts down to 0. Air |
| Auto-delete old media | Remove media after a set time | `Choice[Never\|30 days\|90 days\|1 year]` = Never | Messages are kept; only their media is removed, and the bubble shows `Media removed · Download again` | — |
| Keep starred media | Never auto-delete starred items | `Toggle(on)` | Dimmed while Auto-delete is Never | Air |
| Free up space | Find and remove large items | `Action` | Push → largest items across all conversations, multi-select, running total of what will be freed | Total counts up. Air |
| Download location | Where saved files go | `Value` path | Desktop only | — |

**Clear cache never confirms; delete media always confirms.** The distinction is
whether the data can be recovered — cache can be rebuilt, media cannot.

---

## 8. Privacy

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Last seen | Who can see when you were last active | `Choice[Everyone\|Contacts\|Nobody]` = Contacts | Push. Choosing `Nobody` shows a caption: *"You won't see other people's last seen either."* — reciprocity stated up front | — |
| Online status | Who can see when you're online | `Choice[Everyone\|Same as last seen]` = Same as last seen | — | — |
| Read receipts | Let others know you've read their messages | `Toggle(on)` | Off means **you also stop seeing theirs.** Stated in the description, not discovered later. Always on in groups | — |
| Typing indicators | Show when you're typing | `Toggle(on)` | Reciprocal, same as read receipts | — |
| Profile photo | Who can see your picture | `Choice[Everyone\|Contacts\|Nobody]` = Everyone | — | — |
| Bio | Who can see your bio | `Choice[Everyone\|Contacts\|Nobody]` = Everyone | — | — |
| Gallery | Who can see your gallery | `Choice[Everyone\|Contacts\|Friends\|Nobody]` = Friends | — | — |
| Moments | Who can see your moments | `Choice[Contacts\|Friends\|Custom\|Nobody]` = Friends | `Custom` pushes a member picker with include/exclude | Selection ring. Air |
| Who can call me | Limit incoming calls | `Choice[Everyone\|Contacts\|Nobody]` = Contacts | — | — |
| Who can add me to groups | Stop strangers adding you | `Choice[Everyone\|Contacts\|Nobody]` = Contacts | — | — |
| Who can find me by number | Discoverability by phone number | `Choice[Everyone\|Contacts\|Nobody]` = Everyone | `Nobody` leaves username search working | — |
| Link previews | Fetch a preview when you send a link | `Toggle(on)` | Description states the trade honestly: *"Turning this off means the site never learns you shared it."* | — |
| Read receipts for voice notes | Show when you've listened | `Toggle(on)` | Separate from text receipts — listening is a stronger signal | — |
| Blocked users | People who can't reach you | `Value` "2" | Push → list with avatar, name, blocked date. Unblock with undo | Row collapses 180ms. Water |
| Disappearing messages | Auto-delete new messages by default | `Choice[Off\|24 hours\|7 days\|90 days]` = Off | Applies to **new** conversations; existing ones are set per-thread | — |
| Screenshot blocking | Stop screenshots in PINGO | `Toggle(off)` | Caption is honest about the limit: *"This can't stop a photo of your screen."* Platform support varies; hidden where unsupported | — |
| App lock | Require Face ID or a PIN to open PINGO | `Toggle(off)` | On → enrol, then a timeout choice | Lock screen = glass |
| Hide message previews in app switcher | Blur PINGO in your recent apps | `Toggle(off)` | — | Blur applies on backgrounding. Glass |
| Privacy checkup | Review your settings in one place | `Action` | Push → a guided pass over the highest-impact settings with plain explanations. **Recommends, never auto-changes** | Cards `rise` staggered |

**Reciprocity is stated in the description, never discovered.** Every setting where
turning something off also costs the user something says so in the row.

---

## 9. Security

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Change password | Update your login password | `Action` | Requires current password or biometric. Strength meter, breached-password check | Meter fills. Air |
| Emergency password | Your recovery code | `Info` "Set" + `Action` | Regenerate requires re-auth. Shows the new code once, with the same save-confirmation gate as registration | Code card `rise`. Water |
| Two-step verification | Ask for a second factor when signing in on a new device | `Toggle(off)` | On → authenticator app or hardware key. **Not SMS** — SIM-swap makes SMS the weakest factor | Enrolment = push, water |
| Biometric unlock | Use Face ID or fingerprint | `Toggle(off)` | Falls back to password, never locks the user out | — |
| Active sessions | Devices signed into your account | `Value` "3" | Push → per-device rows: name, platform, last active, approximate location. `Sign out` per row, plus `Sign out all others` | Row collapses on sign-out. Water |
| Recent activity | Security events on your account | `Action` | Push → timeline: sign-ins, password changes, recovery attempts, session terminations. Read-only, 90 days | Rows `rise` staggered 40ms |
| Login alerts | Tell me when someone signs in | `Toggle(on)` | Cannot be turned off while Two-step is off — the alert is the fallback protection | Dimmed with a caption when locked on |
| Security overview | How your messages are protected | `Info` + `Action` | Push → a plain-language page stating exactly what is true today (see below) | Content `rise` |
| Auto-lock timeout | Lock PINGO after inactivity | `Choice[Immediately\|1 min\|5 min\|1 hour]` = 5 min | Dimmed unless App lock is on | Air |
| Clear all sessions | Sign out everywhere, including here | `Action` danger | Dialog naming the device count. Signs this device out too | Dialog = glass |

### Security overview — the page content

This page is the product's honest answer to *"can you read my messages?"* It exists
because the alternative is a padlock icon that implies an answer we cannot give
([01 § Copy integrity](./01-onboarding-auth.md#-copy-integrity--non-negotiable)).

```
┌──────────────────────────────┐
│ ‹    Security overview       │
│                              │
│  IN TRANSIT                  │
│  ✓ Everything you send is    │
│    encrypted between your    │
│    device and PINGO.         │
│                              │
│  ON OUR SERVERS              │
│  ✓ Your messages are stored  │
│    encrypted.                │
│  ⚠ PINGO can technically     │
│    access them. We restrict  │
│    this to a small team, log │
│    every access, and only do │
│    it for safety and legal   │
│    reasons.                  │
│                              │
│  WHAT WE NEVER DO            │
│  ✓ Sell your data            │
│  ✓ Show you ads              │
│  ✓ Use third-party trackers  │
│  ✓ Read messages to profile  │
│    you                       │
│                              │
│  COMING                      │
│  End-to-end encryption,      │
│  where not even we can read  │
│  your messages. We'll tell   │
│  you when it's here.         │
│                              │
│         Read the full policy │
└──────────────────────────────┘
```

| | |
| --- | --- |
| The ⚠ row | **Mandatory.** A security page that lists only reassurances is marketing. The one uncomfortable fact is what makes the rest credible |
| Tone | Declarative, no hedging, no jargon. Every line is a sentence a user can repeat |
| Icons | `✓` brand, `⚠` `away` amber. The only place amber appears in the product |
| "Coming" | Stated as intent without a date. When E2EE ships, this section becomes the top section and the ⚠ row is deleted |

**Deliberately absent from Security:** safety numbers, contact verification, key-change
alerts. All three are E2EE surfaces, and shipping them without E2EE would imply a
guarantee that does not exist. They arrive with the feature.

---

## 10. Language

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| App language | The language PINGO uses | `Choice` = System | Push → searchable list, each language in **its own script** (`हिन्दी`, not `Hindi`) with an English subtitle | Applies immediately; a 240ms cross-fade covers the re-layout. RTL flips mirror the layout |
| Region format | How dates, times and numbers appear | `Choice` = System | Push → region list with a live sample line | Sample updates live |
| Time format | 12-hour or 24-hour | `Choice[12h\|24h\|System]` = System | Live sample | — |
| First day of week | Where your week starts | `Choice[Sunday\|Monday\|Saturday]` = System | — | — |
| Translate messages | Offer to translate messages you receive | `Toggle(off)` | **Off by default**, with the reason in the description: *"Translation happens on your device. Nothing is sent to a server."* If that cannot be met, the feature is not shipped | Translated text cross-fades in place. Glass |
| Download languages | Keep languages on your device for offline translation | `Action` | Push → per-language download with size and progress | Determinate progress. Air |
| Keyboard languages | *(link)* | `Action` | Deep-links to OS keyboard settings — we do not reimplement the platform's job | — |

---

## 11. Help

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Help centre | Guides and answers | `Action` | Push → searchable articles, rendered in-app. Not a web view — a web view breaks the design language and the offline case | Article `rise` |
| Contact support | Talk to a person | `Action` | Push → category, description, optional diagnostics attachment (shown before sending, itemised). Returns a case reference | Submit → success state, glass |
| Report a problem | Something's broken | `Action` | Same form, pre-categorised as a bug. Log attachment is **opt-in and inspectable** | — |
| Report a user | Report abuse or spam | `Action` | Push → user picker, reason, optional message selection. Explains exactly what is shared with moderators | — |
| Recovery help | Locked out of your account | `Action` | Push → the recovery paths from [§ 01.4](./01-onboarding-auth.md#4-forgot-password--the-triage-screen), reachable while signed in so a user can prepare before they need it |  — |
| Community guidelines | What's allowed on PINGO | `Action` | In-app document | — |
| Status | Is PINGO working? | `Info` + `Action` | Live service status with a coloured dot — the one permitted non-brand status colour, because service health is not a brand statement | Dot is air |

---

## 12. About

| Setting | Description | State | Interaction | Animation |
| --- | --- | --- | --- | --- |
| Version | Which build you're running | `Info` "0.1.0 (build 12)" | Long-press copies the full build string | Snackbar |
| What's new | Changes in this version | `Action` | Push → release notes for this and prior versions | Rows `rise` |
| Check for updates | See if a newer version exists | `Action` | Inline result, never a modal | Dot `loading` → result. Air |
| Terms of Service | The agreement | `Action` | In-app document | — |
| Privacy Policy | What we collect and why | `Action` | In-app. Opens with a plain-language summary before the legal text | — |
| Open source licences | Software PINGO is built on | `Action` | Push → list, each expandable | — |
| Security overview | How your messages are protected | `Action` | Same page as Settings → Security, reachable from both | — |
| Rate PINGO | Leave a review | `Action` | Store link. **Never prompted** — this row is the only place it is ever mentioned | — |

---

## 13. Log Out

Not a section — the last row of the root, `danger`-styled, separated from the groups
above by 32px.

```
┌──────────────────────────────┐
│         Log out?             │
│                              │
│  Your messages stay on this  │
│  device unless you remove    │
│  them.                       │
│                              │
│  ☐ Also delete my messages   │
│    from this device          │
│                              │
│  ┌──────────┐ ┌───────────┐  │
│  │  Cancel  │ │  Log Out  │  │
│  └──────────┘ └───────────┘  │
└──────────────────────────────┘
```

| | |
| --- | --- |
| Dialog | Glass, scales from 0.97, 180ms |
| Copy | States what happens to local data — the thing users actually worry about |
| Checkbox | Unchecked by default. Checking it turns `Log Out` into `Log Out & Delete` and re-styles it `danger` |
| Confirm | `danger` filled, **not the gradient.** The gradient means "the thing to do," and logging out is not it |

When the checkbox is ticked, one reassuring line appears beneath it: *"They'll be back
when you sign in again."* Because messages live on the account, deleting the local copy
is genuinely safe — and saying so is what stops a user cancelling out of a dialog they
were right to complete.

**No warning about lost messages, ever.** Nothing is lost on logout under this
architecture, and inventing a risk to seem careful trains users to ignore real
warnings later.

---

## Settings search

The field at the root matches **every row's title and description across all
sections**. Results show the row's own control inline, so a toggle can be flipped
straight from search without navigating.

| | |
| --- | --- |
| Debounce | 150ms — settings data is local, so results are instant |
| Result row | Section breadcrumb as a caption above the row title |
| Match highlight | Medium weight on the matched substring |
| No results | *"Nothing matches 'xyz'."* plus the three most-visited settings |

---

*Previous: [03 — Profile, Communities, Calls](./03-social-and-calls.md) · Next: [05 — Components & Responsive](./05-components-responsive.md)*
