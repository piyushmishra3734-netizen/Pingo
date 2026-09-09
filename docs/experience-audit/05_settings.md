# 05 · Settings — experience audit

Audited: all 18 settings routes. Read-only audit; nothing changed.

**Summary.** Settings has a real shared vocabulary —
`SettingsPage` / `Group` / `ToggleRow` / `InfoRow` / `ChoiceRow` in
`controls.tsx`, plus a shared `ScreenHeader` — and most pages use it faithfully.
Toggle behaviour is consistently instant-save, back navigation is uniform, and
Devices and Muted stories have better-than-average state handling. The problems
are concentrated: two destructive controls skip the confirmation every sibling
gets (one wipes all settings in a single tap), one destructive row is simply
dead, the settings *index* drops the divider treatment every subpage has, and one
CSS class in one shared component forces ALL CAPS headers across a dozen pages.
`prefers-contrast` is wired but — confirmed against `tokens.css` — changes no
colour anywhere, exactly as `05_accessibility.md §2` predicted.

---

## 1. Page inventory

| Route | Purpose | Loading | Empty | Error |
| --- | --- | --- | --- | --- |
| `/settings` | index + search | n/a | "Nothing matches" `:93-95` | n/a |
| `/account` | name, username, photo, sign-in | `PingoDot` `:67-75` | n/a | inline `:187-194` |
| `/password` | change password | n/a | Google-only branch `:82-95` | `messageFor()` `:159-199` |
| `/appearance` | theme, accent, motion, glass | n/a | n/a | n/a |
| `/notifications` | prefs | n/a | n/a | permission banner `:42-56` |
| `/notifications/debug` | push diagnostics | **missing** — `loading` only drives the Refresh button (`:220`) | rows say "none" (`:133-136,160`), indistinguishable from loading on first paint | **swallowed** — `push_health()` failure hidden (`:95`); token/delivery failures never surfaced |
| `/privacy` | switches, blocked list | `'…'` `:180-182` | "None" `:183` | `saveFailed` + rollback `:89-112,208-212` |
| `/chats` | chat prefs | n/a | n/a | n/a |
| `/wallpaper` | picker | `busy`, no spinner | n/a | inline `:294-298` |
| `/camera-snaps` | camera prefs | n/a | n/a | n/a |
| `/calls` | call prefs, mic test | n/a | n/a | `micError` `:104` |
| `/muted-stories` | muted authors | `LoadingState` `:63` | illustration `:64-83` | dropped by design `:49` |
| `/devices` | signed-in devices | `LoadingState` `:128` | `:129-132` | `loadFailed` distinct from empty `:71-85,167` — **best of the set** |
| `/storage` | usage, clear cache | `'-'`, no spinner | n/a | **none** — `clear()` has no catch `:37-47` |
| `/language` | voice / language | n/a | n/a | n/a |
| `/advanced` | debug logs, reset | n/a | n/a | n/a |
| `/controlling` | operator asset uploader | no skeleton | n/a | banners `:49-50,75-77` |
| `/help` | version, diagnostics | n/a | n/a | n/a |

---

## 2. Consistency audit

### Row height and dividers

Two competing row heights: index rows use `px-3 py-3.5 gap-3.5`
(`SettingsRow.tsx:81`); every subpage row from `ToggleRow`/`InfoRow`/`ChoiceRow`
uses `px-3 py-3 gap-3` (`controls.tsx:75,112,165,173`) — 4px shorter. A third,
`px-3 py-2.5`, appears only at `MutedStoriesScreen.tsx:90`.

**Dividers are the real offender.** `Group` draws a hairline between children via
`[&>*+*]:before:…bg-divider` (`controls.tsx:43-49`). **The index does not use
`Group`** — its four sections are raw `rounded-lg bg-surface p-1 shadow-sm`
blocks (`SettingsScreen.tsx:127,154,199,241`) with none of it. So the first
screen in Settings has rows running together while every page one tap deeper has
hairlines.

`AppearanceScreen.tsx` and `WallpaperScreen.tsx` do not use `SettingsPage`/`Group`
at all, hand-rolling header and section (`AppearanceScreen.tsx:54-58,226-242`;
`WallpaperScreen.tsx:274-286`). Both have real reasons — live preview, image grid
— but it means three row systems in one 18-page feature.

### ALL CAPS headers — one class, twelve pages

`controls.tsx:42` renders the group title `uppercase tracking-wider`
unconditionally. That component is used by Notifications, Privacy, Chats, Camera,
Calls, Storage, Devices, Language, Advanced, Help, Muted stories and Push
diagnostics.

The copy is **already title-cased** — `'privacy.groupReach': 'Who can reach me'`,
`'notif.groupAbout': 'What to notify me about'` (`catalog.ts:368,400`). The CSS
is the only thing shouting; the fix costs nothing in copy.

