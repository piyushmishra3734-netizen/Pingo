# PINGO — backing up complete history

**Status:** implemented and verified. All six steps shipped; not yet wired to the product surface (§14.4).
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

### 2.5 The audit log

A backup system must never rest on "it succeeded". Every walk produces a record
that says, in numbers, *why* the local store is believed complete:

```
Conversation  Expected  Downloaded  Duplicates  Retried  Complete  Duration  Verdict
------------  --------  ----------  ----------  -------  --------  --------  --------
8829dfd9      120       120         0           0        yes       4.1s      complete
1f4ac0b2      3204      3199        12          2        no        91.2s     count-mismatch

1f4ac0b2: 5 messages were never delivered; 2 pages were retried
```

**The completeness invariant.** A conversation is marked complete only when both
hold:

1. the server confirms nothing is older than the cursor — the protocol
   confirmation, and
2. `downloaded + duplicates >= expectedFinal`, and `expectedFinal <= expected` —
   the arithmetic.

Both, not either. The two answers come from the same endpoint, so requiring both
turns a single wrong count into a contradiction *with itself*; accepting either
alone would let whichever answer happens to be wrong carry the decision.

**Why `expectedFinal` is anchored.** The expectation is fixed to the newest
message the walk started from. Messages arriving mid-backfill are newer than
that anchor, outside the range, and belong to delta sync — without the anchor, a
walk that fetched everything it set out to fetch looks short every time somebody
sends a message during a backup.

**Why the range may only shrink.** Deletions remove from the anchored range;
arrivals cannot add to it. So `expectedFinal > expected` is impossible for a
truthful server and is treated as a bad count, not a surprise.

**Why `>=` and not `==`.** A message deleted for everyone after this device
fetched it leaves local holding more than the server admits to. Holding more is
never the failure — it is the point. Holding less is.

| Event during a walk | Effect | Verdict |
| --- | --- | --- |
| Messages arrive | outside the anchored range | complete |
| Messages deleted after fetch | `discrepancy > 0`, noted | complete |
| Messages deleted before fetch | both counts fall together | complete |
| Server repeats rows | counted as duplicates, noted | complete |
| Range count wrong, total honest | shortfall detected | **count-mismatch** |
| Total under-reported at start | range appears to grow | **count-mismatch** |

**What it cannot catch, stated plainly.** A count endpoint that is wrong
*consistently* — total agreeing with range agreeing with what was delivered —
satisfies every check here, because counts are the only evidence and all of it
comes from one source. The independent check is §9's proof, which compares the
local row store against the server afresh before any archive is written.

**Privacy.** The audit holds counts and verdicts only: no message id, text,
sender, or per-message timestamp. The conversation id is replaced by a short
stable `ref`, and `formatAuditLog` redacts by default, so a user pasting their
audit into a bug report cannot leak history by not noticing an option. Verified
by asserting no message-shaped field survives into either the record or the
rendered table.

---

## 3. The preflight summary

Shown before anything is fetched, so the user consents to the cost:

```
Ready to Back Up
  Chats           412
  Messages        38,204
  Photos          2,310
  Videos          148
  Documents       86
  Voice notes     431
  Estimated size  15 MB (12 MB–17 MB)
  Media           1.2 GB (not included yet)
```

Counts come from aggregate queries with `Prefer: count=exact` and `Range: 0-0`,
which return a count header and no rows — cheap, and no history is transferred
to produce the estimate. Seven aggregate queries for the whole account, not one
per conversation. The source interface returns `number`, so it cannot hand back
rows even by mistake: a preflight that downloaded the account in order to
measure the account would defeat its own purpose, and making that structurally
impossible is cheaper than remembering not to do it.

**The estimate is measured, not assumed.** Bytes per message come from the local
row store's own average, because an account of one-word replies and one of
pasted logs differ by more than an order of magnitude and the device already
holds the evidence. `ASSUMED_BYTES_PER_MESSAGE` (360, from the archive
measurements) is used only when there are no local rows — which is the first
backup, so it is the common path rather than a corner, and the summary says when
it was used.

