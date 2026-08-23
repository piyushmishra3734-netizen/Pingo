# PINGO — backup security review

**Status:** adversarial review of the design in
[effortless-backup-plan.md](./effortless-backup-plan.md), before implementation.
**Stance:** written to break the system, not to approve it.
**Verdict:** §6.

---

## 1. Key hierarchy

| Key | Created by | Lives | Reachable by | Opens | Must never open | Backed up | Destroyed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Device identity** `identity:v1` | device, non-extractable | IndexedDB `keys` | that device only | message wraps addressed to it | anything after the device is gone | **never** — by design | account switch to an unseen account; database wipe |
| **Device database key** `database:v1` | device, non-extractable | IndexedDB `keys` | that device only | that device's sealed local records | another device's records | **never** | same |
| **Recovery keypair** | device at enrolment, private half extractable for one block | private wrapped in `recovery_packages` + Drive mirror; public in `recovery_packages` | whoever holds the code/password/passkey | archives **and every message envelope ever wrapped to it** | — | as a wrap | on disable, when the wrap is deleted |
| **Archive keypair** *(Simple, planned)* | device at mode selection | private in Drive `appDataFolder` | anyone with the Google account | archives sealed to it | **any message envelope** — enforced by `verify:key-isolation` | it *is* the backup key | on switch to Private, last step |
| **Per-archive ephemeral** | builder, per archive | never stored; public half in manifest | nobody | nothing alone | — | no | at end of `sealArchive` |
| **Content key** | sender, per message | never stored; wrapped per recipient | recipients | that message | — | via wraps | after wrapping |
| **KEK** *(Private, planned)* | `HKDF(PRF)` or `PBKDF2(password)` | never stored | the user | the recovery wrap | archives directly | no — rederived | on rotation |
| **Drive access token** | Google | IndexedDB `meta`, sealed | that device | Drive `appDataFolder` | — | no | disconnect; expiry |

```
                 ┌───────────────── user ─────────────────┐
                 │  passkey PRF        backup password    │   Private only
                 └──────────┬─────────────────┬───────────┘
                            └── KEK ──────────┘
                                   │ unwraps
                        ┌──────────▼──────────┐
                        │  recovery keypair   │──opens──▶ archives
                        └──────────┬──────────┘           AND every message
                                   │                       envelope  ⚠
                                   │
   Google account ──▶ archive keypair ──opens──▶ archives only
        (Simple)         (in Drive)              never messages ✔ tested

   device identity ──opens──▶ messages addressed to this device
   device db key   ──opens──▶ this device's local cache
```

The asymmetry marked ⚠ is the single most important fact in this document and
is what §9 of the plan exists to contain.

---

## 2. Trust boundaries

| Party | Learns | Cannot learn |
| --- | --- | --- |
| **User** | everything they are a party to | other conversations |
| **Device** | its own messages, its own cache | messages sealed before it existed, unless recovery is enrolled |
| **Google Drive** | archive ciphertext, sizes, chunk counts, backup times, **and in Simple mode the archive key** | message envelopes on our server; in Private mode, anything at all |
| **Google Account** | in Simple mode, everything in the backup | in Private mode, nothing |
| **PINGO server** | ciphertext, envelopes, who talks to whom, when, device counts, `last_seen_at` | message plaintext where `everyoneReady` held; recovery packages (`package` not selectable); **never any backup, in either mode** |
| **Firebase** | not in use for backup | — |
| **Passkey provider** | that a credential exists; syncs it | PRF output leaves the authenticator only as a derived value inside the client |
| **Password manager** | the backup password if the user stores it there | — |

**The one guarantee that does not vary by mode:** PINGO never holds a key that
opens a backup. Simple mode trades with Google; it does not trade with us.

---

## 3. Threat model

| Attack | Simple mode | Private mode |
| --- | --- | --- |
| **Google account compromise** | **Full history disclosed.** Archive key is in `appDataFolder`. | Ciphertext only. Attacker also needs the passkey or password. |
| **Device theft, locked** | Local cache sealed; Drive token sealed | same |
| **Device theft, unlocked** | everything on that device | everything, and the passkey will assert |
| **Stolen archive (Drive blob only)** | useless without the key file | useless |
| **Stolen archive key** | equals Google account compromise | n/a |
| **Stolen recovery key** | n/a in Simple (see §5 gap) | **catastrophic — opens archives *and every message envelope*** |
| **Password guessing** | n/a | **offline attack on a stolen blob; PBKDF2-600k is too weak for human passwords** |
| **Passkey loss** | n/a | history unrecoverable unless a password was also set |
| **Insider / malicious employee** | cannot read backups | cannot read backups |
| **Database breach** | no backup key present | no backup key present |
| **Replay of an old archive** | ✗ **unprotected on a fresh device** | ✗ **same** |
| **Rollback via HEAD rewrite** | ✗ **HEAD is unauthenticated** | ✗ **same** |
| **Archive substitution / forgery** | ✗ **attacker with Drive can forge a whole history** | ✓ cannot produce valid AEAD without the key |
| **Metadata leakage** | sizes, counts, cadence; `device_keys.last_seen_at` world-readable | same |
| **Cross-device** | any device on the Google account restores | requires passkey or password |

