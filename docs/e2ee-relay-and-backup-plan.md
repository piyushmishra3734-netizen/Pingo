# PINGO — relay, recovery and backup

**Status:** design. No code written for anything below unless a section says
otherwise.
**Reads with:** [E2EE design](./e2ee-architecture.md) ·
[storage architecture](./storage-architecture.md) ·
[recovery architecture](./e2ee-recovery-architecture.md) ·
[recovery plan](./e2ee-recovery-plan.md)

The goal is WhatsApp's behaviour from the user's side, with less permanent
server storage and no plaintext anywhere the user does not control. The order
of work is deliberately the reverse of the usual instinct: **make data
impossible to lose first, reduce server retention last.**

---

## 0. What was verified before planning

Three claims were tested rather than assumed, because the implementation order
depends on which is true.

### 0.1 Device identities are not being regenerated spuriously

Four `device_keys` rows existed for one account, which looked like a defect.
It is not.

| Identity | Created | Explanation |
| --- | --- | --- |
| `89b61d0e` | 09:31 | predates `5a6a3f2` (16:03), *"Stop account switching from destroying the keys"* |
| `192197a5` | 09:50 | same, already-fixed defect |
| `5e450379` | 18:10 | after account switching shipped (`fb6b539`, 17:10) |
| `6723d4f7` | 18:35 | first sign-in of that account on that installation |

Evidence:

1. **A full page reload does not regenerate.** Measured: `device-id` unchanged,
   no new row, `last_seen_at` advanced 18:41:07 → 19:13:03. `deviceIdentity()`
   (`keys.ts:54`) reuses whenever both `identity:v1` and `device-id` exist.
2. **An old identity resumed use.** `89b61d0e` was last seen at 16:47, *after*
   `192197a5` stopped at 12:45. An identity cannot come back if keys are being
   destroyed, so the parking and restore in `switchAccount` (`session.ts:55`)
   demonstrably works.
3. **The key store holds one identity per account.** Parked slots exist for
   exactly the two accounts used, and the parked copy equals the live one.

**Conclusion:** a new installation being unable to read older messages is the
E2EE guarantee working, not a bug. Recovery wrapping is therefore the priority
and identity work is demoted to one small fix (§7.4).

### 0.2 Recovery is built but unreachable

`apps/web/src/lib/crypto/recovery.ts` implements the 12-word code, PBKDF2
(`pbkdf2-sha256-600000`), `createRecoveryKey`, `restoreRecoveryKey` and
version-replay refusal. `supabase/migrations/20260805000000_recovery.sql`
creates `recovery_packages` with column-level grants so `package` is not
selectable.

**It has zero importers.** Nothing in the product calls it. This is the same
failure mode as `deltaReport()`: written, correct, never wired.

### 0.3 Messages are not wrapped for recovery

`sealBody` (`session.ts:250`) wraps the content key only for the devices
returned by `conversationKeying`. No recovery recipient is included.

**This is the single most urgent item in this document.** A message sent today
cannot be recovered tomorrow, even by a user who enables backup tomorrow,
because the wrap that would have made it readable was never written. Every day
this is deferred converts more history into permanently unreadable ciphertext.

---

## 1. Server: relay first, storage last

### 1.1 Target

The server holds ciphertext only as long as delivery requires, then forgets it.
It never holds plaintext, and it is never required to read history.

### 1.2 What is being built now, and what is not

| Decision | Now | Later |
| --- | --- | --- |
| Rows carry ciphertext only | already true when `everyoneReady` | unchanged |
| Delivery via `postgres_changes` | **kept** | broadcast relay, once receipts and multi-device are proven |
| Retention after confirmed delivery | **30 days, configurable** | 24 hours |
| Retention when never delivered | 30 days | policy-driven maximum |

**Relay-only delivery is deliberately not being built yet.** Delivery today is
`postgres_changes` on `messages` INSERT (`chat-service.ts:559`), which reads
the WAL of a real row. Broadcast delivery is a different mechanism — the
pattern exists in `call-service.ts:201` — but moving to it before delivery
receipts, restore and multi-device sync are verified would remove the only
copy of a message that the recipient has not yet fetched.