**The estimate is labelled an estimate**, and returned as a range. A number
presented as exact and then missed by a third is worse than a range that
contains the answer. The band widens when the sample is thin — quoting a
confident figure derived from eleven messages is the failure being avoided.

**Media is counted and excluded from the same summary.** `mediaBytes` is a
separate field from the archive estimate and is rendered "not included yet",
because v1 does not upload media (§5) and a total that added them would quote a
number for something PINGO is not going to send.

**One failed count degrades a figure, not the backup.** Each count is
independent; a failure names itself in `unavailable`, sets `partial`, and the
rest of the summary stands. The distinction that matters is between an account
with no history and an account that could not be measured — both show zero and
they need opposite words, so `empty` requires the count to have *succeeded*.
Congratulating someone on a backup of a history that was never measured is the
failure that separation exists to prevent.

**What is left, not what exists.** `toDownload` subtracts what the device
already holds, clamped at zero, so a user who backed up yesterday is not told
they are about to download their whole history again — and one whose local store
legitimately exceeds the server is not shown a negative amount of work.

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
| New | `backfill.ts` — cursors, the paging loop, end-of-history confirmation, the audit log |
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

---

## 9. Completeness proof

A backup that quietly contains less than it claims is worse than a backup that
fails, because it fails later and without warning. So the archive does not start
until completeness has been *proven*, not assumed.

### 9.1 The proof

Per conversation, not merely in aggregate — a global total can balance while two
conversations are individually wrong:

```
for each conversation:
  serverCount   count=exact over messages the user may read
  localCount    rows in message-rows for that conversation
  cursor        backfill complete flag

conversation is proven when   localCount >= serverCount   and cursor.complete
account is proven when        every conversation is proven
```

### 9.2 Why `>=` rather than `==`

Exact equality is the goal and the wrong gate. Local can legitimately exceed the
server:

- a message deleted for everyone after this device stored it,
- a conversation cleared server-side while rows remain,
- retention expiring history the device already holds — which becomes the normal
  case once §6 lands, and is precisely the state a backup exists to preserve.

Local holding *more* than the server is not a defect; it is the feature. What
must never happen is the server holding something local does not, so the gate is
"nothing on the server is unaccounted for", and the exact difference is reported
either way so a surprising number is visible rather than swallowed.

### 9.3 When the proof fails

No archive is written. The user is told which conversations are short and by how
much, and offered a retry that resumes from the cursors rather than starting
again. A proof that cannot be completed after retry is a bug report with the
numbers already in it.

### 9.4 What the proof travels with

The counts are written into the archive **header**, inside the encryption, so a
restore can confirm it received what was promised:

```json
{"kind":"header","version":1,"completeness":{"conversations":412,"messages":38204,"provenAt":1785...}}
```

Deliberately not in the manifest. The manifest is plaintext to Google, and a
message count is a finer-grained signal than the archive size it already sees.


### 9.5 Why this is not the backfill audit again

The audit records what the server said *during* the walk, and states its own
limit: every figure in it comes from one endpoint, so a count that is wrong
consistently satisfies all of it. The proof is the independent check. It asks
the server afresh, per conversation, and compares against what is actually in
the local row store — not against what backfill remembers downloading. Two
sources that were never derived from each other have to agree.

The cursor check is what closes the remaining gap. Counts agreeing says nothing
was left behind; `cursor.complete` says the walk actually reached the beginning.
A conversation can satisfy the first and fail the second exactly when the server
under-reports its own history — the failure the audit admits it cannot see
alone. Verified: a conversation whose counts agree exactly is still refused
while its cursor is unfinished.

### 9.6 The case a global total would hide

Two conversations, five hundred each on the server. One holds nine hundred
locally after a deletion elsewhere; the other holds one hundred. The account
totals one thousand against one thousand, balances perfectly, and four hundred
messages are missing.

This is why the sum is computed *from* the per-conversation results and never
used as the gate.

### 9.7 Three verdicts, not two