---

## 4. Mode switching

Reviewed against the plan's §12.

| Property | Simple → Private | Private → Simple |
| --- | --- | --- |
| Data loss | none — deletion is last | none |
| Orphan archives | none — public-key sealing is unchanged | none |
| Broken restores | none for one generation overlap | none |
| Rollback safety | inverse exists | inverse exists |
| Interruption safety | safe at every step | safe at every step |
| Idempotency | re-running re-wraps harmlessly | re-running rewrites the key file |

**Both directions are sound as written — but Simple → Private step 2 cannot be
executed as specified.** See §5, gap 1. This is the blocking issue.

---

## 5. Invariants, and whether anything enforces them

| # | Invariant | Why | Enforced by |
| --- | --- | --- | --- |
| 1 | Archive key never opens a message envelope | Simple mode gives Google the archive key | ✅ `verify:key-isolation` — **proven to fail when broken** |
| 2 | Recovery key never leaves the device unwrapped | it opens all history | ✅ `verify:recovery` |
| 3 | Chunks bound to generation and index | prevents splice/reorder | ✅ `verify:archive` |
| 4 | Deletion is the last step of a backup | never destroy a good backup | ✅ `verify:drive-target` |
| 5 | Enrolment confirmed before reporting success | no switch reading "on" over nothing | ✅ `verify:secure-backup` |
| 6 | Telemetry carries no identifier | policy | ✅ `verify:backup-ux` |
| 7 | **HEAD is authentic** | it selects which archive is current | ❌ **no mechanism, no test** |
| 8 | **A fresh device refuses an old generation** | rollback on the restore path | ❌ **no test; `seenGeneration` defaults to 0** |
| 9 | **Archive key is never stored server-side** | would give PINGO the backup | ❌ no test |
| 10 | **Password meets a strength floor** | offline attack | ❌ no mechanism |
| 11 | **Recovery key is never written to Drive** | would defeat §9 entirely | ❌ no test |

### Gap 1 — Simple mode leaves the recovery key homeless *(critical)*

Plan §12 Simple → Private says "wrap the **recovery** private key". In Simple
mode that key's private half is protected by nothing: there is no code, no
password, no passkey, and putting it in Drive is exactly what §9 forbids.

Three resolutions, and one must be chosen before code is written:

1. **Simple mode has no recovery keypair.** `sealBody` stops adding a recovery
   wrap while in Simple mode. Switching to Private then protects future messages
   only, and the switch screen must say so. *Recommended — it is the only option
   that keeps §9 true.*
2. Recovery key exists but is wrapped under the archive key. Collapses the two
   keys and re-opens the whole hole. **Reject.**
3. Recovery key is generated at switch time. Same as (1) with extra steps.

### Gap 2 — rollback on a fresh device *(critical)*

`archive.ts:198` and `drive-target.ts:248` default `seenGeneration = 0`, and a
restoring device has no local state by definition. An attacker with Drive write
access can point HEAD at an older generation and it is accepted.

**Proposed fix:** store the current generation server-side as a non-secret
integer, written on each successful backup. A fresh device reads it and passes
it as the floor. The server cannot read the archive, so this costs no
confidentiality and closes the replay.

**Closed 2026-08-23**, together with Gap 3. See "What actually shipped" below.

### Gap 3 — HEAD is unauthenticated *(critical)*

`drive-target.ts:114` parses HEAD with a bare `JSON.parse`. It is the commit
pointer for the whole backup. Whoever can write Drive chooses which generation
is current, and in Simple mode can forge the archive it points at.

**Proposed fix:** the server-side generation from Gap 2 doubles as the check.
Additionally, sign HEAD and the manifest with a key derived from the archive or
recovery key, so a forged pair fails before any chunk is fetched.

**Closed 2026-08-23**, but not by the second half of that proposal, which is
wrong. See below.

### What actually shipped for Gaps 2 and 3

