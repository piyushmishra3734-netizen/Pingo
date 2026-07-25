# 10 — Media System

Every image, video, voice note, document and file. Media should feel instant, reliable,
beautiful and invisible.

---

## 0. The four rules everything else follows

**1 · The bubble appears immediately, at its final size.**
Never a placeholder that resizes when the real thing arrives. Dimensions are known before
the upload starts (from the local file) and sent with the message, so the recipient
reserves the right space before a byte of media arrives. Media that pops into a
placeholder shifts the layout under the reader (Law 5).

**2 · Media and message are separate objects.**
Losing media never loses the message. An expired, evicted or failed download leaves the
bubble present with a `Download again` affordance. This is what makes storage management
safe.

**3 · The local file is the source of truth until the server acknowledges.**
Nothing is deleted on a failed upload, ever. A user's only copy of a photo is not ours to
discard because a request timed out.

**4 · Every pipeline state is distinguishable, and `queued` is never `failed`.**
Same rule as the message queue ([07 § 2.2](./07-offline-sync.md#22-state-machine)) and for
the same reason: held-on-purpose and needs-your-help must never look alike.

---

## 1. Upload pipeline

### 1.1 States

| State | Bubble presentation | Reader announcement | Cancellable |
| --- | --- | --- | --- |
| **Queued** | Blur placeholder at full size, **100% opacity**, clock glyph | `"Photo, waiting to send"` | Yes |
| **Preparing** | Same, dots glyph | `"Preparing photo"` | Yes |
| **Compressing** | Same, dots glyph, `caption` shows `Compressing…` if > 1s | `"Compressing photo"` | Yes |
| *Encrypting* | *(future)* Same, dots. **Not in Phase 1** | `"Encrypting photo"` | Yes |
| **Uploading** | Determinate brand bar along the bubble's lower edge | `"Uploading photo"` — start and finish only | Yes |
| **Processing** | Indeterminate monogram dots | `"Processing photo"` | No — server-side |
| **Completed** | Normal bubble, media visible | Normal message announcement | — |
| **Failed** | 60% opacity, `danger` ring, `Not sent · Retry` | `"Photo not sent. Double tap to retry."` | — |
| **Retry** | Returns to `Uploading` from the last completed chunk | `"Retrying"` | Yes |
| **Cancelled** | Bubble removed, snackbar with `Undo` | `"Upload cancelled. Undo available."` | — |

**`Encrypting` is specified but not built.** It is a pipeline stage with a reserved slot,
so adding E2EE later inserts a state rather than restructuring the pipeline —
[01 § 10](./01-onboarding-auth.md#10-keeping-the-e2ee-upgrade-path-open).

### 1.2 Policy

| | |
| --- | --- |
| Resumable | Chunked. A 40MB video survives a tunnel and resumes from the last chunk, never from zero |
| Chunk size | 1MB on mobile data, 4MB on Wi-Fi |
| Concurrency | **2 uploads at a time.** More saturates a mobile uplink and slows everything, including the messages the user is trying to send |
| Ordering | Media and text interleave in composition order. A queued photo never jumps ahead of text sent after it |
| Retry | 1s, 2s, 4s, 8s, 16s, 30s, then every 30s. ±20% jitter |
| Marked failed | Only on a **definitive** server rejection — too large, unsupported, blocked recipient. **Never on a timeout** |
| Local copy | Retained until acknowledged. Never deleted on failure |
| Background | Continues in the OS background-transfer session. Survives app suspension |
| Large file on mobile data | Over 25MB: one-time inline caption with `Send anyway` / `Wait for Wi-Fi`. The latter holds it queued with a distinct caption |

### 1.3 Progress display

| Duration | Treatment |
| --- | --- |
| < 300ms | Nothing. The bubble simply appears complete |
| 300ms – 2s | Determinate bar, no label |
| > 2s | Determinate bar **plus** `2.4 MB of 8.1 MB` |
| Processing (unknown) | Monogram dots + `Processing` |

**Progress announces at start and finish only**, never per tick. Percentage
announcements every 100ms are torture on a screen reader
([06 § 1.4](./06-accessibility.md#14-live-regions)).

---

## 2. Download pipeline

| State | Presentation | Reader |
| --- | --- | --- |
| **Preview** | Blur placeholder + size badge, tap to download | `"Photo, 2.4 megabytes. Double tap to download."` |
| **Downloading** | Determinate ring over the placeholder | `"Downloading"` |
| **Paused** | Ring frozen, play glyph overlaid | `"Download paused. Double tap to resume."` |
| **Resume** | Continues from the last byte | `"Resuming download"` |
| **Retry** | Same as resume, after a failure | `"Retrying download"` |
| **Completed** | Media visible | Normal |
| **Cached** | Indistinguishable from completed | Normal |
| **Failed** | Placeholder + `Couldn't download · Retry` | `"Download failed. Double tap to retry."` |

| | |
| --- | --- |
| Auto-download | Per the Chats matrix — type × network ([04 § 3](./04-settings.md#3-chats)) |
| Manual | Tap the placeholder. Long-press for `Download` / `Save to gallery` / `Forward` |
| Pause | Automatic on network loss, resumes on reconnect. Manual from the long-press menu |
| Concurrency | 3 downloads at a time; thumbnails are exempt and always load |
| Failure | **Never replaces the bubble with an error.** Retry in place |
| Order | Visible media first. Scrolling reprioritises the queue toward the viewport |

**Scroll reprioritisation matters.** A user who scrolls past 40 photos to reach one should
not wait for the 40 they skipped.

---

## 3. Images

### 3.1 Loading ladder

Four tiers, so something is always on screen.

| Tier | Size | When |
| --- | --- | --- |
| **Blur placeholder** | ~20 bytes, 4×4 pixels inline in the message | Instant, before any request |
| **Thumbnail** | ≤ 200px, ≤ 15KB | Auto, always, on any network |
| **Display** | ≤ 1600px long edge | Per auto-download settings |
| **Original** | Full resolution | On explicit request in the viewer |

The blur placeholder ships **inside the message payload**, so it renders with zero
requests. This is what makes a thread scroll smoothly on a bad connection.

Progressive JPEG / AVIF where available, so the display tier sharpens rather than pops.

### 3.2 Compression presets

| Preset | Long edge | Quality | Typical |
| --- | --- | --- | --- |
| Data saver | 1280px | 65% | ~120KB |
| **Standard** *(default)* | 1600px | 80% | ~350KB |
| HD | 2560px | 90% | ~1.2MB |
| Original | unchanged | lossless | as-is |

| | |
| --- | --- |
| Format | AVIF where supported, WebP fallback, JPEG floor |
| Transparency | PNG preserved as WebP-lossless. Never flattened onto white |
| Animated | GIF → WebP/MP4, animation preserved |
| **EXIF** | **Stripped, always.** Location, device, timestamps. Orientation is applied then removed |
| Never re-compressed | An image already under the preset's budget passes through untouched |

**EXIF stripping is not a setting.** Location metadata in shared media is a privacy leak
most users do not know exists, and there is no legitimate reason to forward it. Related:
Camera → Geotag photos is off by default ([04 § 6](./04-settings.md#6-camera)).

### 3.3 Actions

| Action | Where | Notes |
| --- | --- | --- |
| Zoom | Viewer | Pinch, or double-tap. 1× → 8× |
| Pan | Viewer | 1:1 with the finger while zoomed |
| Swipe between | Viewer | Horizontal, within the conversation's media set |
| Swipe to dismiss | Viewer | Vertical; scales down and fades, follows the finger |
| Save | Viewer + long-press | To device gallery |
| Share | Viewer + long-press | OS share sheet |
| Forward | Viewer + long-press | In-app conversation picker |
| Copy | Long-press | Image to clipboard |
| Delete | Long-press | For me / For everyone. Snackbar undo |
| Info | Viewer `⋯` | Sender, date, dimensions, size |

---

## 4. Video

### 4.1 Presentation

| | |
| --- | --- |
| In thread | Poster frame at true aspect, glass play badge, duration badge lower-left |
| Poster | Extracted client-side at 1s, shipped with the message like the blur placeholder |
| Tap | Opens the viewer and plays |
| Long-press | Muted inline preview while held. Releases to stop |

### 4.2 Playback

| | |
| --- | --- |
| Delivery | HLS adaptive streaming above 10MB; progressive below |
| Ladder | 360p / 480p / 720p / 1080p, selected by measured throughput |
| Manual quality | In the viewer's `⋯`. Overrides adaptive until the video ends |
| Buffer | 10s ahead on Wi-Fi, 5s on mobile |
| Speed | 0.5× · 1× · 1.25× · 1.5× · 2×. Persists per conversation, not globally |
| Scrub | Thumbnail strip above the bar while dragging |
| Fullscreen | Rotates to the video's orientation; respects the OS rotation lock |
| Picture-in-picture | On background or explicit tap. Native PiP on iOS/Android, Document PiP on supporting browsers |
| Subtitles | *(future)* — the control slot is reserved in the viewer's `⋯` menu |

### 4.3 Autoplay rules

| Context | Behaviour |
| --- | --- |
| In thread | **Never.** Not on scroll-into-view, not muted, not ever |
| Long-press | Muted preview while held |
| Viewer | Plays on open, with sound |
| Moments | Plays on open, with sound |
| Gallery grid | Static poster only |

**Autoplay-on-scroll is prohibited.** It is the single clearest example of motion with no
state change (Law 3), it burns data the user did not choose to spend, and it is the
mechanic that makes feeds addictive.

### 4.4 Compression presets

| Preset | Resolution | Bitrate | Per minute |
| --- | --- | --- | --- |
| Data saver | 480p | 0.8 Mbps | ~6MB |
| **Standard** *(default)* | 720p | 2 Mbps | ~15MB |
| HD | 1080p | 5 Mbps | ~37MB |
| 4K | 2160p | 20 Mbps | ~150MB |

H.265/HEVC where both ends support it, H.264 otherwise. Audio AAC 128kbps mono for voice-
dominant content, stereo above. The estimate is shown **beneath each option in Settings**,
because "720p" means nothing and "~15MB per minute" means everything.

---

## 5. Voice notes

### 5.1 Recording

| | |
| --- | --- |
| Gesture | Press-and-hold the mic; slide up to lock hands-free |
| UI | **Replaces** the composer, never overlays it |
| Live waveform | Real-time amplitude, scrolling right to left |
| Duration | Running, tabular figures |
| Cancel | Slide left. Trash glyph scales up as it nears the threshold |
| Max length | 15 minutes, with a caption from 14:00 |
| Format | Opus 24kbps mono in Ogg — ~180KB per minute |
| Noise reduction | On by default. Off in Settings → Calls, which governs capture generally |
| Interruption | An incoming call pauses and preserves the recording as a draft |

### 5.2 Playback

| | |
| --- | --- |
| Waveform | **Precomputed and shipped with the message.** Never analysed client-side — decoding audio to draw a waveform is wasteful and janky in a list |
| Bars | Flexible width, `min 2px / max 3px`, so the waveform fits from 320px to desktop without overflowing the duration |
| Progress | Bars fill left-to-right as playback advances. The waveform **is** the progress bar |
| Seek | Tap or drag anywhere on the waveform. Keyboard: `←` `→` by 1s |
| Speed | 1× · 1.5× · 2×, cycled by tapping the duration. Persists per conversation |
| Continuous play | Consecutive unplayed notes auto-advance, with a 400ms gap |
| Background | Continues, with a media-session lock-screen control |
| Earpiece | Raising the phone to the ear switches to the earpiece, per platform convention |
| Resume | Interrupted playback resumes at its last position, not from zero |
| Transcription | *(future)* — a `Transcribe` slot is reserved in the long-press menu |

### 5.3 The Played state

A distinct delivery state from Read
([09 § 3](./09-notifications-presence.md#3-family-c--delivery-states)) — a user can open a
chat without listening, so conflating them would misreport.

| | |
| --- | --- |
| Sender sees | Double check + a small waveform glyph, brand-coloured |
| Recipient sees | Unplayed notes carry the purple dot on the play button; it clears on play |
| Privacy | Its **own** toggle. Can be off while read receipts are on, never the reverse |
| Threshold | Played means ≥ 90% listened, not merely started |

**Transcription must be on-device when it ships.** A server-side transcription service
would have to be removed the day E2EE lands, making it a feature regression — exactly the
trap listed in [01 § 10](./01-onboarding-auth.md#10-keeping-the-e2ee-upgrade-path-open).

---

## 6. Documents

### 6.1 Presentation

```
┌────────────────────────────────┐
│  ┌────┐  pingo-motion-spec.pdf │
│  │ 📄 │  2.4 MB · PDF          │
│  └────┘                        │
└────────────────────────────────┘
```

Icon in a rounded square, filename (2 lines max, then middle-ellipsis so the extension
stays visible), size and type.

**Middle-ellipsis, not trailing.** `pingo-motion-spec-final-v3.pdf` truncated at the end
loses the extension, which is the most useful part.

### 6.2 By type

| Type | Preview | Notes |
| --- | --- | --- |
| PDF | **In-app viewer** — pages, pinch-zoom, search, page count | The most-shared document type; a hand-off to the OS here is a poor experience |
| Word / Excel / PowerPoint | First-page render as a thumbnail | Full fidelity needs the real app; we do not attempt to reimplement it |
| Text / Markdown / code | In-app, monospace, syntax highlighting | Cheap and genuinely useful |
| Images sent as files | Thumbnail, opens in the media viewer | |
| Audio files | Inline player with a generated waveform | |
| ZIP | Icon + entry count. **No in-app extraction** | |
| **APK / EXE / DMG / installers** | Icon only, **no preview** | See § 6.3 |
| Unknown | Generic icon + extension. `Open with…` | Never claim a preview we cannot render |

### 6.3 Executables — safety

Installer files are the most common malware vector in messaging apps. Treatment:

| | |
| --- | --- |
| Auto-download | **Never**, on any network setting |
| Preview | None |
| Before download | A dialog naming the file, the sender, and the risk: *"This is an app installer. Only open files from people you trust."* |
| Install | **Never one-tap.** Hand off to the OS installer, which has its own confirmation |
| Sent by a non-contact | An additional inline caption: *"You don't have this person in your contacts."* |
| Styling | The row is neutral, **not `danger`** — most such files are legitimate. This is a caution, not an accusation |

**The dialog is unusual for PINGO** — we prefer undo to confirm — but installing software
is genuinely irreversible, and the undo pattern cannot apply.

---

## 7. Gallery

Per conversation, per community, and per profile.

| View | Layout |
| --- | --- |
| **Timeline** *(default)* | Grouped by month, sticky month headers, newest first |
| **Grid** | Uniform squares, 3 / 4 / 5 columns by breakpoint, densest scan |
| **Albums** | Auto-grouped: Photos · Videos · Voice · Documents · Links |
| **Shared media** | Everything in this conversation |
| **Favourites** | Starred items, protected from auto-cleanup |

| | |
| --- | --- |
| Search | Filename, sender, date, type. Free text matches filenames and captions |
| Filters | Type · Sender · Date range · Starred · Downloaded-only |
| Sort | Newest · Oldest · Largest |
| Multi-select | Long-press to enter. Save, Share, Forward, Delete, Star |
| Selection feedback | Tile scales to 0.96 with a brand-numbered badge showing order |
| Tile aspect | Real aspect in Timeline, forced square in Grid. Timeline reads as a collection; Grid reads as an index |

---

## 8. Camera

| Control | Options |
| --- | --- |
| Mode | Photo · Video, swipe or tap to switch |
| Shutter | The **only** gradient element on screen |
| Flip | Front / rear, with a 180ms preview cross-fade |
| Flash | Off · On · Auto (photo). Torch (video) |
| HDR | On / Off. **Hidden entirely** where unsupported — never a disabled row for missing hardware |
| Aspect | 4:3 · 16:9 · 1:1 |
| Grid | Rule-of-thirds overlay |
| Level | Horizon guide |
| Timer | Off · 3s · 10s |
| Zoom | Pinch, plus 1× / 2× shortcuts where lenses exist |
| Mirror front | On by default — selfies save as you saw them |

| | |
| --- | --- |
| Review | **Mandatory.** Capture → review screen with `Send` / `Retake` and an optional caption. Never sends straight from the shutter |
| Permissions | Requested at the moment of use, never on screen entry. Denied → an inline explanation with a Settings link. No modal, no repeat prompt |
| Shutter sound | Follows the setting, locked on in regions that legally require it with a caption explaining why |

---

## 9. Network awareness

### 9.1 Presets by connection

Measured throughput, not the reported radio type — a "5G" connection in a lift is 2G.

| Detected | Image | Video | Auto-download |
| --- | --- | --- | --- |
| Wi-Fi | Standard | Standard | Per settings |
| 5G / fast | Standard | Standard | Per settings |
| 4G | Standard | Data saver | Photos only |
| 3G / slow | Data saver | Data saver | **Thumbnails only** |
| Metered / hotspot | Data saver | Data saver | Thumbnails only |
| Offline | Queued | Queued | None |

### 9.2 Rules

- **The user's explicit choice always wins.** These are defaults for `Auto`, never
  overrides. A user who set HD gets HD.
- **Uploads always proceed** regardless of network, because the user explicitly chose to
  send. Only *receiving* is throttled by network.
- **Detection is measured, and re-measured** every 30s during a transfer. Adaptation is
  silent.
- **Never a "poor connection" warning.** The behaviour adapts; a banner about it is noise
  the user cannot act on.

---

## 10. Cache & storage

### 10.1 Retention priority

Highest survives longest.

| Priority | Content |
| --- | --- |
| 1 · Never evicted | Drafts · queued uploads · starred · downloaded-for-offline |
| 2 | Media in pinned conversations |
| 3 | Media from the last 7 days |
| 4 | Frequently viewed (≥ 3 opens) |
| 5 | Recently viewed (last 30 days) |
| 6 · Evicted first | Everything else, oldest first |
| — | Thumbnails: **kept even when originals are evicted** |

**Thumbnails survive eviction.** They are ~15KB and they are what keeps an evicted gallery
looking like a gallery rather than a wall of grey boxes.

### 10.2 Cleanup

| | |
| --- | --- |
| Automatic trigger | Device free space < 500MB, or the user's configured cap |
| Automatic behaviour | Silent, lowest priority first, thumbnails retained |
| Auto-delete old media | Never · 30 days · 90 days · 1 year. Removes media, **keeps messages** |
| Manual | Storage screen: by conversation, by type, or `Free up space` for the largest items with a running total |
| Cache clear | **No confirmation** — nothing is lost |
| Media delete | **Always confirmed** — it cannot be recovered |

The distinction in those last two rows is whether the data can be rebuilt.

### 10.3 After eviction

The bubble stays and shows `Media removed · Download again` — the **same** state as media
never downloaded, so the pattern is already familiar and eviction is never a surprise.

---

## 11. Error handling

| Error | Presentation | Recovery |
| --- | --- | --- |
| Upload failed — network | Silent, auto-retry with backoff. Stays `queued` | Automatic |
| Upload failed — rejected | Inline on the bubble with the specific reason | Retry, or delete |
| Upload failed — too large | `Too large to send · 64 MB limit`, offered at a lower quality | Re-compress and retry |
| Download failed | Placeholder + `Couldn't download · Retry` | Tap |
| File corrupted | `This file seems damaged` + `Ask sender to resend` | Request resend |
| Unsupported format | Icon + extension + `Open with…` | OS hand-off |
| Insufficient storage | Dialog: `Not enough space` + `Free up space` linking to Storage | Cleanup, then auto-retry |
| Permission denied | Inline where the control is, Settings link | Grant, or don't |
| Network lost mid-transfer | Auto-pause; resumes at the same byte on reconnect | Automatic |
| Codec unsupported | Falls back down the ladder; if none work, `Download to open` | Download |
| Camera unavailable | Inline: *"Camera is in use by another app."* | Retry |

**Copy rules** ([06 § 7](./06-accessibility.md#7-cognitive-accessibility)): name what
happened, name what to do, never blame the user, never lead with a code.

---

## 12. Media viewer

```
┌──────────────────────────────┐
│  ✕                        ⋯  │  ← auto-hiding chrome
│                              │
│                              │
│         [ media ]            │
│                              │
│                              │
│  Anaya · Today 11:31         │
│  ⤓  ↗  ⇄  🗑                 │
└──────────────────────────────┘
```

| Gesture | Result |
| --- | --- |
| Pinch | Zoom 1× → 8×, focal point under the fingers |
| Double-tap | Toggle 1× ↔ 2.5×, centred on the tap |
| Drag while zoomed | Pan 1:1, with edge resistance |
| Swipe horizontal | Previous / next in this conversation's media |
| Swipe down | Dismiss — scales down and fades, following the finger |
| Single tap | Toggle chrome |
| Rotate | Two-finger rotate in 90° steps, snapping on release |
| Long-press | Context menu |

| | |
| --- | --- |
| Open transition | The tile **expands from its position** to full-bleed, 320ms water. Not a fade — the expansion is what tells the user where they came from and where dismissing returns them |
| Chrome | Auto-hides after 4s. Returns on tap. **Fade only, never slide** |
| Background | `ink` at 96%. Not pure black — it must read as an overlay, not a different app |
| Actions | Save · Share · Forward · Delete · Info |
| Counter | `3 of 24`, top-centre, only when chrome is visible |
| Keyboard | `←` `→` navigate · `+` `−` zoom · `0` reset · `Esc` close · `S` save |

---

## 13. Accessibility

| Requirement | Behaviour |
| --- | --- |
| **Image descriptions** | Sender may add alt text when attaching, via `Add description` in the review screen. Announced in place of the generic label |
| No description | `"Photo from Anaya, 11:31 AM"` — sender, type, time. Never just `"Image"` |
| Video | `"Video from Anaya, 24 seconds, 11:31 AM"` |
| Voice note | `"Voice message from Anaya, 12 seconds. Slider. Double tap to play."` |
| Document | `"PDF, pingo-motion-spec.pdf, 2.4 megabytes, from Alex"` |
| Media controls | All labelled. Play/pause announces its **resulting** state |
| Waveform | An adjustable `slider` with `aria-valuetext` as `"4 seconds of 12"` |
| Progress | Announced at **start and finish only**, never per tick |
| Keyboard | Every viewer gesture has a key equivalent (§ 12) |
| Gesture parity | Pinch → `Zoom in` / `Zoom out` actions. Swipe-dismiss → `Dismiss` action |
| Dynamic type | Filenames, captions and durations scale. **Viewer chrome does not** — controls stay 44px |
| Reduced motion | The viewer **cross-fades** instead of expanding. Zoom and pan still follow the finger — a drag that does not track is broken, not calm |
| Captions | *(future)* — a slot is reserved in the viewer's `⋯` |
| Autoplay | Already prohibited in-thread, which removes the most common media a11y complaint outright |

---

## 14. Future-ready — and a constraint on it

The architecture must allow AI image search, OCR, translation, object recognition, face
blur, smart albums and cloud optimisation without redesign.

### 14.1 The seams

| Capability | Seam that makes it additive |
| --- | --- |
| AI image search | `service.search()` already abstracts search. A media index is a new implementation behind it |
| OCR | Text extracted into a `searchText` field on the attachment. Nothing else changes |
| Translation | Captions and OCR text are already separate fields from the media |
| Object recognition | Labels become another attachment field, feeding search and albums |
| Face blur | An editing step in the **review screen**, which already exists between capture and send |
| Smart albums | The Albums view is already a query over attachments. A new album is a new query |
| Cloud optimisation | The four-tier loading ladder means a new tier or a new codec is a URL change |

### 14.2 The constraint — and it is the important part

**Every one of these must be implemented on-device, not server-side.**

Not for ideological reasons. Because
[01 § 10](./01-onboarding-auth.md#10-keeping-the-e2ee-upgrade-path-open) records the trap:
*do not build server-side features that E2EE would have to remove.* A server that performs
OCR on a photo must be able to read the photo. Ship server-side OCR now, and the day E2EE
lands it becomes a **feature regression** — users lose search they had grown to rely on,
and the encryption launch arrives with a list of things that got worse.

| Capability | Required implementation |
| --- | --- |
| OCR | On-device (Vision / ML Kit / WebAssembly) |
| Object recognition | On-device |
| Face blur | On-device, **before upload** — the point is that the server never sees the face |
| Transcription | On-device |
| Translation | On-device, with downloadable language packs ([04 § 10](./04-settings.md#10-language)) |
| Image search | Local index over on-device extraction |
| Cloud optimisation | **Acceptable server-side** — it is transcoding, not comprehension. Revisit at E2EE, when it becomes client-side transcoding |

Cloud optimisation is the single exception, and it is flagged as needing revisiting rather
than being safe forever.

---

## 15. Testing requirements

| Scenario | Expected |
| --- | --- |
| Send a 40MB video, kill the network at 60% | Resumes from 60%, not 0% |
| Send 10 photos, background the app | All complete via background transfer |
| Send a photo offline | `Queued` with a clock glyph, sends on reconnect, order preserved |
| Scroll a 500-item gallery on 3G | Thumbnails only, no jank, no layout shift |
| Open a photo with EXIF GPS | Metadata absent from what is sent |
| Fill device storage, then receive media | Cleanup runs silently; nothing starred or pinned is lost |
| Receive media, then let auto-delete expire it | Bubble intact with `Download again` |
| Play a voice note, take a call, return | Resumes at the same position |
| Voice note at 320px width | Waveform fits; the duration never overlaps |
| Receive an APK | No auto-download; the caution dialog appears |
| Media viewer with a screen reader | Every action reachable without a gesture |
| Reduced motion + open the viewer | Cross-fade, not expansion; pinch still tracks the finger |

---

*Previous: [09 — Notifications & Presence](./09-notifications-presence.md) · Next: [11 — Performance Budget](./11-performance-budget.md)*