| Verdict | Means | Archive |
| --- | --- | --- |
| `proven` | every conversation measured and whole | proceeds |
| `short` | measured, and history is missing | refused |
| `unverified` | a count could not be read at all | refused |

`short` and `unverified` both refuse, and they are different problems needing
different words — the same distinction preflight draws between an empty account
and an unmeasured one. A count that failed must never be reported as missing
history, and must never quietly pass as proven. Where both are present the
measured shortfall leads, because it is the actionable fact and reporting
"unverified" while holding proof of a shortfall would understate what is known.

### 9.8 A retry resumes

`conversationsToWalk` returns only the conversations that are short, unwalked or
unmeasured. A retry resumes those from their cursors rather than restarting the
account — minutes instead of an hour on a large account, and a retry that
re-walks what already succeeded is one users learn not to press.

Verified end to end across both modules: backfill runs against a server that
fails one conversation, the proof names only that one, and after the targeted
retry the conversation that already succeeded is never re-paged.

### 9.9 The header is the only way to claim proof

`completenessHeader()` throws unless the proof passed, and it is the only
constructor for the block that travels inside the archive. A header is a claim
that completeness was proven, so writing one for an account where it was not has
to be impossible rather than merely discouraged.

### 9.10 Cost

Four hundred conversations is four hundred count queries, run eight at a time.
All at once is a burst a phone network handles badly and a rate limiter handles
worse; one at a time is a visible wait before a button that has not started yet.
No history is transferred — these are the same `count=exact` aggregates preflight
uses.

---

## 10. Verified backup

"Backup complete" is a claim about a remote object, and until it is read back it
is a claim about an intention.

### 10.1 What is verified, after HEAD commits

| Check | Catches |
| --- | --- |
| HEAD generation equals the one just written | a lost or overwritten commit |
| Manifest for that generation exists and parses | a half-committed generation |
| Chunk count matches the manifest | a missing tail |
| Every chunk file is present | a dropped upload Drive reported as fine |
| Each chunk's size matches the manifest | a truncated body |
| Each chunk's digest matches the manifest | corruption at rest |
| Header decrypts and its completeness block matches the proof | an archive of the wrong account state |
| Encryption metadata present — `epk`, per-chunk `iv` | a plaintext archive, which must be impossible and is checked anyway |

Only when all pass does the UI say **Backup complete**. Anything else is a
failure with a reason, and the previous generation is left in place — it is
still the good backup until this one has earned the title.

### 10.2 The cost, stated

Digest verification requires downloading what was just uploaded, so a verified
backup costs roughly double the bandwidth. That is the correct default for
something whose entire value is being trustworthy on a day nobody planned for.
Above a threshold the digest pass may sample rather than read every chunk; the
structural checks always run in full, and the UI never claims more verification
than was performed.

### 10.3 Failure leaves the old backup alone

Verification runs after the commit, so a failure means a bad generation is live.
The response is to roll HEAD back to the previous generation rather than leave a
pointer to something unverified — the same ordering discipline as everywhere
else: nothing good is discarded until something better is proven.

### 10.4 Where it runs — an ordering constraint on the existing commit path

The commit sequence today is chunks → manifest → HEAD → **delete old**, and the
delete happens immediately (`drive-target.ts:164`, `drive-target.ts:239`).
Verification has to run *between the last two*:

```
chunks → manifest → HEAD → VERIFY → delete old
```

After HEAD, because verifying anything else is verifying a file nobody points
at. Before the delete, because a failure here means a bad generation is live and
the only correct response is to put the pointer back — which requires the
previous generation to still exist.

**Deleting first would convert a recoverable bad backup into no backup at all.**
Step 6 moves the clean to after verification; until then the module is complete
and unwired, which is why its store interface is injected.

### 10.5 Rollback, and the first-backup case

On failure HEAD moves to the newest older generation that still has a readable
manifest — a generation whose manifest is also gone is skipped rather than
pointed at.

When there is nothing older, HEAD is **removed** rather than left on the
failure. That is the first backup, and "no backup" is the honest state: telling
someone they have a backup that did not verify is worse than telling them they
have none, because only one of those gets acted on.

