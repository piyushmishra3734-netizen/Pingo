# PINGO — effortless backup

**Status:** design. No code written for anything below.
**Reads with:** [relay, recovery and backup](./e2ee-relay-and-backup-plan.md) ·
[recovery architecture](./e2ee-recovery-architecture.md) ·
[E2EE design](./e2ee-architecture.md)

The goal is WhatsApp's experience — tap once, chats are protected, a new phone
offers to restore them — without WhatsApp's compromise, which is that their
effortless backup is not end-to-end encrypted and Google can read it.

---

## 0. The constraint everything else follows from

The recovery key is derived today from a twelve-word code that exists only in
the user's head. That is exactly why neither PINGO nor Google can open a backup.

If the user is to remember nothing, the key has to come from somewhere
automatic, and there are only four somewheres:

| Derived from | Who can decrypt | Survives losing the phone |
| --- | --- | --- |
| A secret the user knows (today) | the user | yes |
| Our server | the user **and PINGO** | yes |
| Google | the user **and Google** | yes |
| The device alone | the user | **no** — which defeats the feature |

There is no fifth. "Nobody but the user can decrypt" and "the user remembers
nothing" are irreconcilable *unless the secret lives in an authenticator the
user already carries*. That is what a passkey is, and it is why this design is
built on one.

**Recorded so it is not rediscovered:** WhatsApp's frictionless Google Drive
backup is not end-to-end encrypted. Their encrypted backup asks for a 64-digit
key or a password with an HSM behind it. They met this same wall and chose to
ask for a secret. We are choosing the authenticator instead.

---

## 1. Threat model

### 1.1 What the design defends against

| Adversary | Outcome |
| --- | --- |
| **Google** | Holds ciphertext and an ephemeral public key. The PRF output never leaves the authenticator, so no wrap is openable. Reads nothing. |
| **PINGO server, breached or subpoenaed** | Holds a wrapped recovery key, a non-secret salt and credential ids. No PRF output, therefore no KEK. Reads nothing. **This is the property server escrow would have given away.** |
| **Network attacker** | TLS, and the archive is sealed before it leaves the device. |
| **Stolen phone, locked** | Passkeys require user verification — biometric or device PIN. |
| **Someone with the account password** | Cannot restore: signing in does not produce a passkey assertion. |
| **Another PINGO user** | `drive.appdata` is per-application and per-account; nothing is shared. |

### 1.2 What it does not defend against

- **A stolen, unlocked phone with the passkey on it.** The authenticator will
  assert for whoever holds it. No key design fixes an unlocked device.
- **A compromised platform password manager.** If an attacker owns the Google
  account *and* can satisfy user verification, synced passkeys travel with it.
  This is the honest cost of syncing, and it is what makes restore possible at
  all.
- **Malicious code in PINGO's own origin.** It can ask for an assertion while
  the user is present. Non-extractable keys limit exfiltration, not misuse.
- **Traffic analysis.** The server still sees who talks to whom.

### 1.3 The trade being accepted

Today an attacker who fully compromises the account still cannot read backups,
because the code is not in the account. After this change, an attacker who
compromises the account **and** can produce a passkey assertion can. The
protection moves from "something the user memorised" to "something the user's
authenticator holds, gated on biometrics".

That is a real reduction and it is the price of the feature. It is a far
smaller reduction than server escrow, which would have handed the same power to
PINGO permanently and to anyone who breached it.

---

## 2. Architecture

### 2.1 The key hierarchy, unchanged in shape

```
recovery keypair            P-256, per account          ← unchanged
  └─ private key wrapped once per enrolled passkey
       KEK_i = HKDF(PRF_i(salt), info="pingo/backup/v1")
archive key                 ECDH(ephemeral, recovery public)   ← unchanged
message content keys        wrapped per device + recovery key  ← unchanged
```

Only the wrapping of the recovery private key changes. Everything below it —
the envelope format, the archive format, chunk binding, generations — is
untouched, which is why this is a smaller change than it sounds.

### 2.2 Why wrap per passkey rather than derive the recovery key directly

Deriving the recovery key straight from one PRF output would bind an account's
entire history to a single authenticator: lose it and everything is gone, add a
second device and it cannot help.

Wrapping instead means the recovery keypair is stable and each passkey holds its
own wrap of it. Enrolling a second authenticator is one more wrap. This is the
same shape the message envelope already uses for devices, so it is a pattern the
codebase and its reviewers already know.

### 2.3 What the server stores

```
recovery_packages            (existing)  wrapped key, kdf, salt, iv, public_key, version
recovery_wraps               (new)
  user_id      uuid
  credential_id text          -- WebAuthn credential id, not secret
  prf_salt     text           -- per-account, random, not secret
  wrapped_key  text           -- recovery private key under KEK_i
  iv           text
  label        text           -- "Pixel 8", for the Settings list
  created_at   timestamptz
```

None of it is secret. The salt and credential id are inputs the authenticator
needs; the wrap is opaque without the PRF output. Written through a definer
function for the same reason `recovery_packages` already is — the column grants
that keep `package` unreadable also deny the table privileges an upsert needs.

### 2.4 Passkey design

**Creation**, when backup is enabled:

```
navigator.credentials.create({
  publicKey: {
    rp, user,
    pubKeyCredParams: [-7, -257],
    authenticatorSelection: {
      residentKey: 'required',        // discoverable — see below
      userVerification: 'required',
    },
    extensions: { prf: {} },          // ask whether PRF is available
  },
})
```

`residentKey: 'required'` is not optional here. A device restoring after a
reinstall knows no credential id, so the assertion must be startable with an
empty `allowCredentials` and let the platform offer whatever it has synced.
Without discoverability the restore path cannot begin.