**24-hour deletion is deliberately not being built yet**, for the same reason:
it makes backup load-bearing before backup has been proven on real devices.

### 1.3 Retention must be configuration, not a constant

Retention is a server-side setting so the window can be shortened without a
client release:

```
retention_policy
  delivered_ttl        interval  default '30 days'
  undelivered_ttl      interval  default '30 days'
  updated_at           timestamptz
```

The purge job reads the policy each run. The precedent is
`snap_lifecycle.sql:225`, which already schedules a purge with `pg_cron`; this
follows that shape rather than inventing a second one.

### 1.4 Delivery receipts are a prerequisite

The schema cannot currently express "delivered". `chat-service.ts:228` states
it plainly: *"`sent` is the honest ceiling. Delivery and read receipts need
per-recipient tracking this schema does not have."*

Deleting on delivery therefore requires a new table, per recipient **and per
device**, because a message is only safe to drop once every device that will
ever want it has taken it:

```
message_deliveries
  message_id   uuid
  user_id      uuid
  device_id    uuid
  delivered_at timestamptz
  primary key (message_id, device_id)
```

Per-device rather than per-user is the important detail. A user with a phone
and a laptop who reads on the phone has not received it on the laptop, and
deleting at that point silently loses the message for the second device.

---

## 2. Local-first storage

Already true and already measured; this section records it rather than
proposing it.

- Both sides keep their own copy, sealed with the device database key
  (`keys.ts:92`), which never leaves the device.
- Chats open from local storage. Measured: conversation open **124.1 ms**
  median, below the 144.1 ms pre-Phase-1 baseline
  ([performance baseline §8](./performance-baseline.md)).
- The server is not consulted to read history — the delta path asks only what
  changed since a cursor.

Two known constraints stay true and are not solved here:

- **A page containing a placeholder is never cached** (`chat-service.ts:1330`),
  and never served from cache. One transient decryption failure must not become
  the stored text.
- **Browser eviction is real.** IndexedDB can be discarded by the browser.
  `navigator.storage.persist()` reduces the risk without removing it, which is
  why "server forgets" is riskier on web than on Android and why §1.2 keeps
  30 days.

---

## 3. Recovery

### 3.1 Shape

Unchanged from [the recovery architecture](./e2ee-recovery-architecture.md):

```
identity keypair   per device    non-extractable    never leaves the device
recovery keypair   per account   extractable once   wrapped, then stored
```

The identity key never becomes exportable. The recovery key is extractable for
one straight-line block with no network call inside it, then re-imported locked.

### 3.2 The change that makes recovery mean anything

`sealBody` must wrap the content key for each member's **recovery public key**
in addition to their devices. The envelope's `keys` map is already keyed by an
opaque id, so the format does not change — one extra ECDH per recipient.

Recovery public keys are readable by anyone: the migration grants
`select (user_id, public_key, version)` and nothing more. A public key is
public; `package` is not selectable at all.

### 3.3 New device restoration

1. New device generates its own fresh non-extractable identity, as now.
2. User enters the 12-word code.
3. `restoreRecoveryKey` opens the package; the recovery private key is
   re-imported non-extractable.
4. Every message wrapped for that recovery key is readable — including messages
   sent before this device existed.
5. Local database is rebuilt, then a normal delta sync fills the gap.

### 3.4 Enrolment is not retroactive

Stated plainly because it will otherwise be discovered as a bug: enabling
recovery today does **not** make yesterday's messages recoverable. Only
messages wrapped after enrolment carry a recovery wrap.

This is why §0.3 is urgent and why the product must say so at the moment of
enabling, not in a help article.

---

## 4. Google Drive backup

### 4.1 Rules

- **Opt-in only.** Never enabled automatically, never defaulted on.
- **AppData folder** (`drive.appdata`), not visible Drive — the user cannot
  delete it by accident and it counts against their quota, not ours.
- **Encrypted blobs only.** Drive receives the same bytes the server does, and
  can no more open them.
