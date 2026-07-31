# PINGO — backing up complete history

**Status:** design. No code written.
**Supersedes:** the cache-snapshot assumption in
[effortless-backup-plan.md](./effortless-backup-plan.md) and
[e2ee-relay-and-backup-plan.md](./e2ee-relay-and-backup-plan.md).
**Requirement:** a backup represents the user's complete available history, not
whatever happens to be cached.

---

## 0. What is actually wrong today

The archive is built from the local database, and the local database is a cache:

```
chat-service.ts:1309   "answering it from a cache of the newest fifty"
storage-architecture.md:251   eviction may drop cached history
```

`writeMessageRows` stores whatever page was fetched, so a two-year account that
has never been scrolled back holds a recent archive, not a two-year one. Nothing
in the product says so, which is the part that makes it a defect rather than a
limitation.

**"Complete" has an upper bound worth naming:** everything the server still
holds and RLS lets this user read. It cannot include messages deleted for
everyone, conversations cleared before the fetch, or — once retention shortens —
anything already expired. §6 is about that last one, and it is the sharpest
constraint in this document.

---

## 1. The shape of the change

The archive stays a snapshot of local storage. **What changes is that local
storage is made complete first.**

```
backfill        server ──page──▶ row store        (new, resumable, incremental)
archive         row store ──chunk──▶ Drive        (unchanged)
```

This is deliberately the smallest change that satisfies the requirement. Every
property already verified — chunk binding, generations, atomic commit, resumable
upload, archive/recovery key isolation — is a property of the second stage and
survives untouched. Nothing about how an archive is made changes; only what it
finds when it looks.

The alternative — streaming from the server directly into archive chunks —
avoids growing local storage and was rejected: it re-downloads the entire
account on every backup, cannot answer "how much is left" during the run, and
puts the network inside the AEAD loop, where a stall becomes a failed archive
rather than a slow one.

---

## 2. Backfill

### 2.1 Cursors

One record per conversation, sealed like everything else:

```
backfill:<conversationId>
  oldestFetchedAt   timestamptz    how far back this device has walked
  oldestFetchedId   uuid           tie-break for identical timestamps
  complete          boolean        the server has confirmed there is no more
  lastRunAt         number
```

`complete` is what makes future backups cheap. A conversation that has been
walked to its beginning is never paged again — new messages arrive through the
existing delta sync, which already keeps the newest end current.

### 2.2 The loop

For each conversation, oldest-first paging through the existing primitive:

```
listMessages(conversationId, { before: oldestFetchedId, limit: 50 })
  → writeMessageRows(conversationId, page)     ← already sealed, already batched
  → advance cursor
  → until the server returns a short page
```

**A short page does not reliably mean the end of history**, and the code says so:

```
chat-service.ts:318   "Reaching this returns a short page, which the caller
                       reads as the end of history — wrong, but bounded"
```

`MAX_PAGE_READS` exists to bound a refill loop when hidden messages eat a page.
Backfill must therefore not treat a short page as terminal. It confirms the end
with a count query for messages older than the cursor, and only then sets
`complete`. Getting this wrong silently truncates every future backup, and the
truncation is invisible because the archive would still verify perfectly.

### 2.3 Memory

Bounded by construction at both stages, and never by account size:

| Stage | Held at once |
| --- | --- |
| Backfill | one page — fifty messages — written and released |
| Archive | one chunk buffer, measured at 2.00 MB against a 1 MB chunk |

Nothing materialises the account. A hundred thousand messages and a hundred
occupy the same peak.

### 2.4 Resumability

The cursor *is* the resume point, and it is persisted after each page. An
interrupted backfill resumes at the conversation and offset it reached; a
completed conversation is skipped entirely. There is no separate resume state to
keep consistent, which is the reason to put the cursor in the same store as the
rows it describes.

---

## 3. The preflight summary

Shown before anything is fetched, so the user consents to the cost:

```
Ready to Back Up
  Chats            412
  Messages      38,204
  Media          1.2 GB          (v2)
  Documents         86
  Photos         2,310
  Videos           148
  Estimated size  47 MB
```

