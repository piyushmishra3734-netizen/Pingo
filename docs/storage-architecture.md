# PINGO — local-first storage and sync architecture

**Status:** for review. No implementation.
**Reads with:** [E2EE design](./e2ee-architecture.md) ·
[recovery plan](./e2ee-recovery-plan.md) ·
[verification log](./e2ee-verification-log.md)

---

## 0. A security finding, first

`apps/web/android/app/src/main/AndroidManifest.xml:5` sets
**`android:allowBackup="true"`**.

Android Auto Backup copies the application's data directory to the user's
Google Drive. That directory contains the WebView's IndexedDB — which holds
the sealed message cache *and* the `CryptoKey` material for the database key
and the device identity.

Non-extractable stops **JavaScript** exporting a key. It does not stop the
**file bytes** being copied by the operating system. So the configuration
permits Drive to receive both the ciphertext and the key that opens it.

That directly contradicts a claim already published in
`e2ee-architecture.md` §8:

> | A backup or sync copying the profile | **yes** — ciphertext without the key |

**Confidence, stated precisely.** I have verified the manifest flag. I have
*not* verified that Auto Backup captures WebView IndexedDB on this device and
that usable key material survives the round trip — that needs the phone, which
is not attached. So this is a **suspected defect pending device verification**,
not a confirmed one.

It is cheap to close either way: excluding the WebView data (or setting
`allowBackup="false"`) costs nothing we want, because §7 below replaces it with
a backup we control and encrypt ourselves. **Recommend closing it before the
next APK ships**, independently of everything else in this document.

---

## 1. Where we actually are

Measured, not assumed — from the verification log.

| Fact | Value |
| --- | --- |
| Decrypt a 50-message page from the server | **56.5 ms** desktop, several times that on a mid-range phone |
| Open the same page from the sealed cache | **0.41 ms** |
| Thread paint with the network stalled 4,000 ms | **5 ms** |
| Local stores | `conversations`, `messages`, `outbox`, `drafts`, `keys` (IndexedDB v2) |

Threads are already cache-first. Requirements 1 and 8 are largely met today.
What is *not* met is everything that needs per-message granularity, and that is
one structural problem rather than seven separate ones.

### The blob is the bottleneck

`STORE.messages` holds **one sealed record per conversation**, containing the
newest ~50 messages as a single AES-GCM blob.

Everything the requirements ask for and the current design cannot do follows
from that single decision:

| Requirement | Blocked because |
| --- | --- |
| Download only missing messages (§2) | No per-message identity locally to diff against |
| Never reload the full conversation (§2) | Every new message rewrites the whole ~15 KB blob |
| Lazy-load older history (§6) | Only the newest page exists on disk at all |
| Search cached chats (§8) | Every conversation must be decrypted whole to look inside |
| Eviction (§7) | The unit of storage is a conversation, not a message |
| Unread counters offline (§7) | Counts come from the server-shaped list record |

**So the architecture is one change with many consequences: move from
blob-per-conversation to row-per-message.** Nothing else here is interesting by
comparison.

---

## 2. Storage design

Five stores replace two. IndexedDB `version: 3`; `openDatabase` already
self-heals missing stores, so the upgrade needs no new machinery.

### `messages` — keyed `[conversationId, createdAt, id]`

One record per message, each sealed independently with the device database key.

```
{ k: [convId, createdAt, id],        // index, plaintext, non-sensitive
  v: 1, iv, data }                   // sealed: body, author, kind, reactions…
```

The **key is plaintext and the payload is sealed**. That is the whole trick: a
compound key on `[conversationId, createdAt]` supports range queries — newest
50, everything before a cursor — without decrypting anything to find out what
to decrypt. Timestamps and message ids are metadata the server already holds, so
leaving them legible on disk gives away nothing it does not have.

Consequences: appending a message is one small write instead of a 15 KB
rewrite; lazy-loading older history is a bounded range read; eviction can drop
individual messages.

### `conversations` — keyed `conversationId`

Sealed record per conversation: title, participants, avatar, last-message
preview, **unread count**, `lastSyncedAt`, `oldestCachedAt`.

`oldestCachedAt` is what makes lazy loading honest — it says how far back the
cache actually reaches, so the UI can distinguish "no older messages" from
"none cached yet", which the current design cannot.

### `attachments` — keyed by storage path

Sealed blobs plus `bytes`, `lastAccessedAt`. Media is the only thing here big
enough to need eviction pressure. Pings are **never** cached: a cached Ping is a
Ping that outlived its view limit, which is the one promise the product cannot
break.

### `search` — keyed `[token, conversationId, messageId]`

See §4.

### `meta` — sync cursors, schema version, integrity checkpoints

---

## 3. Synchronisation

