# PINGO — recovery: threat model and implementation plan

**Status:** for review. No code written.
**Reads with:** [E2EE design](./e2ee-architecture.md) ·
[recovery architecture](./e2ee-recovery-architecture.md)

---

## 1. Three conflicts in the requirements, and how this resolves them

Raised first because each changes what gets built, and picking silently would
be worse than asking.

### 1.1 "Never use the recovery key for normal message encryption"

The architecture needs the content key wrapped for the recovery public key on
every message, or restoring it reveals nothing. Read literally, that is
"using it for message encryption".

**Resolution proposed:** the recovery key is an additional **wrap recipient**
and nothing else. It never encrypts a body, never signs, never authenticates a
session, and is never consulted while a device that can read normally is
present. It sits in the `keys` map beside the device wraps and is otherwise
inert.

That satisfies the intent — the recovery key is not part of the live security
path — while making recovery possible at all. **If you meant it more strictly
than that, recovery of past messages is not achievable and we should say so in
the product rather than build something that cannot work.**

### 1.2 "Device verification before allowing recovery" is circular

Device verification means comparing fingerprints with a device you already
control. In the recovery case there is no such device — that is why you are
recovering. Requiring it would make recovery impossible exactly when it is
needed.

**Resolution proposed:** two paths, chosen by what actually exists.

| Situation | Authorisation |
| --- | --- |
| Another device is signed in | That device approves, showing the new device's fingerprint. Real verification. |
| No other device | Account re-authentication **plus** the recovery code, then a **notification to every other device** and a permanent entry in a device log. |

The recovery code is the possession factor when nothing else remains. What
prevents *silent* authorisation is not a second device but the audit trail: a
new device never appears without every other device being told, and the entry
cannot be deleted by the device that created it.

### 1.3 Argon2id is not in Web Crypto

There is no native Argon2. The options are a WASM build (~40KB, lazy-loaded,
identical in browser and Android WebView) or PBKDF2-SHA256, which is native.

**Resolution proposed:** ship **PBKDF2-SHA256 at 600,000 iterations** first,
with the KDF identifier stored in the blob so Argon2id can be added later
without breaking existing packages.

The reasoning matters: with a *generated* 128-bit code, the entropy is doing
all the work. Brute force is infeasible at any iteration count, and a
memory-hard KDF defends against weak human secrets — which this design does not
have, because it never lets the user choose one. Argon2id is an upgrade here,
not a load-bearing control. **Adding a WASM dependency to the auth path buys
less than it costs, today.**

---

## 2. Threat model

### 2.1 Assets

| Asset | Where it lives | Consequence if lost |
| --- | --- | --- |
| Device identity private key | IndexedDB, non-extractable | That device's messages readable |
| **Recovery private key** | Wrapped blob on server; non-extractable after restore | **All history, all devices, forever** |
| **Recovery code** | The user's head or paper. Never transmitted | Same as above, if the blob is also held |
| Message plaintext | Sealed local cache | Those conversations |

The recovery key and code are jointly the highest-value asset in the system.
Either alone is useless; together they are everything.

### 2.2 Adversaries and outcomes

| Adversary | Capability | Outcome |
| --- | --- | --- |
| Database leak / passive server | Reads every table | **Blocked.** Blobs are AES-GCM under a key derived from a secret never sent. Offline attack faces 128 bits. |
| **Malicious server, substitution** | Serves an attacker's blob during restore | **Blocked by GCM.** The attacker cannot produce a package that authenticates under the user's unknown code. Restore fails closed. |
| **Malicious server, rollback** | Serves an old, superseded blob | **Mitigated** by a monotonic version in the package and a version column checked on restore. |
| Malicious server, denial | Withholds or deletes the blob | **Not prevented.** Availability was never a property the server could be trusted for. The user-held copy of the code is the answer. |
| Network attacker | Full TLS MITM | Blocked. The package is already ciphertext; the transport adds nothing. |
| **Same-origin XSS during setup** | Runs while the exportable handle exists | **The residual risk.** Bounded to a straight-line block with no network call, but real. §3.3. |
| Same-origin XSS at any other time | Runs in PINGO's origin | Cannot export either key. Can still *use* them — unchanged from today, and unfixable in a browser. |
| Device thief | Has the unlocked device | Reads that device's messages. Recovery adds nothing new. |
| Shoulder-surfer / screenshot at setup | Sees the 12 words | **Full compromise if they also reach the blob.** Mitigated by warning, not by cryptography. |
| Compelled disclosure to PINGO | Legal order against the operator | **Blocked.** No secret exists to hand over. This is the point of the design. |
| Compelled disclosure to the user | Order against the person | Not a technical problem and this design does not claim to solve it. |
| Online guessing | Repeated restore attempts | Rate-limited per account; 128 bits makes it irrelevant anyway. |

### 2.3 What this explicitly does not protect

- **The recovery key opens all history, forever**, including messages sent
  before it leaked. Only a ratchet changes that, and a ratchet is out of scope.
- **Restoring onto a hostile device** gives that device everything. §1.2 is
  the mitigation and it is procedural, not cryptographic.
- **Messages sent before recovery was enabled** have no recovery wrap and are
  unrecoverable after total device loss. §5.

---

## 3. Design

### 3.1 Data