| Situation | Result |
| --- | --- |
| Older generation exists | `rolledBackTo: N`, previous backup still live |
| Older manifest missing | skipped, rolls further back |
| Nothing older | `headCleared: true`, no backup claimed |
| `rollback: false` | reports the failure, pointer untouched |

### 10.6 What is sampled and what never is

| Check | Sampled? | Why |
| --- | --- | --- |
| HEAD generation | never | one read |
| Manifest present and parses | never | one read |
| Chunk count | never | arithmetic |
| Encryption metadata | never | arithmetic |
| Chunk presence | never | metadata, not a download |
| Chunk size | never | metadata, not a download |
| Chunk digest | above 64 chunks | requires re-downloading the archive |
| Header completeness | only if a reader is supplied | requires the recovery key |

Presence and size are metadata reads, so sampling them would save nothing and
give up the check most likely to catch an upload Drive reported as fine.
Verified: a chunk missing at index 150 of 200 is caught even though the digest
sample never reads it.

The digest sample always includes the **first and last** chunk — the tail is
where a truncated upload shows, and a sample that could miss it would pass the
failure most likely to happen. The remaining picks are spread evenly rather than
chosen at random, so a verification is reproducible and a bug report can be
re-run.

### 10.7 The UI cannot overstate what happened

`verificationHeadline()` is built here rather than at the call site, so
"Backup complete" cannot be written next to a partial verification by someone
reading only `status`:

```
Backup complete and fully verified.
Backup complete, spot-checked (16 of 200 parts read).
Backup complete, completeness not confirmed.
Backup failed to verify. Your previous backup from generation 6 is still in place.
Backup failed to verify and was not kept.
```

A sampled digest pass and a skipped header check are **different** qualifications
and are worded separately. Collapsing them produced "spot-checked (4 of 4 parts
read)" on a run that read every chunk and simply could not decrypt the header —
reassuring and wrong at the same time.

### 10.8 The header check needs a key, so it is injected

Structural verification needs no key at all. Confirming *which account state*
the archive holds needs the recovery key to read the header. So the reader is
injected, and a caller that cannot decrypt gets an explicit `skipped` with a
reason rather than a check that quietly did not happen.

Everything above the header proves the bytes are the bytes that were uploaded.
The header is the only check that proves they are the bytes that were meant to
be.

---

## 11. Implementation order

Each step ships with its own suite and is independently verifiable before the
next begins.

| # | Module | Verified against |
| --- | --- | --- |
| 1 | `backfill.ts` | happy path · interruption · resume · duplicate pages · missing pages · **short-page attack** · corrupted cursor · network failure · server inconsistency · cancellation · incorrect server counts · counts changing mid-walk · deletions mid-walk · arrivals mid-walk · duplicate ids · out-of-order pages · audit redaction |
| 2 | `preflight.ts` | counts match a known fixture · estimate within tolerance · measured vs assumed average · thin sample widens the range · zero-history account · count query failure · total outage · empty vs unmeasured · media excluded from the estimate · no per-conversation queries |
| 3 | completeness proof | proven · short by one · short in one conversation only · local exceeds server · cursor incomplete · retry resumes |
| 4 | backup verification | all checks pass · missing chunk · wrong size · bad digest · wrong generation · header mismatch · rollback on failure |
| 5 | archive integration | end to end on a wiped device, the way cross-device recovery was proven |

The short-page case is called an attack rather than an edge case on purpose. A
server that returns a short page — through hidden messages, a hostile proxy, or
a bug — must not be able to convince backfill that history has ended, because
the resulting archive verifies perfectly and is silently incomplete.

---

## 12. The immutable backup receipt

Every successful backup writes one receipt recording exactly what it contained.
A restore checks what arrived against it. "The restore finished" and "the
restore was complete" are different claims, and only the second one is worth
making.

