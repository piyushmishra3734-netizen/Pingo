# PINGO — Private chat (temporary end-to-end encrypted session)

**Status:** Phase 1 (text) built and tested on prod behind the flag, on for two test accounts only. See "Roadmap" at the end.
**Replaces:** the old always-on E2EE (switched off 14 Sep 2026, commit `12ef3a4a`).
The old code in `lib/crypto/` and the 30,372 old sealed messages are **left alone**
(see "What does not change").

## What it is

A one-to-one chat can be switched into a **private session**. While it lasts,
everything in it is end-to-end encrypted. When it ends, the messages, the files
and the keys are gone, on both sides and on the server. Nothing is kept to
restore.

Like Instagram's vanish mode in how it is used, but actually end-to-end encrypted.

## How it is used

- **Start:** in a 1:1 chat, swipe up from the typing area (the Instagram gesture).
  The session starts at once. The other person is only **told** ("<name> started
  a private chat": a notification, and a line in the chat); they do not accept
  or decline. Their app completes the key exchange by itself in the background,
  the moment it is open (or already open). If their app is closed, what the
  creator writes waits on the creator's own phone, still unsent and unreadable
  to the server, and is delivered once the other side's app has made its key.
  The creator sees "Delivered when <name> opens Pingo".
- **Who can start:** not if either side has blocked the other.
- **While it lasts:** the chat looks different (darker, a lock line), and every
  message, voice note, photo and call is encrypted.
- **End:** **either person** ends it (Instagram-style), with the back button at
  the top left of the chat. It asks first: "End private chat? Everything in it
  is deleted for good, for both of you." The other person is told it ended.
- Merely leaving the chat screen (switching app, opening another chat) does
  **not** end it; only that button, or expiry, does.
- **Expiry:** 3 hours with no activity. Chatting keeps it alive. A notice shows
  5 minutes before.

## Cryptography (small on purpose)

1. At start each side makes a **temporary key pair** (ECDH P-256, Web Crypto).
2. Public keys are exchanged through the server; each side derives the **same
   session key** (HKDF over the ECDH result, bound to the session id).
3. Every message is **AES-256-GCM** with that one session key and a counter
   nonce. The envelope is a nonce and a tag: about 28 bytes. The old design
   wrapped a key per device per message (about 3 KB).
4. Files and voice notes are encrypted on the phone with the same key and
   uploaded as random-looking bytes. Calls use LiveKit's built-in E2EE with a
   key derived from the session key.
5. The session key lives on the device only for the session. When the session
   ends or expires it is destroyed. A device that was offline destroys it the
   next time it connects.
6. Private sessions create **no row in `device_keys`** and touch no old key.

Reuse `lib/crypto/envelope.ts` primitives where they fit; do **not** reuse
`session.ts` (the device-key machinery).

## Data model

All new, all separate from `messages`:

- `private_sessions(id, creator_id, peer_id, creator_pub, peer_pub, state, started_at, last_activity_at, expires_at)`
- `private_messages(id, session_id, sender_id, ct, created_at)`: the sealed
  messages, kept for the session only (so a reload can read them again with the
  key still on the phone) and hard-deleted when it ends. Delivery is Realtime
  on this table, filtered to the session. (Built this way in phase 1: simpler and
  survives a reload; the broadcast idea was dropped.)
- RLS: only the two members can read; nothing for `anon`.
- Files: R2 kind `private`, under `private/<session>/`. The worker deletes them
  when the session ends and a lifecycle rule removes any leftover after 4 hours.

## Cleanup (must not rely on the client)

- Creator ends → one function deletes the session's rows and files, marks it
  ended, notifies the peer to destroy their key.
- Creator's app killed / offline → a cron (every minute) finds sessions past
  `expires_at` using an indexed column and cleans them in small batches.
- **No scans** of `messages` or any large table. This was the failure of the old
  backfill.

## Abuse and load limits (someone toggling it for fun)

Starting a session must be cheap, and doing it repeatedly must be refused by
the **server**, not trusted to the app.

- **Cost of one start:** one small row in `private_sessions` plus a broadcast.
  No key table, no scan, no file. A session in which nothing was ever sent is
  deleted the moment it ends, with no cron work.
- **Limits (checked inside the start function, using an index on
  `creator_id, started_at`):**
  - 60 seconds between ending a session and starting one in the same chat;
  - at most 5 starts per hour and 20 per day per person;
  - at most 3 starts per hour with the same person.
  Over the limit: "Try again in a few minutes." Numbers are placeholders and
  are constants inside `private_start`, changed with `create or replace` (no app
  release needed).
- **Notifications:** the in-chat line is free, but the push to the other person
  is sent at most once per pair per 10 minutes, so toggling cannot spam them.
- **Egress:** text is tiny and goes over broadcast (no database read). Files go
  only to R2, never Supabase storage, so they add no Supabase egress; each
  session has a byte cap (placeholder 100 MB) and uses the existing per-user
  daily media quota (`take_media_quota`).
- **Who may end it:** either person. The limits above count starts **per pair
  of people**, so two people ending and starting it back and forth share the
  same budget; one cannot get around it by letting the other restart.

## Speed budget (the real risk)

Pingo got slow last time. These are conditions for shipping:

| Thing | Budget |
|---|---|
| Send to receive, both online | ≤ 0.5 s typical |
| Start a session (handshake) | ≤ 1 s once both are in |
| Normal chats with Private chat present | no measurable change |
| Work done for someone who never uses it | none |

Guards:
1. Behind `app_flag('private_chat')`: one query turns it off for everyone.
2. Normal chat code paths are not edited.
3. Cleanup is batch-bounded and index-driven.
4. Measured on the real app before rollout; tests are small rollback-transaction
   tests, never large inserts on production.

## What is disabled inside a private session

PINGO AI, @mentions, search over its messages, link previews, Polish, and
notification text (a push says only "New private message"). The messages are
not written to any local cache (IndexedDB, service worker, video vault), not
saved to gallery, not forwardable. Android: screenshots and screen recording
are blocked in the chat. On web this cannot be blocked.

## Phases

1. **Text only:** gesture, handshake, either-person-ends, expiry, cleanup, kill switch.
2. **Voice notes and photos:** encrypted on the phone, R2 `private`, max ~25 MB.
3. **Calls:** LiveKit E2EE. Must be tested in the Android WebView; if it does
   not work there, calls stay disabled in private sessions.
4. **Video clips (optional):** whole-file download and decrypt, small only.

Each phase ships on its own and is measured against the speed budget first.

## What we can and cannot say

Can say: message **content** is encrypted on the phones; the server and its
backups cannot read it; when a session ends the content and the keys are gone.

Cannot say: "no evidence", "unhackable". The server still sees metadata
(who, when, sizes) and keeps ordinary logs. The other person can screenshot
or photograph their screen. On web the server delivers the app's code and the
public keys, so a compromised server could in principle cheat; an optional
"verify code" screen can be added later.

The Privacy Policy, Terms and Download FAQ must be updated in the same release
(they currently say normal chats are not end-to-end encrypted, which stays true;
add what Private chat does and does not protect).

## What does not change

- Normal chats: stored as sent on the server, history on every device.
- The old sealed messages and `device_keys`: left as they are so they stay
  readable. Whether to migrate or delete them is a separate decision.

## Open decisions

- Group chats: out of scope (1:1 only).
- One device per user per session; other devices show "Private chat is on
  another device".
- The peer cannot decline a session before it starts (Instagram-style), but can
  end it at any time. Starting one still lets a person move a chat out of reach
  of evidence, so the peer also gets **Block** and **Report** (which sends the
  last messages *from the reporter's own phone*, where the plaintext is, to
  moderation). Report must exist before this ships.

## Roadmap (agreed 26 Oct 2026)

Each phase is finished, tested and measured before the next one starts. A phase is
done only when its "done when" line is true.

### Phase 1: text chat, made solid (in progress)
Built and tested: swipe start, handshake, send/receive, either person ends,
3 h expiry with warning, cron cleanup, reload keeps the session, kill switch.

1A. Close the gaps in what exists
- Zero cost for people who never use it: the flag check must not add a call at launch for everyone.
- Find why "Could not start it" appeared on a tab that did not start anything.
- Peer's app closed: creator's messages wait, peer opens the app later, everything arrives. Test it.
- Creator reloads while waiting: do not lose what was typed.
- Remove the temporary `[private]` console logs.
- Test on the real build (not dev) and on a phone: send to receive time.

1B. What a private chat must not leak (DONE 26 Oct: thread unmounted during a session, textarea autocomplete/autocorrect/spellcheck off, nothing but the flag timestamp and the keys is stored on the device)
- The normal thread under the private view is switched off while a session is on (no composer, no AI, no mentions).
- Private text never reaches a local cache, a notification preview or search.

Done when: every Phase 1 line in this plan has a passing test, and send to receive is 0.5 s or less on a production build.

### Phase 2: the other person must know, and must be safe
- Push "X started a private chat", at most once per pair per 10 min. Text never shows message content.
- Push for new private messages says only "New private message".
- Report: sends the last messages from the reporter's own phone to moderation. Required before any public release.
- Block works inside a private chat (ends it).
Done when: a closed app gets the push, Report reaches moderation, Block ends a live session.

### Phase 3: Android and policy
- Android: screenshots and screen recording blocked in the private view (FLAG_SECURE).
- Privacy Policy, Terms and Download FAQ updated with what Private chat does and does not protect.
- New Android build, tested on the phone, installed over the old one with the same signing key.
Done when: a screenshot of the private view is black on the phone and the legal pages are live.

### Phase 4: voice notes and photos (encrypted on the phone, R2 `private`)
- Encrypt with the session key, upload random-looking bytes, delete with the session, lifecycle rule as a backstop.
- 25 MB cap per file, 100 MB per session, existing media quota applies.
Done when: a photo and a voice note arrive, the server and R2 hold only bytes, and ending the session removes the files.

### Phase 5: calls (LiveKit end-to-end encryption)
- First prove LiveKit E2EE works inside the Android WebView. If it does not, calls stay disabled in private chats.
Done when: a call works on two real phones with the media key derived from the session key.

### Phase 6: optional
- Small video clips (download whole file, decrypt).
- "Verify code" screen so two people can compare keys.

### Phase 1 speed measurement (26 Oct 2026, production build served locally, real Supabase)
- Handshake, Start tapped to both phones ready: 0.95 s (budget 1 s). Creator's private view opened at 0.39 s, the other person's at 0.40 s.
- Send to receive, 12 samples, two directions, one tab in the background: 173, 215, 303, 316, 366, 387, 450, 456, 523, 582, 638, 680 ms. Median about 0.42 s (budget 0.5 s typical). Worst 0.68 s.
- Not yet measured: on an Android phone (WebView), and with other people online. Repeat both before any public release.