```sql
-- One row per account. The server can read every byte and use none of it.
recovery_packages (
  user_id      uuid primary key references auth.users,
  version      integer not null default 1,   -- rollback defence
  kdf          text    not null,             -- 'pbkdf2-sha256-600000'
  salt         text    not null,             -- base64, 16 bytes
  iv           text    not null,             -- base64, 12 bytes
  package      text    not null,             -- base64, AES-GCM(recovery private key)
  public_key   text    not null,             -- SPKI base64. Senders wrap to this.
  created_at   timestamptz not null default now()
)
```

RLS: a user reads and writes only their own row. `public_key` must be readable
by anyone who needs to send to them — same rule `device_keys` already uses,
since a public key is public.

> **Write it with INSERT then PATCH, never upsert.** Demonstrated against the
> live API: a plain `POST` returns 201 and a `PATCH` returns 204, but a
> `Prefer: resolution=merge-duplicates` upsert returns **403 permission denied
> for table recovery_packages**. `ON CONFLICT DO UPDATE` needs table-level
> `SELECT`, and table-level `SELECT` is exactly what was revoked to keep the
> `package` column unreadable. The privilege design and upsert cannot both
> exist, and the privilege design is the one worth keeping. Rotation is
> therefore a `PATCH`.

The envelope format **does not change**. The recovery wrap is one more entry in
the existing `keys` map, keyed `recovery:<user_id>`. Clients look up their own
device id and ignore everything else, so old clients are unaffected by an entry
they never read.

### 3.2 The code

BIP-39 English wordlist: 2048 words, 12 words, 128 bits of entropy plus a
checksum. Chosen rather than invented because it is widely reviewed, the words
are unambiguous when spoken and written, and **the checksum catches a mistyped
word before the KDF runs** — which turns the most common failure from "wrong
key, no explanation" into "word 7 looks wrong".

Generated with `crypto.getRandomValues`. Never transmitted, never logged, never
placed in a URL, and never stored by PINGO in any form.

### 3.3 Lifecycle, and the residual risk

```
setup:   generateKey(extractable: true)
         → exportKey('pkcs8')                  ← the only exportable moment
         → PBKDF2(code, salt) → AES-GCM wrap
         → upload package
         → importKey(raw, extractable: false)
         → drop every reference to the exported bytes
```

Between export and drop, the private key exists as bytes in JS memory. No
network call, no `await` on anything remote, no third-party code runs in that
window. It cannot be reduced to zero in a browser — that is the honest
statement — but it is bounded by a few lines rather than by the lifetime of the
application, which is precisely the improvement over an extractable identity
key.

The exported bytes are overwritten before being dropped. This is best-effort:
JavaScript offers no guarantee against a copying garbage collector, and
claiming otherwise would be false.

### 3.4 Restore

```
sign in → account verified → enter 12 words → checksum validates locally
        → fetch package → PBKDF2 → AES-GCM open   ← fails closed on any tamper
        → import recovery key non-extractable
        → generate a NEW device identity, publish it
        → notify every other device; write the device-log entry
```

The new device gets a **fresh** identity. The recovery key is never used as a
device identity, never published as one, and never used to send.

---

## 4. Backward compatibility

| Case | Behaviour |
| --- | --- |
| Legacy messages (`encryption is null`) | Untouched. Plain rows, rendered as now. |
| Existing E2EE conversations | Unchanged. A recovery wrap is additive. |
| Account with no recovery set up | No wrap added, no row, no prompt beyond one dismissible offer. |
| Old client, new message | Reads its own device wrap; ignores `recovery:*`. |
| New client, old message | No recovery wrap present; readable by device key exactly as now. |

Nothing about the message pipeline changes for anyone who does not opt in.

---

## 5. The gap that must be said out loud

Messages sent **before** recovery is enabled carry no recovery wrap. After
total device loss they are gone, even for a user who set recovery up
afterwards.

Backfilling is technically possible — a device that can still read them could
re-wrap every content key — but it means rewriting the envelope of every
historical message, and a half-finished backfill is worse than none.

**Recommendation: do not backfill in v1.** Instead, state it plainly at setup:
*"This protects messages from now on."* An honest sentence beats a migration
that can corrupt history.

---

## 6. Implementation plan

Each step ships independently and none breaks a client that has not updated.

| # | Step | Verifiable by |
| --- | --- | --- |
| 1 | `recovery_packages` table + RLS | RLS probes as two real users, rolled back |
| 2 | BIP-39 generate/validate/checksum | Unit vectors, added to `pnpm verify:crypto` |
| 3 | Wrap/unwrap round trip, tamper + rollback rejection | Extends `verify:crypto` |
| 4 | Setup flow: generate → wrap → upload → re-import → verify non-extractable | Browser: assert `extractable === false` on the stored key |
| 5 | Sender wraps for `recovery:<user_id>` when the account has one | DB: envelope has the extra entry; old clients still decrypt |
| 6 | Restore flow + fresh device identity | Full loss simulation: clear origin, restore, read history |
| 7 | Device approval, notification, and the device log | Two devices, both paths in §1.2 |

Steps 1–4 touch nothing existing. Step 5 is the only change to the message
path, and it is one additional wrap guarded by "does this account have a
recovery key".

## 7. For your decision

1. **§1.1** — is "additional wrap recipient" the reading you intended?
2. **§1.3** — PBKDF2-600k now with Argon2id as a later upgrade, or WASM Argon2id
   from the start?
3. **§5** — confirm no backfill in v1.
4. **§1.2** — is an unforgeable notification and device log sufficient
   "verification" when no second device exists?