- **Recovery code required to restore.** Google cannot decrypt; neither can we.

### 4.2 What is uploaded

1. **The recovery package** — already implemented, byte-identical to the
   server's copy.
2. **An encrypted message archive**, sealed with a key derived from the
   *recovery* key rather than the device database key, because the restoring
   device will not have the old device's database key.

### 4.3 Backup policy

Not after every message. Uploading per message would burn Drive quota, battery
and API limits for no benefit.

| Trigger | Behaviour |
| --- | --- |
| App backgrounded | incremental, if anything changed since the last archived cursor |
| Periodic | on a schedule; Android may additionally wait for idle/charging |
| **Backup Now** | same code path, user-initiated, shows progress |

Incremental means appending messages newer than the last archived cursor —
the same cursor concept the delta sync already uses.

### 4.4 Integrity and anti-clobber

Every archive carries a generation number, mirroring the `version` column
already used by `recovery_packages`. A restore refuses a generation older than
one it has already passed, so a stolen token cannot strand a user on a stale
archive by re-uploading one. Blind overwrite is never used.

---

## 5. Platform split

One interface, two token sources, everything else shared.

```
DriveBackupTarget
  ├─ NativeDriveTarget   Android: native account picker, no browser
  └─ WebDriveTarget      Web: standard OAuth token flow
```

This mirrors the split that already exists for sign-in: `auth-service.ts:431`
selects `SupabaseNativeGoogleAuth` or `SupabaseGoogleAuth` behind one
`OAuthAuth` interface, and no screen knows which is in use.

**Platform-specific:** acquiring an access token. Nothing else.

**Shared:** encryption, chunking, upload, download, restore, integrity
verification. The Drive REST API is plain HTTPS and behaves identically inside
the Android WebView and in a browser, so there is exactly one implementation of
the part that can be wrong in interesting ways.

### 5.1 Drive scope must not be added to sign-in

Sign-in currently requests `openid email profile` with
`grantOfflineAccess: false` (`google-native.ts:70`), because it wants an **ID
token** for `signInWithIdToken`. Drive needs an **access token** carrying
`drive.appdata` — a different artefact for a different purpose.

Adding Drive to sign-in would ask every user for Drive access at signup even if
they never enable backup. The code already argues against exactly this:

> *"A scope we do not need is a scope we do not ask for, and the two doors must
> not differ in what they request."* — `google-native.ts:66`

Drive authorisation is therefore **incremental**: requested at the moment
Secure Backup is switched on, never before.

---

## 6. Native Android

### 6.1 Current state

`@codetrix-studio/capacitor-google-auth` gives a native account picker today
and is already wired (`google-native.ts`). It is built on the legacy Google
Sign-In SDK, which Google has deprecated in favour of Credential Manager for
identity and **`AuthorizationClient`** (Google Identity Services) for scoped
access.

### 6.2 Recommendation

`AuthorizationClient.authorize()` is the correct long-term API for Drive: it
presents a **native consent sheet with no browser**, and can re-authorise
silently once granted — which is what makes background backup possible at all.
There is no maintained Capacitor plugin for it, so it needs a small custom
plugin in Kotlin exposing one method, `requestDriveAccessToken()`.

**This is documented as a future migration and should not delay shipping.**
v1 may use the existing plugin's scope request. The migration is recorded here
so that when the legacy SDK is withdrawn, the reason and the target are already
written down rather than rediscovered.

### 6.3 Asymmetry to expect

Access tokens last about an hour. Android can re-authorise silently; the web
cannot without a server-side refresh exchange. The practical consequence:
**Android backs up in the background, web backs up while the tab is open.**
Periodic backup is Android-first, and the UI should not promise otherwise on
web.

### 6.4 Configuration that will otherwise cost a day

- Android OAuth client with SHA-1 **and** SHA-256 fingerprints registered;
  release signing differs from debug, which is the usual cause of "picker
  opens, no token".
- `drive.appdata` is a sensitive scope and needs Google OAuth verification
  before public launch. Lighter than full-Drive, not zero.

---

## 7. Threat model