### The cursor

Per conversation, `lastSyncedAt` = the `created_at` of the newest message
successfully stored locally. Sync is then:

```
GET messages WHERE conversation_id = ? AND created_at > lastSyncedAt
ORDER BY created_at LIMIT 200
```

That is the whole incremental protocol. It reads only what is missing, and on a
quiet conversation it returns zero rows for the cost of one indexed query.

### Edits, deletions and reactions

A creation cursor cannot see a message whose `created_at` is old but whose
`edited_at` or `deleted_at` is new — the case that quietly breaks
"never reload the full conversation".

So a second, cheaper cursor on `updated_at`, which needs a column and a trigger
the schema does not have yet:

```sql
alter table messages add column updated_at timestamptz not null default now();
create index on messages (conversation_id, updated_at);
-- trigger: set updated_at = now() on any update
```

Two range queries per conversation per sync, both indexed, both usually empty.
Reactions already arrive over realtime and are not encrypted, so they are not
part of this.

### Gap detection

A device offline for a week must not silently keep a hole. If a sync returns a
full page (200 rows) the client knows more remain and continues; if the oldest
returned row is newer than `lastSyncedAt + 1`, nothing was missed. Realtime
stays the fast path; the cursor is the correctness path, and the cursor is
authoritative.

---

## 4. Search over encrypted local data

Decrypting every message to answer a keystroke does not scale past a few
thousand messages, and encrypting the index defeats the point of having one.

**Blind index.** For each message, tokenise the plaintext at decryption time and
store `HMAC-SHA256(searchKey, token)` — truncated to 8 bytes — against the
message id. `searchKey` is derived from the database key by HKDF, so it lives
and dies with the device and never reaches the server. Searching hashes the
query the same way and intersects posting lists.

**What this leaks, on a stolen disk:** the *number* of distinct tokens and their
frequencies. An attacker with the raw database can count that "some token
appears 4,000 times" and, with a good corpus guess, may infer it is a common
word. They cannot read messages, and they cannot search for a word without
`searchKey`.

**What it does not leak:** anything to the server, ever. The index is local.

The alternative — decrypt-and-scan — leaks nothing and is fine up to a few
thousand messages. **Recommendation: ship decrypt-and-scan first**, add the
blind index only if search becomes slow in practice. Frequency leakage is a
real cost and should not be paid before it buys something.

---

## 5. Integrity and eviction

**Integrity is already free.** AES-GCM authenticates: a corrupted or edited
record fails to open, and `openRecord` already returns `undefined` on failure,
which the caller treats as a cache miss and refetches. A separate checksum
would duplicate what GCM does.

What is *not* free is a **truncated** cache — records silently missing rather
than corrupted. `oldestCachedAt` plus the message count in the conversation
record makes that detectable: if the range read returns fewer than expected,
the cache is holed and that conversation refetches its newest page.

**Eviction**, in priority order, when over budget:

1. Attachments, least-recently-accessed first — largest and cheapest to refetch.
2. Message bodies older than `oldestCachedAt` in conversations not opened in 30
   days, keeping the newest 50 per conversation always.
3. Never evict: `keys`, `outbox`, `drafts`, conversation records.

Budget from `navigator.storage.estimate()`, targeting 60% of quota. And
`navigator.storage.persist()` should be requested on first run — without it the
browser may evict the whole origin under pressure, which is the one failure that
makes "local-first" untrue. It is one call and the current code does not make it.

---

## 6. Android persistence

The WebView's IndexedDB lives in the app's private data directory. It already
survives logout (sign-out stopped clearing storage), app restarts, and updates.
It is removed on uninstall or explicit "Clear storage" — which is exactly the
lifetime the requirements ask for.

**SQLCipher is still not recommended**, for the reason recorded in
`e2ee-architecture.md` §8: it needs a native plugin and a bridge for every read
and write, and it would end "identical between Web and Android WebView", which
is the property that keeps one implementation instead of two. Our records are
already encrypted with a key the WebView holds; SQLCipher would move *where*
the key lives (Android Keystore, hardware-backed) rather than whether the data
is encrypted. That is a real gain and a separate project.

The genuine Android-specific risk is §0, and it is a manifest flag.

---

## 7. Google Drive backup

**Not Android Auto Backup.** That is the mechanism in §0 and the problem with it
is precisely that it is automatic, opaque, and copies things we did not choose.

Instead: PINGO writes to the user's Drive **app data folder** through the Drive
API, using the Google account already linked for sign-in.

What gets uploaded, both encrypted on-device before leaving it:

1. **The recovery package** — already designed, already tested: the recovery
   private key wrapped under a PBKDF2 key derived from the 12-word code. Drive
   receives the same bytes the server does, and can no more open them.