**Derivation**, at backup and at restore:

```
navigator.credentials.get({
  publicKey: {
    challenge,
    allowCredentials: [],             // let the platform offer synced passkeys
    userVerification: 'required',
    extensions: { prf: { eval: { first: salt } } },
  },
})
→ results.prf.results.first          // 32 bytes, never leaves the authenticator
→ HKDF → KEK
```

**Availability is not universal.** PRF is a WebAuthn extension; support varies
by platform, browser and authenticator, and `prf.enabled` must be read from the
creation result rather than assumed. The design therefore has to answer "what if
it is missing" before a line is written — see §6.

---

## 3. Restore flow

```
sign in
   ↓
server: does this account have recovery_wraps?      ← no user input
   ↓ yes
"Backup found — 3,412 messages, 2 days ago.  [Restore]  [Not now]"
   ↓
passkey prompt (biometric)                          ← the only interaction
   ↓
PRF → KEK → unwrap recovery key
   ↓
Drive: HEAD → manifest → chunks → verify → decrypt
   ↓
local database rebuilt
```

No code, no cryptographic words, one biometric tap. The backup's existence is
discovered from the server, not from the user's memory, which is what makes the
prompt possible at all.

---

## 4. UX flow

### 4.1 Enabling

After onboarding, once, if backup is off:

> **Protect your chats with Google Drive?**
> Your chats stay encrypted. Only you can read them.
> **[Enable Backup]** **[Not now]**

Enable → Google account chooser → Drive permission → passkey prompt → done.
No recovery code, no confirmation screen, no cryptographic terminology
anywhere in the user-facing copy.

### 4.2 Reminders when skipped

Home-screen banner, dismissible, with the schedule exposed in Settings:

| Choice | Behaviour |
| --- | --- |
| Every 24 hours | default after first skip |
| Every 7 days | after the second dismissal |
| Every month | after the third |
| Never | explicit, and honoured permanently |

Escalating intervals rather than a fixed nag: someone who has said no twice is
answering the question, and a reminder that ignores that is an advert.

### 4.3 What the user is told about security

One line, no jargon: *"Your chats stay encrypted. Only you can read them."*
That sentence has to remain literally true, which is the whole reason for
choosing passkeys over escrow.

---

## 5. Migration strategy

Non-destructive and reversible at every step.

| Stage | Change | Reversible |
| --- | --- | --- |
| 1 | Ship UX shell — dialog, reminders, auto-detect restore — still code-based underneath | yes |
| 2 | Add `recovery_wraps` and the definer functions. Nothing reads them yet | yes |
| 3 | Enrol a passkey wrap **alongside** the existing code package | yes |
| 4 | New enrolments are passkey-only; the code path stays for existing accounts | yes |
| 5 | Offer existing users a one-tap upgrade | yes |
| 6 | Retire code-only enrolment once adoption is measured | one-way |

An account may hold both a code package and passkey wraps at once. They open
the same recovery keypair, so a user can restore either way throughout — which
is what makes stages 3 to 5 safe to ship without ceremony.

**Server retention stays at thirty days for the whole migration.** Backup does
not become load-bearing until it has been proven on Android and at volume, and
nothing here changes that.

---

## 6. Limitations

- **PRF is not everywhere.** Where it is missing, backup cannot be offered
  silently. The options are an explicit password (today's guarantee, more
  friction) or no backup. **It must not silently fall back to server escrow** —
  that would quietly make the one-line promise false.
- **Losing every passkey loses the history.** With no escrow, there is no
  recovery path. Mitigated by encouraging a second authenticator and by making
  the Settings list show how many exist, but not eliminated. This is the same
  position WhatsApp's 64-digit key leaves a user in.
- **Passkey syncing is the platform's, not ours.** If a user's Google account
  does not sync passkeys, a new phone will not find one.
- **Media is Phase 2.** Chats, groups and chat settings only for v1.
- **Web backs up while the tab is open.** Unchanged; Android does background.

---

## 7. Rollback plan

Each stage is independently revertible, and the crypto is additive rather than
replacing anything:

1. **UX only** — revert the commit; the code-based flow is still underneath.
2. **Schema** — `recovery_wraps` is additive. Unused rows harm nothing; drop the
   table if abandoned.
3. **Passkey enrolment** — the code package still exists for those accounts, so
   removing passkey wraps costs nothing. Users restore with the code.
4. **After code retirement** — the only one-way step, and it is deliberately
   last, behind measured adoption.

**The invariant that makes rollback safe:** the recovery keypair never changes.
Passkeys and codes are two ways of unwrapping the same key, so removing one path
never orphans an archive. Any change that would require re-wrapping every
message or re-sealing existing archives is out of scope by construction.

---

## 8. Order of work

| # | Stage | Why here |
| --- | --- | --- |
| 1 | UX shell: dialog, reminders, auto-detect restore | Valuable under any key decision; no crypto risk |
| 2 | PRF capability probe + honest reporting | Nothing can be promised before this is measured |
| 3 | `recovery_wraps` schema and functions | Additive, unused until stage 4 |
| 4 | Passkey enrolment beside the code | Both paths open the same key |
| 5 | Passkey restore on a wiped device | The proof, as with step 7 before it |
| 6 | Hide the code from new enrolments | Only after 5 is measured |
| 7 | Media (v2), then retention reduction | Explicitly last |

Each stage ships with verification in the existing style, and stage 5 is
verified the way cross-device recovery already was: wipe the database, restore
from Drive on a device that has never held the key.