Meanwhile `AppearanceScreen.tsx:226-242` defines its **own** `Group` rendering
`text-h2 text-ink` — title case, no transform. Two components with the same name
and job disagreeing on the exact rule `03_navigation_and_layout.md §6` names.

### Toggles — consistent, and correctly so

Every preference toggle writes through `update()` on change with no Save button
(Notifications, Privacy `:89-112` with optimistic rollback, Chats, Camera, Calls,
Advanced). The three explicit-Save exceptions are documented design —
`AccountScreen.tsx:24-30` explains that a username is public and unique and needs
a deliberate commit. Not a bug.

### Destructive actions — the priority finding

| Control | Where | Confirms |
| --- | --- | --- |
| Logout | `useSignOut.ts:26-39` | yes |
| Clear local data | `AccountScreen.tsx:230-256` | yes |
| Remove a device | `DevicesScreen.tsx:97-107` | yes |
| Unmute an author | `MutedStoriesScreen.tsx:145-151` | yes |
| **Reset all settings** | `AdvancedScreen.tsx:55-59` | **no** |
| **Clear cache** | `StorageScreen.tsx:70-75` | **no** |
| **Delete account** | `AccountScreen.tsx:257` | **dead — no `onClick`** |

Two of six skip confirmation and one is a silent no-op, in an area where four
others get it right. Reset-all-settings is arguably the *most* consequential of
the six — one tap wipes every preference across every page
(`preferences.ts` → `SettingsContext.tsx:338`), no undo. This reads as oversight,
not a deliberate risk gradient.

Delete Account renders as inert red text in the same danger group as two working
rows. `InfoRow` gives no "not built" affordance, unlike `SettingsRow.tsx:124-125`
which labels unreachable destinations "Soon".

### Naming and back navigation

No same-concept-different-name drift found. A minor i18n gap: `PushDebugScreen`,
most of `AdvancedScreen` and most of `HelpScreen` use hardcoded English rather
than `t()`, so they miss the voice variant the rest of Settings supports
(`catalog.ts:1234-1246`). Back navigation is uniform — every page reaches
`ScreenHeader.tsx:46`'s `navigate(-1)`.

---

## 3. Accessibility — the corpus claim, confirmed

Wired: `SettingsContext.tsx:124` has
`PLAIN_QUERIES = ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)']`,
feeding `plainRequested()` (`:134-143`), forcing `resolvedGlass = 0` (`:261`),
written to `data-glass` (`:279`), overriding the user's own slider with a
documented rationale (`:248-260`).

And `packages/tokens/src/tokens.css` contains **zero** references to
`prefers-contrast` across 1,902 lines. The only conditional colour logic is
`data-glass` transparency (`:1835-1899`) and `data-theme`. So today
`prefers-contrast: more` does exactly one thing — flattens glass — and changes no
accent, text or border colour. `05_accessibility.md §2` is confirmed, not
refuted: PINGO ships half the answer.

---

## 4. Missing

- **A working Delete Account.** The most-expected control in a danger zone,
  present and non-functional. The page's own note (`AccountScreen.tsx:227`)
  explains honestly why it is not built — so the gap is intentional, but the dead
  row is not.
- **No confirmation that Reset succeeded** (`AdvancedScreen.tsx`) — every other
  write path in Settings gives status text.

---

## Top five fixes

1. **Confirm the two unconfirmed destructive actions.**
   `AdvancedScreen.tsx:55-59`, `StorageScreen.tsx:70-75`. Wrap both in
   `confirm({...})` exactly as `AccountScreen.tsx:243-253` does. Reset-all is the
   higher priority — it silently destroys every preference in the app. **Tiny**,
   ~15 lines across two files.

2. **Give Delete Account a real affordance or none.**
   `AccountScreen.tsx:257`. Either surface the existing note on tap, or strip the
   destructive styling so it reads as informational — matching how Account
   already treats phone and email as read-only rows. **Small.**

3. **Remove `uppercase tracking-wider` from `controls.tsx:42`.**
   One class, one shared component, ~12 pages corrected at once, no copy changes
   needed. Reconcile `AppearanceScreen.tsx:226-242`'s duplicate `Group` in the
   same edit so the two converge. **Tiny, and the highest-leverage line in the
   audit.**

4. **Give the settings index the divider treatment every subpage has.**
   `SettingsScreen.tsx:127,154,199,241` versus `controls.tsx:43-49`. Apply the
   same utility, or replace the sections with `Group`. **Small**, on the
   highest-traffic page in the feature.

5. **Add the increased-contrast token variant `prefers-contrast` promises.**
   Confirmed gap in `packages/tokens/src/tokens.css`. **Medium-large** — a token
   job spanning every semantic colour, needing design decisions the other four do
   not. Ranked last for that reason, not for lack of importance.