2. **An encrypted message archive** — messages sealed with a key derived from
   the *recovery* key, not the device database key, because the restoring
   device will not have the old device's database key.

Drive never sees plaintext, and neither does PINGO's server. Neither party can
decrypt without the code, which exists only in the user's head or on paper.

**Restore** rebuilds the local database from the archive, then runs the §3
incremental sync for anything newer. A restore therefore costs one archive
download and one small delta, not a full history refetch.

**Automatic backup** when recovery is enabled: incremental, appending only
messages newer than the last archived cursor, on a schedule (idle + charging on
Android). **Manual** backup and restore are the same code path, triggered by a
button.

**Trade-off, stated:** an encrypted archive in Drive is an offline-attackable
artefact in a second location. It is protected by the same 128-bit code as the
server package, so the strength is unchanged — but the number of places holding
attackable ciphertext goes from one to two. That is inherent to wanting Drive
backup and is the correct call given losing the phone is the common case.

---

## 8. Data flows

| Scenario | Flow |
| --- | --- |
| **First login** | Generate identity (non-extractable) → publish `device_keys` → empty local DB → full initial sync of newest page per conversation → seal to disk |
| **Normal login** | Session restored → local DB **already present and keyed to this account** → render from cache immediately → background delta sync from `lastSyncedAt` |
| **Logout** | Auth session cleared. Keys, cache, indexes, outbox all remain. Nothing else happens. |
| **Login, different account** | `identity-owner` mismatch detected → local data cleared **before** the new identity initialises → then First login |
| **App reinstall** | Data directory gone → new device identity → history unreadable unless recovery is enabled → with recovery: enter code → restore archive → delta sync |
| **New phone** | Recovery request (approval from an existing device, or the 24 h delay) → claim package → restore recovery key → **fresh device identity** → Drive archive restore → delta sync |
| **Drive restore** | Download archive → decrypt with recovery-derived key → rebuild local DB → delta sync only |
| **Offline** | Cache serves reads and search; composing seals into the outbox; sends queue |
| **Background sync** | On reconnect and on realtime reconnect: flush outbox oldest-first, then delta sync each conversation by both cursors |

---

## 9. Migration

Additive and reversible at each step. No user-visible break.

| # | Step | Risk |
| --- | --- | --- |
| 1 | **Close `allowBackup`** (§0) — independent of everything else | none |
| 2 | `navigator.storage.persist()` on first run | none |
| 3 | IndexedDB v3: add `messages` row-per-message, `attachments`, `meta`. Keep the old blob store, unread | none — new stores beside old |
| 4 | Write to both: new sends and synced messages land as rows *and* in the blob | low, one release |
| 5 | Read from rows when a conversation has them, else blob, else network | low |
| 6 | `updated_at` column + trigger + index on `messages` | server-side, additive |
| 7 | Delta sync by both cursors, replacing the newest-page refetch | medium — the actual behaviour change |
| 8 | Drop the blob store; delete legacy records | none once 4–7 have shipped |
| 9 | Attachment cache and eviction | low |
| 10 | Drive archive, then restore | gated behind recovery UI |

Steps 1 and 2 are worth doing this week regardless of whether the rest is
approved.

---

## 10. Expected results, and the honest costs

**Expected.** Opening a cached conversation stays at the measured ~5 ms and
stops depending on the newest page being intact. A quiet conversation syncs in
one indexed query returning zero rows, against the current behaviour of
refetching and re-decrypting 50 messages every open — so both network and CPU
per open fall to near zero. Sending stops rewriting a 15 KB blob per message.
Scrollback becomes available offline for the first time.

**Costs.**

- **More records, more overhead.** Each sealed message carries a 12-byte IV and
  a 16-byte tag, so ~28 bytes per message versus ~28 bytes per *page* today.
  On 10,000 messages that is ~280 KB — irrelevant against the message bodies.
- **Metadata legible on disk.** Timestamps, message ids and conversation ids
  become plaintext index keys. The server already has all of it, so nothing new
  is exposed to anyone who was not already holding it — but a disk thief now
  learns *when* you were talking without learning what about. Today they learn
  neither. This is a real reduction and it is the price of range queries.
- **Migration is stateful.** Steps 4–7 mean a period where two representations
  exist. That is why they are separate releases.
- **Search leakage**, if the blind index is ever adopted — which is why §4
  recommends not adopting it yet.

---

## 11. For your decision

1. **§0** — close `allowBackup` now, as a standalone fix, before the next APK?
2. **§4** — confirm decrypt-and-scan first, blind index only if measured slow.
3. **§2** — accept plaintext timestamps and ids as index keys, given the server
   already holds them?
4. **§7** — Drive app-data folder via the Drive API, rather than Auto Backup.