| Threat | Mitigation |
| --- | --- |
| **Stolen phone** | Local cache is sealed with a non-extractable device key; an attacker with the files and no unlocked device has ciphertext. Weakness stated honestly: an unlocked, signed-in phone is a compromised account, and no key design fixes that. |
| **Stolen Drive access token** | Scope is `drive.appdata` only — no access to the user's other files. Blobs are ciphertext the token cannot decrypt. Generation numbers (§4.4) prevent silent clobber; the worst case is denial of backup, not disclosure. |
| **Stolen server database** | Ciphertext plus envelopes, no content keys and no `package` bytes. `recovery_packages.package` is not selectable by any client role. An attacker gets an offline target at the strength of the 12-word code, which is why the KDF is not optional. |
| **Lost device** | With recovery enabled: new device, code, restore, delta. Without: history is unreadable and always was — that is the guarantee, not a regression. |
| **Reinstall** | Identical to lost device. Recovery enrolment is what separates "inconvenient" from "gone". |
| **Multiple devices** | Every device gets its own wrap. Deletion is gated on `message_deliveries` per **device** (§1.4), so a second device that has not synced still receives history. |
| **Revoked backup** | Turning off Secure Backup deletes the Drive archive and rotates the recovery key. Old messages stay readable by the old key — retiring is not deleting — and the server package version is bumped so the retired key cannot be reinstalled by replay. |
| **Replay attacks** | `recovery_packages.version` increments on every upload and the client refuses a version it has already passed. Archives carry the same generation discipline. A server or Drive replaying an older artefact cannot make it decrypt to anything useful, and cannot strand the user on a rotated-away key. |
| **Backup corruption** | Each archive chunk carries an AEAD tag; AES-GCM fails closed rather than returning garbage. A failed chunk is a failed restore of that chunk, never silent substitution. Restore verifies the generation and total chunk count before writing anything to the local database, so a truncated archive cannot half-restore. |

### 7.1 What this design does not defend against

- A compromised recovery code opens **all** history, forever, including
  messages sent before the compromise. That is inherent to recovery existing;
  the compensations are opt-in, high-entropy codes and a slow KDF.
- Malicious code running in PINGO's own origin. Non-extractable keys mean it
  cannot exfiltrate the key, but it can read what the user can read.
- Traffic analysis. The server sees who talks to whom and when, and this
  document does not change that.

---

## 8. Order of work

Ordered so that nothing destructive ships before the thing that makes it safe.

| # | Work | Why here |
| --- | --- | --- |
| 1 | **Wrap to recovery key in `sealBody`** | Every day of delay permanently orphans more history (§0.3) |
| 2 | Wire recovery into onboarding + Settings | Makes §1 reachable; nothing recovers without enrolment |
| 3 | Encrypted archive + `DriveBackupTarget` + restore | Goal 7 satisfied, still zero new data-loss risk |
| 4 | Prove restore on real devices | Gate for everything below |
| 5 | `message_deliveries` + configurable retention (30 days) | First step that can delete data |
| 6 | Shorten retention; consider relay-only delivery | Only once 4 has held for a while |
| 7 | `deviceIdentity()` race fix (§7.4 below) | Small, independent, no longer urgent |

**§7.4 — the residual identity fix.** `deviceIdentity()` (`keys.ts:54`) is
check-then-act: two concurrent callers can both observe empty slots and both
generate. Last write wins, so the outcome is one identity, but the losing
caller may already have used the other. Not observed in the wild and not the
cause of anything in §0.1; worth closing with a single-flight promise.

---

## 9. Decisions recorded

| Question | Decision |
| --- | --- |
| Retention window | **30 days**, server-configurable. Not 24 hours yet. |
| Relay-only delivery | **Not yet.** Keep row-based until receipts, restore and multi-device are verified. |
| If a user declines Secure Backup, do we still delete their server copy? | **Open.** Must be answered before §8 item 5. |
| Media in backups | **Open.** Chats-only for v1 is the cheaper first step. |
| `AuthorizationClient` migration | Documented as future (§6.2); must not delay shipping. |