```
Backup ID        bk_01HZY
Created          2026-07-25T17:20:00.000Z
Generation       7
Chats            412
Messages         38,204
Media files      2,544
Archive size     3,000,048 B
Manifest hash    q8wCKPPXUbNy
Archive hash     vt6R6dX+YEg/
Encryption mode  private
Key version      1
Verification     verified
Completeness     proven
```

### 12.1 Immutable against whom

The receipt lives beside the archive, so it lives on Google Drive, so Google can
rewrite every byte of it. **Storage cannot make it immutable; cryptography can.**
The body is sealed under a key derived from the account's recovery key, so a
receipt can be *deleted* by whoever holds the file and cannot be *forged or
edited* by anyone. That is the property a restore actually needs — a tampered
receipt fails to open rather than lying convincingly.

### 12.2 Sealed, not signed

A signature would make the receipt tamper-evident while leaving the counts
readable. §9.4 already decided counts do not go where Google can read them: the
manifest is plaintext, and a message count is a finer-grained signal than the
archive size Drive can already see. So the body is encrypted, and the plaintext
envelope carries only `backupId`, `generation`, `mode`, `keyVersion` — every one
of which is already implied by the file's location, so the envelope leaks
nothing new.

The envelope is bound into the AEAD. Without that it would be unauthenticated
and editable: a receipt could be relabelled as a different generation, or as
Private when it was made in Simple mode, while its body still opened cleanly.

### 12.3 A separate key from the chunks

The receipt key is HKDF'd from the same ECDH secret under a different `info`
label, so whoever can open the archive can read its receipt and nobody else,
while neither key is the other. The suite takes the archive chunk key and
attempts to open a receipt with it, and fails if that ever succeeds — the same
shape as the archive/recovery isolation proof.

### 12.4 The two hashes

| Hash | Over | Catches |
| --- | --- | --- |
| `manifestHash` | canonical JSON of the manifest | any edit to generation, chunk count, size, epk, or a digest |
| `archiveHash` | root over the ordered chunk digests | an edited chunk, a dropped tail, a swapped pair |

Both are canonicalised — keys sorted, chunks ordered by index — so a manifest
rebuilt by a different code path hashes the same. Without that, an honest
restore raises a false alarm the moment field order changes, which trains people
to ignore the alarm.

The archive root binds the chunk *count* and each *index* into its preimage. A
plain concatenation of digests would let a reorder through.

### 12.5 The chain, and what it does not cover

Each receipt carries the hash of the previous sealed receipt, inside the sealed
body — a link an attacker can rewrite is not a chain. This catches a deleted
receipt in the middle and an old receipt replayed as the newest.

**It cannot catch truncation at the newest end.** Deleting the most recent
receipt leaves a shorter chain that is internally perfect. That is covered by
pinning the newest hash locally and by the server-side generation floor from the
security review (Gap 2/3) — not by the chain. The suite asserts this limit
rather than leaving it to be assumed.

### 12.6 Restore verification

| Checked | Result if it differs |
| --- | --- |
| Expected chats == restored chats | warning, named, with both numbers |
| Expected messages == restored messages | warning, named, with both numbers |
| Expected manifest hash == actual | warning |
| Expected archive hash == actual | warning |
| No readable receipt | `unverifiable` |

**A mismatch never blocks the restore.** The data that did arrive is the user's
data and withholding it helps nobody. But it is never reported as a complete
restore either, which is the entire reason for writing the receipt.

The status is `verified | warned | unverifiable` — deliberately not a boolean, so
no call site can write `if (ok)` and let "restored with warnings" quietly become
"restored". The suite asserts the result object exposes no boolean at all.

**What a hash mismatch actually means, stated precisely.** The chunks are
AES-GCM and the receipt is sealed, so nobody can produce an archive that
decrypts *and* hashes differently. Reaching the warning path means the receipt
belongs to a different backup than the one restored — a stale pointer, a
partially rolled-back generation — not forged content. Forged content fails
earlier, at decryption, and never gets that far. The warning is worth having
anyway: the failure it catches is ours, not an attacker's.

### 12.7 The lifecycle

