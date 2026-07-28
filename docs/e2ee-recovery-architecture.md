# PINGO — key recovery architecture

**Status:** design only. No implementation, no production code, nothing shipped.
**Scope:** how a person who loses a device gets their encrypted history back.
**Constraint:** [the E2EE design](./e2ee-architecture.md) is unchanged, and
identity keys stay `extractable: false`.

---

## 0. The problem, stated honestly

Today, losing a device loses the conversation. The private key was generated in
the browser, marked non-extractable, and never left — which is exactly why the
server cannot read anything, and exactly why nobody can get it back.

That is not a bug to be patched. It is the guarantee, working. Recovery means
deliberately introducing a second path to the plaintext, and the whole of this
document is about making that path as narrow as it can be.

## 1. The reframe: do not back up the identity key

The obvious move — make the identity key extractable so it can be exported —
is the wrong one, and it is worth being precise about why.

An extractable key is extractable **for its whole life**. Every line of code
that runs in PINGO's origin, for as long as that key exists, can call
`exportKey` and get the bytes. One XSS, one compromised dependency, one
careless logging call, and the key that decrypts every message is a string.
The non-extractable flag is the only protection in this system that does not
depend on the codebase staying careful, and trading it away buys nothing that
cannot be bought another way.

**The other way:** leave the identity key alone and add a *second* key whose
only job is recovery.

```
   identity keypair        per device   non-extractable   never leaves
   recovery keypair        per account  extractable once  wrapped, then stored
```

The envelope already wraps the content key once per recipient *device*
(§9 of the E2EE design). Wrapping it once more — for the recipient's **account
recovery public key** — costs one extra ECDH per message and changes no
format, because the envelope's `keys` map is already keyed by an opaque id.

Then:

- A new device generates its own fresh, non-extractable identity, as now.
- To read *history*, it restores the recovery private key.
- Every message ever wrapped for that account is readable, because every
  message was wrapped for the recovery key too.

The identity key never becomes exportable. Requirement 2 is kept literally,
not approximately.

### The recovery key is extractable — for milliseconds

It has to be, once: it must be exported to be wrapped and stored.

```
generate(extractable: true) → export raw → wrap with recovery secret
                            → upload ciphertext
                            → re-import with extractable: false
                            → discard the extractable handle
```

After that moment the recovery key is as locked-down as the identity key on
every device that holds it. Its exportable existence is bounded by a few lines
of straight-line code with no network call in the middle, rather than by the
lifetime of the application.

This is the single most important property in this document. It is what makes
recovery possible without permanently weakening anything.

---

## 2. What the recovery key costs, precisely

Requirement: *explain exactly what guarantees would be lost.*

| Guarantee | Today | With a recovery key |
| --- | --- | --- |
| Server can never read messages | holds | **holds** — the server stores only ciphertext it has no secret for |
| Private key cannot be exfiltrated by same-origin code | holds | holds for identity; recovery key is exportable only during creation |
| Compromising one device reveals only that device's messages | holds | **weakened** — the recovery key opens everything, on any device that restores it |
| History is unrecoverable if the device is lost | holds | **deliberately broken** — that is the feature |
| Offline attack on stored material is useless | holds (nothing is stored) | **weakened** — a stolen server blob can be attacked offline at the strength of the user's secret |

The third and fifth rows are the real price. A recovery key is a
single point of failure by construction: one secret that opens all history,
forever, including messages sent before it was compromised.

**Compensating protections**, in the order they matter:

1. **Opt-in.** Nobody who does not ask for recovery has a recovery key, and
   nobody who does not have one can have it stolen. The default stays as strong
   as it is today.
2. **The wrapping secret never reaches the server.** Whatever protects the blob
   — passphrase, platform key, paired device — is derived or held client-side.
   The server's copy is inert.
3. **A slow KDF.** Argon2id, or PBKDF2 with a high count where Argon2 is not
   available. This is what converts a weak human passphrase into something an
   offline attacker cannot grind cheaply. It is not optional; without it the
   passphrase *is* the security and human passphrases are bad.
4. **High-entropy secrets by default.** A generated 12-word recovery code
   rather than a chosen passphrase, because chosen passphrases are reused and
   guessable and this one guards everything.
5. **Rotation is possible.** `device_keys` is already keyed per device; a
   recovery key can be retired the same way. Old messages stay readable by the
   old key, which is why retiring is not deleting.

---

## 3. The four approaches

### A. Device-to-device transfer

The old device wraps the recovery key (or the history keys directly) to the new
device's public key, over a channel authenticated out of band — a QR code the
new device displays, or a short authentication string both people compare.

- **Security: best available.** No server trust, no stored blob, no passphrase
  to guess. The QR carries the new device's public key, so there is nothing to
  intercept that is useful. This is Signal's device-linking model and it is
  strong for good reasons.
- **UX: excellent when it applies, useless when it does not.** It requires the
  old device to be present and working — which is precisely not the case in the
  most common recovery scenario, a phone that was lost, stolen or broken.
- **Complexity: moderate-to-high.** Pairing transport, a signalling channel,
  SAS comparison UI, and a careful state machine. PINGO already has WebRTC
  signalling and a QR renderer, which lowers this considerably.
- **Maintenance: low once built.** No stored artefact ages, nothing expires,
  no server-side secret material to look after.

**Verdict: necessary, not sufficient.** It is the best *transfer* mechanism and
it is not a *recovery* mechanism, because it cannot help the person whose only
device is gone.

### B. Encrypted cloud backup with a recovery passphrase