Counts come from aggregate queries with `Prefer: count=exact` and `Range: 0-0`,
which return a count header and no rows — cheap, and no history is transferred
to produce the estimate. Size is estimated from the measured ratio: sealing adds
16 bytes per chunk, so archive size is essentially plaintext size, and plaintext
size per message is known from the row store's own average.

**The estimate is labelled an estimate.** A number presented as exact and then
missed by 30% is worse than a range.

### 3.1 Progress

The stages the user sees map one-to-one onto the stages above, which is what
lets the progress be honest rather than decorative:

| Shown | Actually happening |
| --- | --- |
| Preparing chats… | counting, planning, resuming cursors |
| Downloading older history… | §2 backfill, with *n of m* conversations |
| Encrypting… | `buildArchive` pass one and two |
| Uploading to Google Drive… | streaming chunk upload, bytes sent |
| Backup complete | HEAD committed |

---

## 4. Avoiding repeat downloads

Three mechanisms, in order of how much they save:

1. **`complete` cursors** — a fully walked conversation is never paged again.
2. **Delta sync already owns the newest end** — messages arriving after the last
   backup are fetched by the existing cursor, not by backfill.
3. **The archive is rebuilt from local storage**, so a second backup with no new
   history performs *no network reads at all* before encrypting.

Steady state: the first backup is expensive once, and every later one costs
roughly what it costs today.

---

## 5. Interaction with media (v2)

Media inverts the trade. Messages are small and worth persisting; media is the
bulk and is currently re-fetchable from storage buckets.

So media should **stream from bucket to archive chunk without landing in the
local database** — the opposite of the message path — because persisting
gigabytes to make a backup faster is not a good exchange on a phone.

That holds only while the buckets keep the media. Once retention deletes it,
the archive becomes the sole copy and the calculus changes; that is a decision
for v2, and it is recorded here so it is not made accidentally.

---

## 6. Interaction with retention — the sequencing constraint

This is the part that constrains the roadmap rather than the code.

**Backfill can only reach as far back as the server still holds.** Shortening
retention to thirty days does not merely reduce what the server stores — it
permanently caps what any future backup can ever contain, for every user who
has not yet completed a backfill.

Therefore:

1. Complete-history backup ships **before** retention is reduced.
2. Retention is not reduced for an account until that account has a **completed
   backfill and a verified archive**. Per-account, not global.
3. Until both hold, the thirty-day window stays.

Reducing retention first would silently destroy history that no backup had yet
captured, and the loss would be undetectable — the archive would verify, restore
cleanly, and simply not contain the messages.

---

## 7. What changes, concretely

| Area | Change |
| --- | --- |
| New | `backfill.ts` — cursors, the paging loop, end-of-history confirmation |
| New | `preflight.ts` — counts and size estimate from aggregate queries |
| Changed | `archiveLines` — unchanged in shape; it simply finds a complete row store |
| Changed | Backup UI — preflight summary, four-stage progress |
| Unchanged | Archive format, chunking, generations, atomic commit, resumable upload, key isolation, `BackupTarget` |
| Verification | Backfill resume mid-conversation; short-page must not end history; second backup performs no fetches; cursor survives interruption; preflight matches actual |

## 8. Risks

- **Local storage grows to the size of history.** Measured: 10,000 messages is
  3.6 MB of plaintext, so 100,000 is around 36 MB. Acceptable for text;
  decisively not for media, which is why §5 keeps media out of the local store.
- **Eviction now conflicts with backup completeness.** A store that may be
  evicted cannot be the sole source of a complete archive. Eviction must skip
  rows not yet archived, or backfill must re-run before each backup.
- **First backup on a large account is slow.** It is bounded, resumable and
  shown honestly, but it is minutes rather than seconds and the preflight has to
  say so.
- **A short page misread as the end of history truncates every future backup
  silently.** The most dangerous failure in this document, and the reason §2.2
  confirms the end rather than inferring it.
