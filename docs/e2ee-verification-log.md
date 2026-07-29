# PINGO — E2EE verification log

Evidence, not verdicts. A row that says only "pass" is worth nothing six months
later when something regresses and nobody can remember what "pass" meant.

**Rule:** nothing is recorded here until it has been observed running. Anything
unexpected is written down *before* it is fixed, so the log shows what happened
rather than what we ended up wishing had happened.

## Release gate

| # | Item | State |
| --- | --- | --- |
| 1 | Single-user E2EE | ✅ verified |
| 2 | Recovery crypto | ✅ verified |
| 3 | Recovery gate | ✅ verified |
| 4 | Downgrade guard | ✅ verified |
| 5 | User A ↔ User B | ⏳ blocked — no second account |
| 6 | Android ↔ Web | ⏳ blocked — no device attached |
| 7 | Android ↔ Android | ⏳ blocked — needs two devices |
| 8 | Offline recovery validation on Android | ⏳ blocked — **and needs defining, see below** |

Recovery UI stays disabled until 5–8 are green.

### On item 8, before anyone runs it

**A recovery package cannot be fetched offline.** It lives on the server behind
`claim_recovery_package`, and the delay it enforces is deliberately something
the client cannot evaluate for itself. So "offline recovery" cannot mean
"restore an account with no network", and building toward that reading would
mean caching the package locally — which would put the thing recovery exists to
protect onto the disk of a device that has not been authorised yet.

What can be validated offline on Android, and is worth validating:

- **After** a restore, encrypted history opens with no network, from the sealed
  cache, using the restored key.
- A restore that begins online and loses the network mid-flight fails closed
  and leaves no partial key material behind.
- The outbox still queues, seals and flushes on reconnect with a restored key.

Confirm this is the intended reading before the run.

---

## Template

Every entry uses this shape. Blank fields are recorded as *not captured* rather
than omitted — a missing field is information about the run.

```
### <id> — <test name>
Environment   Web/Android · browser or WebView build · app bundle or APK version
Expected      What should happen, written before running it
Observed      What actually happened, quoted
Server        Ciphertext, wrap counts, row counts — copied, not summarised
Client        Decrypt result, key flags, cache state
Result        PASS / FAIL
Notes         Anything surprising, including things that turned out fine
```

---

## 1 — Single-user E2EE ✅

**Environment** Web · desktop Chrome (exact version *not captured* — add to
future runs) · `pingochat.pages.dev`, bundle `index-D8f8vZnG.js`
**Date** 2026-07-28

| Test | Expected | Observed | Result |
| --- | --- | --- | --- |
| Ciphertext at rest | Typed text absent from server | Typed `E2EE-PROBE-ALPHA-7731`; stored `heGvk+E52fBJdROt3qen/KaR3YPT2YsKnUSWiojCAMQqfSbQfw==` | PASS |
| No plaintext on server | 0 matches table-wide | `plaintext_anywhere_in_messages: 0` | PASS |
| Legacy readable | Untouched, renders | 1,927 rows `encryption is null`, thread rendered | PASS |
| Legacy → E2EE | Both coexist, no migration | `legacy_total: 1927`, `v1_total: 1`, `broken_ciphertext: 0` | PASS |
| Realtime | Second tab updates live | Tab B showed the message with no reload, no placeholder | PASS |
| Offline → reconnect | Queue, then flush as ciphertext | Queued sealed; absent from server; flushed as `PBeaVVQASPMCEI91+6H7QecEayhZfwhiGu1mK1nqk4lhk+EhgJY9` | PASS |
| Background sync | Outbox drains on fresh load | `outboxRemaining: 0` after reload | PASS |
| Cache-first | Paints before network | Network delayed 4,000 ms → **thread painted in 5 ms** | PASS |
| Multi-tab | One identity per origin | Both tabs `7459f127-f5b4-485b-b59a-1106f9efe101` | PASS |
| Refresh | Decrypts after reload | Probe visible in thread and list preview | PASS |
| Service worker | Update strategy understood | Served stale bundle for one load → fixed with NetworkFirst navigations | PASS (after fix) |
| Device registration | Publish + persist | SPKI `MFkwEwYHKoZIzj0CAQYIKoZI…`, 124 chars; id stable across 3 reloads | PASS |
| No plaintext in IndexedDB | All stores sealed | conversations/messages/outbox/drafts → `unsealed: 0`; probe string not findable | PASS |

**Client evidence** identity `ECDH P-256`, `privateExtractable: false`;
database key `AES-GCM 256`, `extractable: false`; IndexedDB `version: 2`,
stores include `keys`.

**Unexpected behaviour found during this run** (all recorded before fixing):
`keys` store never created because `DB_VERSION` was not bumped — identity
regenerated on every load, one dead `device_keys` row per visit, sealed cache
unreadable. Also: stale plaintext cache records surviving on disk; silent send
failure; service worker serving the previous bundle.

---

## 2 — Recovery crypto ✅

