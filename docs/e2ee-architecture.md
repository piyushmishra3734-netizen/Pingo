# PINGO — local-first storage and end-to-end encryption

**Status:** design agreed, implementation in progress
**Scope:** new messages only. Nothing existing is migrated, re-encrypted or touched.

---

## The shape of it

```
   ┌──────────── device ────────────┐
   │  IndexedDB          Keystore   │
   │  ├ conversations    ├ identity │  private key, non-extractable
   │  ├ messages         └ …        │
   │  └ outbox                      │
   └───────┬────────────────────────┘
           │  plaintext never leaves
   ────────┼────────────────────────────────
           │  ciphertext only
   ┌───────▼──────── Supabase ──────────────┐
   │  messages(body = ciphertext, env)      │
   │  device_keys(user_id, public_key)      │
   └────────────────────────────────────────┘
```

The device is where chats are *read from*. The server is where they are
*synchronised through*. Those are different jobs and the split is the whole
design: rendering never waits on the network, and the network never has to be
fast enough to feel instant.

---

## 1. Why this crypto and not Signal's

The Signal Protocol — X3DH plus a Double Ratchet — is the right answer for a
product whose threat model includes a compromised device *later* being used to
read messages captured *earlier*. It costs a session state machine per
conversation pair, prekey bundles, out-of-order handling and a lot of ways to
end up with an undecryptable thread.

PINGO's requirement is narrower and stated plainly above: **the server must
never see plaintext**, and multi-device must be addable later. That is met by a
much smaller construction, and a small construction that is correct beats a
large one that is nearly correct.

### The construction

Per message:

1. Generate a fresh **content key** — AES-256-GCM, random per message.
2. Encrypt the body with it.
3. For **each recipient device**, derive a key-encryption key by ECDH between a
   fresh ephemeral keypair and that device's public key, run it through HKDF,
   and wrap the content key with AES-GCM.
4. Store the ciphertext, the ephemeral public key, and one wrapped key per
   device.

Every primitive here is in the Web Crypto API, which means it is the same code
on the web and inside the Android WebView — no native crypto module, no second
implementation to keep in step.

| Choice | Why |
| --- | --- |
| ECDH **P-256** | Web Crypto has it everywhere. X25519 is better and is still not universal in Android WebViews. |
| **HKDF-SHA256** between ECDH and AES | Raw ECDH output is not a uniform key. Skipping this is the classic mistake. |
| **AES-256-GCM** | Authenticated. A tampered ciphertext fails to decrypt rather than decrypting to rubbish. |
| Fresh content key per message | Compromising one message's key reveals one message. |
| Fresh ephemeral per message | Without it, the same ECDH shared secret repeats and the wraps become linkable. |

### What this deliberately does not provide

Stated because a security design that hides its limits is worse than one that
has them.

- **No forward secrecy.** A device's private key decrypts every message ever
  wrapped to it. A ratchet is what fixes this and it is not in this phase.
- **New devices cannot read old messages.** They were never wrapped for a key
  that did not exist. This is honest behaviour, not a bug — and it is what
  makes "never expose private keys to the server" achievable.
- **No deniability, no sealed sender.** The server knows who sent what to whom.
  It cannot read any of it.

---

## 2. Keys

### Identity

One keypair per **device**, not per user. Generated on first run, stored in
IndexedDB as a non-extractable `CryptoKey`.

Non-extractable is the load-bearing word: the browser holds the key material
and will perform operations with it, but `exportKey` throws. No bug, no XSS and
no future careless line can serialise it — including into a sync payload. The
guarantee is enforced by the platform rather than by our discipline.

The public half is published to `device_keys`. That table is world-readable by
design: a public key is public, and anyone who wants to send you a message
needs it.

### Multi-device, later

The design already supports it and nothing here has to change:

- Each device publishes its own public key.
- A sender wraps the content key **once per recipient device**.
- Adding a device is publishing a row. Future messages include it.

Old messages remain unreadable on the new device. Closing that gap means a key
sync channel — a second device authorising the first to encrypt its key to it,
via a QR scan or an SAS — which is a later phase and does not disturb this one.

### Revocation

Deleting a `device_keys` row stops future messages being wrapped for it. It
cannot un-send what was already delivered. That is true of every system with
this shape.

---

## 3. Legacy and new, side by side

The requirement is that nothing existing is migrated. So the schema grows one
nullable column:

```sql
alter table messages add column encryption text;   -- null = legacy, 'v1' = E2EE
alter table messages add column envelope jsonb;    -- ephemeral key + per-device wraps
```

- **`encryption is null`** — every row that exists today. `body` is plaintext.
  Rendered exactly as it is now. Nothing reads or writes these differently.
- **`encryption = 'v1'`** — `body` is base64 ciphertext, `envelope` carries what
  is needed to unwrap it.

Detection is a column check, not a guess at the content. A heuristic — "does
this look like base64?" — would misfire on a message that happens to look
encrypted, and the failure would be a chat that renders as garbage.

A `v1` message this device cannot decrypt renders as a stated placeholder,
never as an error and never as empty. "Sent before you added this device" is
information; a blank bubble is a bug report.

---

## 4. Local storage, and what it is for

`apps/web/src/lib/local/` already holds an IndexedDB layer and an outbox — this
phase extends them rather than replacing them.

| Store | Holds | Why |
| --- | --- | --- |
| `conversations` | the list, as last seen | opens instantly, offline |
| `messages` | newest page per conversation | a thread renders before the network answers |
| `outbox` | composed but unsent | survives a force-quit |
| `keys` | this device's identity keypair | non-extractable handles |

**Plaintext is cached locally.** That is the point of local-first: decrypting
the whole history on every open would make the app slower than the server it
replaced. The device is trusted; the server is not. That is the boundary.

Reads stay **network-first with a cache fallback** for the conversation list —
a stale list shown ahead of a fresh one flashes wrong unread counts — and
**cache-first** for an open thread, where the messages are immutable once
written and the newest arrive over the socket anyway.

---

## 5. Synchronisation

Unchanged in shape from what already works, which is the point.

- **Realtime** delivers new messages. Already live for `messages`.
- **Ids are client-generated** for queued sends, so a message that arrives over
  the socket and a message the outbox is holding de-duplicate by id rather than
  by guessing from content.
- **Conflicts** resolve on `created_at`, stamped by the server on insert. Two
  devices sending at once produce two messages, never a merge — a conversation
  has no conflicting states, only an order.
- **Reconnect** flushes the outbox oldest-first, one at a time, which is already
  built and is what keeps a burst from arriving shuffled.

---

## 6. Order of work

Each step ships and is usable before the next begins. Nothing here breaks a
client that has not been updated, because legacy messages are simply the rows
where `encryption is null`.

| # | Step | State |
| --- | --- | --- |
| 1 | Schema: `encryption`, `envelope`, `device_keys` + RLS | **done** |
| 2 | Key generation, non-extractable storage, publication | next |
| 3 | Encrypt on send; envelope wrapped per recipient device | |
| 4 | Decrypt on read; legacy passthrough; undecryptable placeholder | |
| 5 | Cache plaintext locally; thread renders cache-first | |
| 6 | Multi-device key sync | later phase |

---

## 7. What will be true when this is finished

- Every message sent after step 3 is stored on the server as ciphertext PINGO
  cannot read.
- Every message sent before it is untouched and renders exactly as it does now.
- A chat opens from disk, and the network catches it up afterwards.
- A device's private key has never been transmitted, and cannot be — the
  platform refuses to export it.