The recovery key is wrapped with a key derived from a user secret and stored on
PINGO's server as opaque ciphertext.

- **Security: entirely determined by the secret and the KDF.** With a generated
  high-entropy code and Argon2id, strong. With a user-chosen passphrase and a
  weak KDF, theatre. There is no middle setting that is quietly fine.
- **UX: the only one that works when the device is gone.** It is also the one
  that asks the user to keep something safe, which is the step people fail.
- **Complexity: moderate.** A KDF, a wrap, one table, one restore screen. No
  new transport, no new protocol.
- **Maintenance: moderate.** The stored blob must survive schema changes and
  key rotations for years, and a bug that makes old blobs unreadable is
  unrecoverable data loss for people who are already having a bad day.

**Verdict: the necessary backstop.** It is the only approach that covers the
case recovery exists for.

### C. Recovery passphrase with no server copy

The user holds the only copy — a printed code, a password manager entry.

- **Security: excellent.** Nothing to steal server-side, no offline attack
  surface at all.
- **UX: poor, honestly.** People lose paper and do not notice until they need
  it. The failure is silent and total, discovered months later.
- **Complexity: lowest of all.** Derive, display once, verify the user has it.
- **Maintenance: near zero.**

**Verdict: a good option to offer, a bad option to rely on.** Worth building
because it is nearly free once (B) exists — the same wrapped blob, handed to
the user instead of the server.

### D. Hardware-backed platform keystores

Android Keystore, iOS Secure Enclave, or WebAuthn with the `prf` extension.

- **Security: excellent at rest.** Key material never enters JavaScript;
  operations happen behind a hardware boundary and can require biometric
  presence.
- **UX: the best of any option — no passphrase at all.**
- **Complexity: high, and uneven.** The Android Keystore is unreachable from a
  WebView without a native plugin and a bridge, which contradicts the
  "identical between Web and Android WebView" constraint the E2EE design is
  built on. WebAuthn PRF avoids that entirely — it is a browser API — but
  support is recent and not universal.
- **Maintenance: high.** Platform APIs, per-OS behaviour, and failure modes
  that only appear on hardware the team does not own.

**The critical nuance:** a hardware key is *device-bound*. It protects the key
beautifully and it disappears with the device, so on its own it is **not a
recovery mechanism at all** — it is a better lock, not a spare key. It becomes
one only when the platform syncs it: a passkey stored in iCloud Keychain or
Google Password Manager follows the user to a new device, and WebAuthn PRF can
then re-derive the same wrapping secret there.

**Verdict: the best long-term answer, and the one to design toward rather than
build first.** PRF-derived wrapping removes the passphrase — the weakest link
in (B) — without adding a native plugin.

---

## 4. Comparison

| | Security | UX | Complexity | Maintenance | Covers a lost device? |
| --- | --- | --- | --- | --- | --- |
| A. Device-to-device | Best | Good | Moderate–high | Low | **No** |
| B. Cloud + passphrase | Secret-dependent | Fair | Moderate | Moderate | **Yes** |
| C. Passphrase only | Excellent | Poor | Low | Very low | Yes, if not lost |
| D. Platform / PRF | Excellent | Best | High | High | Yes, if synced |

No single row wins, which is the actual finding. A is the strongest and cannot
help the main case; D is the nicest and is not universally available yet; B
covers the case and is only as good as a human secret.

---

## 5. Recommendation

**A layered design, built in this order.**

1. **The account recovery key** (§1) as the foundation. It is what every other
   layer moves around, and it is what keeps the identity key non-extractable.
   Nothing else can be built until this exists.
2. **Recovery code, generated not chosen** — 12 words, ~128 bits, Argon2id.
   Shown once, verified once, and offered both as a server-stored blob (B) and
   as a user-held code (C). Same artefact, two homes; the user picks whether
   PINGO holds a copy.
3. **Device-to-device transfer** (A) as the preferred path whenever the old
   device still works, because it is strictly stronger and asks the user to
   remember nothing. Most "new phone" journeys are this, not true loss.
4. **WebAuthn PRF** (D) as an upgrade that replaces the recovery code where the
   browser supports it, falling back to the code where it does not. Designed
   for now, built later.

**Explicitly rejected:** backing up to the platform's own cloud without a user
secret (Android Backup, iCloud) — the provider could read it, which contradicts
the one promise this whole system makes. And any server-held escrow, for the
same reason.

**Kept unchanged:** identity keys stay `extractable: false`, the server keeps
storing only ciphertext, and cache-first performance and offline behaviour are
untouched — none of this is on the message path.

### What is still unsolved

- **The recovery key opens all history.** Layering cannot remove that; only a
  ratchet with per-epoch keys could, and that is a much larger change.
- **Restoring on a hostile device** hands that device everything. Device
  verification (roadmap #4) is the prerequisite, not an optional extra.
- **A forgotten recovery code is still total loss.** Deliberately. The
  alternative is an escrow that can be compelled.

---

## 6. Order of work, when this is approved

| # | Step | Depends on |
| --- | --- | --- |
| 1 | Publish an account recovery public key; wrap envelopes for it | — |
| 2 | Generate/wrap/restore the recovery key with a generated code | 1 |
| 3 | Restore flow, and the placeholder for messages predating recovery | 2 |
| 4 | Device-to-device transfer over existing signalling | 1 |
| 5 | WebAuthn PRF as an alternative wrapping secret | 2 |

Step 1 is the only one that touches the message path, and it is additive: an
account with no recovery key gets no extra wrap, exactly as today.