**Environment** Node v24.18.0 Web Crypto · real module
`src/lib/crypto/recovery.ts` bundled by esbuild — **not** a reimplementation
**Command** `pnpm verify:recovery` · **Result** 21/21 PASS, exit 0

| Group | Evidence |
| --- | --- |
| Code | 12 words; 200/200 generated codes distinct; checksum rejects one swapped word; unknown word reported by index |
| Package | `kdf: pbkdf2-sha256-600000`; code absent from package |
| Key flags | Returned **and** restored keys both `extractable: false` |
| Identity of key | Restored key derives the **same ECDH bits** against a third party — same key, not merely a working one |
| Refusals | Wrong code, flipped byte, swapped IV, attacker-made package → all `bad-code` |
| Rollback | v1 offered when v2 seen → `rolled-back`; newer accepted; unknown KDF → `unsupported-kdf` |

**Negative control** inverting the non-extractable assertion produced
`FAIL the returned recovery key is NOT extractable`, exit 1. The suite can fail.

---

## 3 — Recovery gate ✅

**Environment** Web · live PostgREST as the real signed-in session · deployed
database. No token or key left the page.

| Test | Expected | Observed | Result |
| --- | --- | --- | --- |
| Package column hidden | Unreadable even when row exists | HTTP 403 | PASS |
| Public columns readable | `public_key`, `version` readable | 200, `PUB` returned | PASS |
| Forge a request | Rejected | HTTP 403 inserting `recovery_requests` | PASS |
| Untrusted delay | ~24 h, unapproved | `24.0h`, `approved_at: null` | PASS |
| Claim before maturity | Refused | `RC007` | PASS |
| Cancel then claim | Refused, different reason | `RC006` | PASS |
| Unknown request | Refused | `RC005` | PASS |
| Trusted device | Immediate, package returned | approved on the spot; `SECRET-PACKAGE-BYTES`, version 2 | PASS |

**Unexpected behaviour** upsert (`merge-duplicates`) returns
**403 permission denied** — `ON CONFLICT DO UPDATE` needs table-level `SELECT`,
which is revoked to hide the package. `POST` 201 and `PATCH` 204 both work.
Recorded in the plan; rotation must be a `PATCH`. Also `TRUNCATE` was still
granted on `recovery_requests`, letting a device erase the audit log it appears
in — revoked in `20260805010000`.

---

## 4 — Downgrade guard ✅

**Environment** Web · deployed build · single-member probe conversation

| Step | Expected | Observed | Result |
| --- | --- | --- | --- |
| Baseline | Message stored encrypted | `encryption: v1`, body `nFpL7jZSL55qk/oSMP/NJJQODksd…` | PASS |
| Key removed, send | Refused, visible, nothing written | *"This chat is end-to-end encrypted, but a key for everyone in it is not available right now. Your message has not been sent."* | PASS |
| Text preserved | Restored to composer | `DOWNGRADE-ATTEMPT-8802` back in the box | PASS |
| Server | No plaintext row | `plaintext_rows: 0`, `probe_leaked: 0`, table-wide `0` | PASS |

**Note — an earlier claim was retracted.** This test was first reported as
passing when the send had never fired: synthetic `Return` keypresses were not
reaching React, so "0 plaintext rows" only meant nothing was sent. Dispatching
a real `keydown` fixed the harness. The same artefact explained two apparent
failures in §3 that were cascades from a seed that never landed. Kept here
because a log that only records successes teaches nothing.

---

## Database hygiene

Every run ends with the database restored. After the runs above:
1,927 messages · 0 encrypted · 0 recovery packages · 0 recovery requests ·
probe conversations deleted · 1 device key.

---

## 9 — Android Auto Backup ⚠️ open question, mitigated

**Environment** Android manifest · merged by `:app:processDebugMainManifest`,
exit 0

| Item | Evidence |
| --- | --- |
| Was enabled | `android:allowBackup="true"` at `AndroidManifest.xml:5` |
| Now | Merged manifest shows `android:allowBackup="false"` and `android:dataExtractionRules="@xml/data_extraction_rules"` |
| Rules | `cloud-backup` and `device-transfer` both exclude every domain |

**Still unanswered, and it needs a device.** Whether Auto Backup *would* have
captured the WebView's IndexedDB — in particular the stored `CryptoKey`
material — and whether that material would have been usable after a restore.
The configuration made it possible; nobody has shown it happened.

Worth answering even though the flag is now off, because the answer decides
whether shipped APKs already placed key material in users' Drive accounts. Run
it when a phone is attached: install a build with `allowBackup="true"`, trigger
`bmgr backupnow`, restore to a wiped device, and look for readable key material.

---

## 5–8 — pending

Not started. Blocked on a second account (`kashish_` is currently the only
account with a published key) and on an Android device (`adb devices` lists
none). Each will be recorded in the template above, including **APK version and
WebView build**, which the completed Web runs did not capture and should have.
