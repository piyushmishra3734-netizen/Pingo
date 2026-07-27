# Profile module — testing report

**Date:** 27 July 2026
**Built against:** `https://pingochat.pages.dev` (Cloudflare Pages, `main`)
**Database:** Supabase `lppzoqgvshhmxqsvggug`
**Commits:** `cc3fea9` → `f66dd29`

Every result below was produced by driving the deployed app in Chrome or by
querying the live database. Nothing here is inferred from reading code.

---

## 1. What was built

| Spec item | State |
| --- | --- |
| Two profile states (mine / someone else's) | Built |
| Top bar: Back, no centre, menu (☰ / ⋯) | Built |
| Large circular photo, tap to view, pinch, swipe down to dismiss | Built |
| Long press photo → change / remove | Built |
| Display name, username below | Built |
| Bio: multi-line, emoji, website, mentions | Built |
| Three stats — Posts, Friends, Groups, animated | Built |
| Edit Profile / Share Profile | Built |
| Edit: picture, name, username, bio | Built |
| Share: QR, copy link, native share | Built |
| Two tabs: Posts, Media | Built (see §6) |
| Posts: max 3, permanent, 3-column grid | Built, enforced in the database |
| Fourth upload → replace dialog | Built |
| Media: private, owner only, from chats, grid | Built |
| Post viewer: like, comment, share, save, caption, mentions, hashtags, likes, date | Built |
| Own post menu: edit, replace, delete | Built |
| Friendly empty state | Built |
| Other profile: Message, Voice, Video; Add Friend when not friends | Built |
| Other menu: Share, Copy Link, Mute, Block, Report | Built |
| Shared With You | Built |
| Private profile architecture | Prepared, not implemented (see §8) |
| Followers / Following / Highlights / Stories / Reels / Suggested / Dashboard / Feed / Explore / Ads | Not built, as instructed |

---

## 2. Desktop — pass

Chrome, 1920×897.

| Test | Result |
| --- | --- |
| Own profile renders: photo, name, `@handle`, 3 stats, both buttons, both tabs | Pass |
| Stats animate from previous value, not from zero | Pass |
| Publish a post (file → editor → caption → Share) | Pass — `Posts` 0 → 1 |
| Caption renders `@mention` as a link, `#hashtag` styled, URL as an anchor | Pass |
| Like | Pass — filled, count 0 → 1, survives reload |
| Like distinguishes mine from other people's | Pass — with two likers, unliking left the count at 1 with the heart unfilled |
| Comment: post, author name and photo resolved, count increments, input clears | Pass |
| Comment offers Delete to the comment's author and to the post's owner | Pass |
| Edit caption → post shows "· edited" | Pass |
| Delete post → confirmation names the action, grid and stat update | Pass |
| Replace flow (see §5) | Pass |
| Media tab lists chat photos with "Only you can see this" | Pass |
| Share sheet: QR, link, Copy link, Share… | Pass |
| Someone else's profile: Message + call buttons, no Media tab | Pass |
| Call buttons disabled until mutual, with a label saying why | Pass |
| Shared With You on a friend's profile | Pass — "Friends since 27 Jul 2026", "Photos shared 1"; the zero row is omitted rather than shown as 0 |
| Person menu: Share, Copy link, Mute/Unmute, Block, Report | Pass |
| Block → notice appears, menu flips to Unblock; Unblock reverses it | Pass |
| Report: six reasons, detail box, confirmation | Pass |
| Edit profile: username validation | Pass — too short, taken, available, unchanged all correct |
| `/profile/edit` does not resolve as a username | Pass |

## 3. Mobile — pass

Measured in a real 390×844 same-origin frame, not by scaling a screenshot.

| Test | Result |
| --- | --- |
| Horizontal overflow at 386px | None — `scrollWidth` 386 against a 386 viewport |
| Widest painted element | 386px, exactly the viewport |
| Layout: photo, name, stats, buttons, tabs all stack correctly | Pass |
| Someone else's profile at 386px | Pass, no overflow |
| Touch targets ≥ 44px | Pass **after a fix** — Back and the profile menu measured 40×40 and now carry `touch-target` |
| Swipe down to dismiss the photo | Pass — image tracks the finger (50px, 160px) and dismisses past the threshold |
| Pinch to zoom | Pass — 100px → 300px spread produced exactly `scale(3)`; pinching back clamped to 1 and recentred |
| A two-finger pinch does not trigger the one-finger dismiss | Pass |

## 4. Accessibility — pass

| Test | Result |
| --- | --- |
| Stats read as pairs | Pass — "Posts 1, Friends 1, Groups 0"; the animating number is `aria-hidden` and the final value is what is announced |
| One `h1` per page | Pass **after a fix** — the name and the header title were both `h1`; the name is now `h2` at the same size |
| Tabs: `role="tab"`, `aria-selected`, `aria-controls`, panels `aria-labelledby` and `hidden` | Pass |
| Post tiles carry the caption as their accessible name | Pass |
| Photo button says what tap and hold do | Pass |
| Disabled call buttons explain the gate rather than going silent | Pass |
| Sheets: `role="dialog"`, `aria-modal`, `aria-labelledby` | Pass |
| Focus moves into a sheet on open | Pass |
| Escape closes the innermost surface first | Pass |
| Focus returns to the opener on close | Pass |
| Tab order matches visual order | Pass |
| No positive `tabindex` anywhere | Pass |
| Reduced motion honoured | Pass — the shipped stylesheet carries a `prefers-reduced-motion` block reducing every animation and transition to 0.01ms, and the counter skips its animation entirely rather than shortening it |
| Errors announced | Pass — `role="alert"` on the comment, caption and report failures |

## 5. The three-post cap — pass

The rule that a profile holds three posts, permanently.

| Test | Result |
| --- | --- |
| Grid shows dashed empty slots on your own profile only | Pass |
| Publishing fills a slot | Pass — 1, 2, 3 |
| At three, no empty slot remains | Pass |
| A full profile can still start a post | Pass **after a fix** — see §7 |
| Menu reads "Replace a post — A profile holds three" when full | Pass |
| Replace dialog shows the three posts to choose between | Pass |
| Replacing keeps the row, so likes and comments survive | Pass — the row id was unchanged and `updated_at` moved |
| The replaced image is removed from storage | Pass — three posts, three objects, each referenced exactly once, no orphan |
| **The cap is enforced by the database, not just the UI** | **Pass** — a direct fourth `INSERT` was rejected with `PT001` and left no row |
| Deleting a post cascades its likes and comments and removes its image | Pass — after deleting all three: 0 posts, 0 comments, 0 likes, 0 storage objects |

## 6. The QR code

Written rather than installed — no QR library exists in the project and the
artifact CSP blocks a CDN. Byte mode, error correction M, versions 1–6.

| Test | Result |
| --- | --- |
| Output matches a reference encoder | Identical, module for module, at any forced mask, for all 106 payload lengths the format supports |
| Round-trips through an independently written decoder | Pass for all 110 test payloads — including a Reed-Solomon syndrome check, so the error correction is genuinely valid and not merely present |
| **The code actually painted on the live page decodes** | **Pass** — read back out of the rendered SVG path: EC level M, mask 2, syndromes zero, decoded to `https://pingochat.pages.dev/profile/kashish_` |
| Structure | Pass — version 4 for a 43-byte URL, all three finder patterns exact, dark module set |

Two bugs were found and fixed by this comparison: the format information field
was written transposed, and the pad-byte run alternated on the wrong index —
the latter corrupted every message whose data ended on an odd codeword, which
is half of them.

Still outstanding: nobody has pointed a phone camera at it. Every check above
is software reading software. It is worth one physical scan.

## 7. Bugs found and fixed during testing

All of these were found by using the deployed app, not by reading the code.

1. **The post viewer stole focus back from its own comment box.** The close
   button was focused in the same effect as the Escape handler, so it re-ran
   whenever the comments opened — and, because every caller passes an inline
   `onClose`, on every parent render. The typed comment went nowhere and Enter
   pressed Close. Fixed by splitting initial focus into its own effect. The
   image viewer had the same shape and would have yanked focus mid-pinch.

2. **Comments were impossible.** Every insert returned 400. The read asked
   PostgREST to embed `profiles` through `post_comments_author_id_fkey`, but
   that key pointed at `auth.users` — the relationship named in the query did
   not exist. The author now references `public.profiles`, which is the same
   id and cascades the same way.

3. **…and the failure was invisible.** The `catch` swallowed it on the theory
   that leaving the text in the box was recovery enough. A rejected comment
   looked exactly like one that was never sent. It says so now.

4. **`listFollowRequests` had the identical defect and has had it since it
   shipped.** Every caller wrapped it in a `catch`, so a query that could never
   run read as a user with no pending requests. Rewritten as two reads rather
   than repointing the keys on `follows`, which the whole follow gate stands on.

5. **A full profile could not post a fourth.** The empty slots are what start a
   post and there are none at three, so the replace flow — the entire reason
   the cap has a dialog — was unreachable from a profile that had reached it.
   The profile menu now carries the action and names which of the two things it
   will do.

6. **Removing a profile photo did nothing.** `update` keyed each field on
   `!== undefined`, so passing the key with no value — the only way to say
   "clear this" — read as "not mentioned". Presence of the key now decides.

7. **Two `h1`s on one page**, leaving a screen reader without a single answer to
   what the page is.

8. **Back and the profile menu were 40px targets**, the only two on the page
   under the 44px bar. `ScreenHeader` owns Back, so this fixed every secondary
   screen at once.

9. **A sheet took focus off its own field.** React runs a child's effects before
   its parent's, so content carrying `autoFocus` lost it a frame later. The
   caption editor opened with the cursor nowhere.

## 8. Deliberate decisions, stated rather than hidden

- **The Media tab exists only on your own profile.** It shows pictures from your
  conversations, some sent to exactly one person. On somebody else's profile it
  could only ever be empty, and an always-empty tab wearing a lock is a
  placeholder. So the bar has two tabs on your profile and one on everyone
  else's. This is the one place the layout is not identical between the two
  states.

- **No shared-element animation on the profile photo.** A real one needs source
  and destination in one layout; the viewer is portalled to `document.body`
  precisely so an ancestor's transform cannot clip it. The two requirements are
  in direct conflict. It opens with a fade, which always works, rather than a
  flight that lands wrong whenever the page has scrolled.

- **"Add friend", not "Follow".** The profile counts *Friends* and the thing that
  makes one is both people agreeing. A button reading Follow above a number
  reading Friends asks the reader to translate, and one-way is exactly what the
  gate is not. `FollowButton` is used only here, so nothing else changed.

- **Muting from a profile mutes always.** The durations sheet belongs to the chat
  list, where mute is a bulk action across rows. On one person's profile it is a
  decision about them, not a timer.

- **Hashtags are styled but do not navigate.** There is no search over tags and no
  explore surface to land on. A hashtag that looks tappable and is not is worse
  than one that simply reads as a hashtag.

- **Private profiles: architecture prepared, not implemented**, as instructed. The
  follow request / accept flow already is the gate — `follows` carries
  `pending` and `accepted`, and `is_mutual()` is what stories are filtered
  through. Making a profile private needs a visibility column and a policy on
  `posts`; it needs no new concept.

- **The Media tab lists photos only.** Voice notes and documents are media in a
  chat but not in a grid; a column of grey file tiles is not what the tab is
  for.

## 9. Performance — pass

| Measure | Result |
| --- | --- |
| DOMContentLoaded | 427ms |
| Load | 537ms |
| Long tasks over 50ms | **0** |
| DOM nodes on the profile | 138 |
| JS heap | 30MB |
| Post images | `loading="lazy"`, `decoding="async"` |
| Signed image URLs | 1 hour, so a grid does not break while the tab is open |
| Likes, saves and comment counts | Three small reads, bounded at three posts |
| QR encoding | Memoised per link; eight mask candidates is sub-millisecond at this size |

## 10. Known gaps

- The QR has not been scanned by a physical camera. Everything else about it is
  verified; this one step is not something software can do for itself.
- Group counts read 0 for every account tested, because no test account belongs
  to a group. The query is the same shape as the friends count, which does
  return a correct non-zero value, but the group path has not been exercised
  against real data.
- Reduced motion is verified from the shipped stylesheet and from the counter's
  own `matchMedia` check, not by toggling the OS setting.
- `onForward` in the chat remains a no-op. Unrelated to this module, still open.

## 11. Verdict

Desktop passes. Mobile passes. Accessibility passes. Performance passes. Nine
bugs were found and all nine are fixed; four of them made a feature silently do
nothing, which is the failure mode this product is least willing to ship.

All test data was removed: zero posts, comments, likes, blocks, reports and
storage objects remain.