Building the proposed signature showed it could not work. In Simple mode the
archive's private key lives in the Drive `appDataFolder` in the clear, beside
the archive it opens — the deliberate trade `archive-key.ts` documents and the
thing that makes restore automatic. An attacker with write access to that folder
therefore holds that key, and can:

* seal a complete, well-formed archive of their own that decrypts perfectly,
  because the key that opens it is the key they took;
* compute any MAC or signature derived from it, so signing HEAD proves nothing;
* put HEAD back to an older genuine generation, which needs no key at all.

Every proposed defence sat inside the blast radius of the attacker it was
defending against. Signing HEAD with a key stored next to HEAD is decoration.

What that attacker does not have is the account's PINGO session. So both gaps
are closed by one thing outside the folder: `backup_anchor`, a row holding the
current generation and the SHA-256 of its manifest
(`supabase/migrations/20260937000000_backup_anchor.sql`,
`apps/web/src/lib/backup/anchor.ts`).

* **Rollback** — `set_backup_anchor` refuses a generation that is not strictly
  greater than the one recorded. The number the attacker has to beat is not in
  Drive.
* **Forgery** — the manifest hash pins which archive that generation is. A
  substitution is refused before a single chunk is downloaded.
* **Ordering** — the anchor is written *between* the manifest upload and the
  HEAD commit, so every generation a restore can reach was anchored first. A
  HEAD ahead of the anchor is therefore evidence, not a race, and is refused.
  Anchoring after the commit would leave a window indistinguishable from
  forgery.

The server still cannot read anything: it holds a counter and a hash of a
manifest that is already plaintext in Drive and that we have never seen.

Two limits, both deliberate. An account with no anchor — every backup made
before this — restores as it always did; one backup ends that grace. And nothing
here stops **deletion**: whoever can write the folder can empty it, which is why
the backup exists rather than something the backup defends against.

`pnpm verify:backup-anchor` plays the attacker. Its control case runs the same
working forgery with no anchor supplied and asserts that it restores cleanly, so
the suite fails if the check is ever removed rather than passing quietly.

### Gap 4 — password KDF is too weak for human passwords *(high)*

`recovery.ts:22` is `pbkdf2-sha256-600000`, chosen deliberately for a generated
128-bit code, and the comment says so. A user-chosen password has far less
entropy and the blob is offline-attackable. Private mode's password option needs
**Argon2id** plus a minimum-strength policy, or it is materially weaker than the
passkey path while looking equivalent in the UI.

### Gap 5 — `device_keys.last_seen_at` is world-readable *(high)*

`20260804000000_e2ee_foundation.sql:101` grants select to all authenticated
users. The comment justifies exposing *existence and device count*. It does not
justify `last_seen_at`, which is a behavioural signal — any account can poll when
any user was last online. Restrict the column or coarsen it.

### Gap 6 — `everyoneReady` scoping *(medium, honesty)*

Encryption engages only when every member has published a device key; measured
earlier, 3 of 7 contacts had none. Where it never engaged, the server holds
plaintext, and "Private Backup" then protects an archive of data the server
already had in clear. True, defensible, and it must not be implied otherwise.

---

## 6. Verdict

### READY WITH REQUIRED CHANGES

The core is sound: public-key sealing makes mode switching non-destructive,
deletion-last makes interruption safe, and the archive/recovery separation is
enforced by a test proven to fail when violated. Nothing here requires redesign.

Four items must land before production code.

| Rank | Change |
| --- | --- |
| **Critical** | Gap 1 — decide where the recovery key lives in Simple mode. Recommend option (1): no recovery wrap while Simple. |
| ~~**Critical**~~ | ~~Gap 2 — server-side generation floor.~~ Shipped 2026-08-23 as `backup_anchor`. |
| ~~**Critical**~~ | ~~Gap 3 — authenticate HEAD and the manifest.~~ Shipped 2026-08-23; the signature half of the proposal was wrong and is not what landed. |
| **High** | Gap 4 — Argon2id and a strength floor for backup passwords. |
| **High** | Gap 5 — stop exposing `last_seen_at` to every authenticated user. |
| **Medium** | Gap 6 — state the `everyoneReady` scope in the mode-choice copy. |
| **Medium** | Tests for invariants 9 and 11. |
| **Low** | Archive-key rotation after a Google account compromise. |

Gaps 2 and 3 shared one fix and were implemented together, though not the one
proposed here — see "What actually shipped". Gap 1 is the only
one that changes the design rather than hardening it, and it blocks Simple mode
specifically.