```
backfill  →  completeness proof  →  archive  →  upload  →  verification
                                                                 ↓
success  ←  restore verification  ←  immutable receipt  ←────────┘
```

Each arrow is a gate, not a step: the proof refuses to archive while anything is
short, verification refuses to commit HEAD to something it could not read back,
and the receipt is written only after verification passes — so a receipt saying
`verified · proven` cannot exist for a backup that was neither.

---

## 13. Implementation order, revised

| # | Module | Status |
| --- | --- | --- |
| 1 | `backfill.ts` + audit log | done — 73 checks |
| 2 | `preflight.ts` | done — 40 checks |
| 3 | `receipt.ts` — immutable receipt, restore verification | done — 47 checks |
| 4 | `completeness.ts` — the proof, the retry set, the header | done — 49 checks |
| 5 | `verification.ts` — read-back, sampling, rollback | done — 64 checks |
| 6 | `pipeline.ts` — the lifecycle, end to end on a wiped device | done — 58 checks |

---

## 14. Integration

The modules above each prove they work alone. `pipeline.ts` is the one that puts
them in order, and `verify-pipeline.ts` proves the order holds — real backfill,
real proof, real archive builder, real Drive target, real verification, real
sealed receipt. Only the network and the database are stand-ins.

```
preparing → downloading → proving → encrypting → uploading → verifying → recording → done
```

The stage names map one-to-one onto the modules, so the progress a user watches
is the work actually happening. `STAGE_LABELS` lives beside the stage type so a
new stage cannot be added without deciding what it is called — a label invented
at the call site is how "Encrypting…" ends up on screen during an upload.

### 14.1 What the end-to-end run proves

| Claim | How it is shown |
| --- | --- |
| The proof blocks the archive | one unreachable conversation → nothing uploaded, no HEAD, no receipt |
| Verification runs while rollback is possible | a chunk deleted after HEAD → HEAD back to generation 1 |
| The old backup survives a failure | generation 1 still restores in full, all 425 messages |
| The clean waits for verification | `pingo.manifest.g1.json` still present after a failed generation 2 |
| The receipt records reality | `proven` · `verified`, counts matching the proof |
| Receipts chain | second receipt carries the first's hash |
| A wiped device can read it back | 425 of 425 messages, 3 of 3 conversations |
| The restore matches its receipt | `verified`, no warnings |
| A repeat backup is cheap | `messagesFetched === 0`, proof still run afresh |
| An empty account is not a backup | "Nothing to back up yet", nothing uploaded |

### 14.2 Two changes to existing code

**The clean now waits.** `backupArchiveStreaming` takes an optional `verify`
callback that runs after HEAD and before the clean, and returning false skips
the clean. Without it the behaviour is unchanged — a caller that never verifies
has nothing to roll back to anyway — so the ordering is available where it
matters without a second code path.

**The completeness block travels in the header.** `archiveLines` takes it as an
optional second argument and writes it into the header record, inside the
encryption. `openArchiveHeader` reads it back from chunk zero alone, so
verifying which account state an archive holds costs one chunk rather than a
full restore. The AAD still binds generation, index and chunk count, so reading
less does not mean checking less.

### 14.3 A bug the integration found

`DriveClient.find` and `.list` returned Google's file metadata unchanged, and
the Drive API reports `size` as a decimal **string**. The chunk-size check
compares it against a number, so `"64" !== 64` would have failed every chunk of
every backup — against real Drive only. Every in-memory stand-in in this
repository returns a number, so no existing suite could have caught it, and it
would have surfaced as "your backup is corrupt" on the first real verification.

Normalised in `client.ts` at the one place the metadata enters, rather than at
each comparison.

### 14.4 What is deliberately not wired yet

`controller.ts` still drives the old path. Switching the product surface over is
a UI change — preflight summary, four-stage progress, the blocked-proof screen —
and it belongs with that work rather than buried in this one. The pipeline is
complete, verified, and callable.

Media remains v2 (§5), and retention still must not shorten until an account has
a completed backfill and a verified archive (§6).
