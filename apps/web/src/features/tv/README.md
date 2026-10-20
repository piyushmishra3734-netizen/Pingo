# Pingo TV — how the sources work

Read this before touching `TvStreamPlayer.tsx`, `TvHlsPlayer.tsx`,
`sourceProbe.ts` or the provider list. Every rule below exists because it was
broken in production first, and the bug was reported by a viewer, not by a test.

---

## The two kinds of source

| kind | what it is | what we know |
|---|---|---|
| `iframe` (default) | somebody else's player page, handed the whole rectangle | only that the host answered. Nothing inside is readable |
| `hls` | a resolver returns a `.m3u8` and `TvHlsPlayer` plays it | almost everything: the episode, its duration, its audio tracks, its codecs |

The `hls` sources come from FrameXTV's API (`api.framextv.tech`). They are the
better ones when they work — no page, so no pop-unders — and the worse ones when
they lie, which they do often. Both kinds stay in the lineup on purpose: the
iframes carry the libraries the resolver does not (Indian TV, new episodes).

---

## The invariants

These are the bugs. Do not undo them.

### 1. Never block the player on the probe

The probe runs in parallel with the player. If `activeStream` exists, the player
is mounted and playing *while the remaining sources are still being asked*.
The previous version gated rendering on a "probing" flag, and the result was a
source marked ready with no `<video>` element at all.

### 2. A source is only `ready` when the answer can be played

`probeResolver` walks **every** source the provider returns and requires all of:

- it is an m3u8 (`#EXTM3U`)
- its segments are not images (`playlistIsImages`) — several providers answer
  with a 200 m3u8 whose 2000+ segments are `.jpg`; that is a preview slideshow,
  it plays as a spinner that retries forever
- at least one variant says `avc1` (`playlistIsPlayable`) — Chrome on Windows
  cannot decode HEVC, and these servers offer 4K HEVC first
- the first segment answers a range request (only a definite "no" counts — a
  timeout is not evidence of a dead source)

### 3. A slow source is not a dead source

Barbarian needs ~11s because its source list has to be walked. The probe budget
was 9s, so it timed out and was recorded empty — every provider read as dead
while the same check passed from a script. The only difference was the clock.
Budgets: 18s per provider, 6s for the segment check.

### 4. Never swap a source that is playing

`onPlaying` sets `playingRef`. After it, the automatic choice is frozen:
a new playlist starts at 0:00, which the viewer sees as the film restarting.
`manualPickRef` (set only by tapping a source) is what stops the automatic
choice; a stray click anywhere must not.

### 5. Playback has to actually start

`<video>` with `autoPlay muted`. Browsers silently refuse unmuted autoplay
without a gesture: the manifest parses, the duration fills the timeline, and the
frame stays black — "it shows the length but the video never plays". `play()` is
also called on `canplay` / `loadeddata`, and the first tap or key press unmutes.

### 6. hls.js first, native second

`canPlayType('application/vnd.apple.mpegurl')` answers **"maybe" in Chrome on
Windows**, which has no HLS demuxer at all. Native playback is the fallback for
browsers without MediaSource (Safari), never the first choice.

### 7. Pin a decodable level

`hls.currentLevel` is set to the best `avc1` variant after `MANIFEST_PARSED`.
Left to ABR, hls.js picks the highest bandwidth, which is the HEVC one, and the
element reports `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4).

### 8. The finding screen must have an exit

`settled` starts false and normally clears when the stream reports playing. But
every source can fail to reach that, and the screen then never clears — reported
as "stuck on finding the best provider". Two escape hatches:

- if the probes are in and none is `ready`, settle immediately
- in any case, settle after 15s so the player and the source picker are reachable

### 9. Ids are not interchangeable

The resolver answers under its own name (`giant`); the lineup is keyed
(`fx-giant`). Re-key at the boundary or every probe reads as unanswered.
Also: the "last source" is remembered **per media type** (`pingo:lastSource:tv`),
because a source good for a film can have no episodes at all.

---

## Adding a source

1. Prove it answers with the right title before adding it:
   `curl -s <url> | grep -o '<title>[^<]*'`
2. Add an entry to `STREAM_PROVIDERS` with `buildUrl`, and add its id to
   `SOURCE_ORDER` for the media types it can serve. A source missing from an
   order is not offered for that type — that is how VidRock is movie-only.
3. For an `hls` source, also set `kind: 'hls'` and `apiProvider`.
4. Watch it play in the browser before claiming it works. A 200 is not a
   stream; the playlist has to lead to a decodable segment.

### Providers that were tested and removed

Recorded so nobody re-adds them by guesswork:

- **NHD Embed** — 403 LiteSpeed, invalid certificate
- **VidLink** — loads, spins forever
- **VidSrc.pm / .pk / .io / .buzz / .live / .ru / .su / 2embed** — the whole
  `vidsrc` family is unreachable from this region (connect timeouts, not bad
  paths), and `2embed.cc` embeds it, so it hangs on "Connecting to VidSrc Stream"
- **ApiPlayer** — play button, then never a stream
- **Videasy** — 403 without a Referer, 200 with one, and then a black frame
- **111movies** — parked domain
- **masterembed.\*** — parked; the real one is `embedmaster.link`

---

## Testing checklist

- Film, and an episode of a running show (the resolver indexes finished shows
  and not running ones — that gap is real and expected)
- An Indian title — `20453` (3 Idiots), `85518` (Khatron Ke Khiladi)
- The finding screen clears, and does not clear *late* on a working source
- The film does not restart by itself after 20s (source swap)
- `video.error` is null and `currentTime` advances
