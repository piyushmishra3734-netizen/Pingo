# PINGO Security Audit (2026-08-07)

**Scope:** Production `pingochat.pages.dev` + Supabase project `lppzoqgvshhmxqsvggug` + monorepo `piyushmishra3734-netizen/Pingo`  
**Method:** Static review (RLS, edge functions, client bundle) + live safe probes (anon + authenticated as test user `@gork`)  
**Not done:** Destructive attacks, credential stuffing, social engineering, full pen-test of Cloudflare/WAF  

---

## Executive summary

| Severity | Count (this pass) |
|----------|-------------------|
| Critical | 0 (live confirmed) |
| High | 0 (live confirmed) — **code-level risks below still need hardening** |
| Medium | 1+ (storage listing / broad storage policies) |
| Low / Info | several expected Supabase client patterns |

**Overall:** Core data tables appear **RLS-protected** against anonymous access and common IDOR (messages, other profiles write, other AI memories, fake-conversation send). **Human DMs use E2EE** (ciphertext at rest on API). Main residual risks are **broad authenticated storage SELECT** policies (voice/snaps/stories by path knowledge), **public avatars + listability**, **username-login edge without JWT** (by design, needs rate limits), and **operational hygiene** (session files, test accounts, display seeds).

---

## Attack surface map

| Surface | Entry |
|---------|--------|
| Web app | `https://pingochat.pages.dev` (SPA + anon Supabase key in bundle) |
| Supabase REST | `/rest/v1/*` (RLS) |
| Supabase Auth | `/auth/v1/*` |
| Supabase Storage | `/storage/v1/*` (bucket policies) |
| Edge functions | `username-login`, `ai-chat`, `turn-credentials`, `push-send` |
| Realtime | postgres_changes on messages / reactions / notifications |
| GitHub | source monorepo |

---

## Live probe results (safe)

### Anonymous / public

- **All major tables** (`profiles`, `messages`, `conversations`, `follows`, `posts`, `notifications`, `ai_memories`, …): HTTP 200 with **empty arrays** when using anon key → rows not readable without auth (RLS).
- **`username-login`** wrong password → `400 invalid_credentials` (no token). Good: no “user exists” distinction in body.
- **`ai-chat`** with anon JWT → **401** “Sign in required”.
- **`turn-credentials`** with anon → **401**.
- **Auth settings** publicly readable (normal for Supabase clients).

### Authenticated IDOR (as `@gork`)

| Test | Result |
|------|--------|
| List messages | Only conversations gork is a member of |
| Baani’s other memberships | Not enumerable beyond shared DM |
| PATCH other profile (`piuxxh`) | **0 rows** updated (blocked) |
| Read other user’s `ai_memories` | Empty / denied |
| INSERT message into fake conversation UUID | **403** RLS |
| Read other user’s notifications | Empty |
| Sign non-owned voice path | Object not found / no free access to others’ files by guess alone |

### Client bundle (`pingochat.pages.dev`)

- Project URL + **anon key** present (**expected** for Supabase).
- **No** `service_role` key, NVIDIA key, or private PEM found in production JS in this scan.

### Git / GitHub hygiene (repo)

- `.env` / `*.jks` / `keystore.properties` are **gitignored**.
- Local session file `_gork_session.json` should **never** be committed (ignored).
- Avoid committing `live_bundle.js`, `_prod.js`, probe scripts with tokens.

---

## Code / design findings (priority)

### M1 — Broad storage SELECT (authenticated)

**Where:**

- `voice`: `using (bucket_id = 'voice')` for all authenticated users  
- `snaps`: `authenticated can read snaps` for entire bucket  
- `stories` (post-private migration): any signed-in user may read story objects  

**Risk:** Anyone logged in who **learns an exact storage path** can fetch media. Paths use UUIDs (hard to enumerate), but policy is weaker than “conversation member only”.

**Fix direction:** Prefer path prefix = owner id + membership helper, or only ever serve via short-lived signed URLs with ownership checks in RPC (you already partly do this for snaps).

### M2 — Avatars bucket listable / public

**Live:** `storage list` on `avatars` returned folder-level entries for anon/authenticated probe.

**Risk:** User-id folders may be **enumerable**; combined with public read of avatars, profile pictures are intentionally public (by design) but **listing** can aid user-id harvesting.

**Fix:** Disable public **list** if not needed; keep get-by-known-path only.

### M3 — `username-login` without JWT (by design)

**Risk:** Public endpoint accepts password attempts. Mitigated by Supabase Auth rate limits on `signInWithPassword`, but **edge function itself** should also rate-limit by IP + username.

**OK:** Does not return email; unified `invalid_credentials`.

### M4 — Timing side channel on username-login

Documented in code (~lookup cost differs for existing usernames). Usernames are public by design, so low impact.

### M5 — AI chat is **not** E2EE

**By design:** server must read plaintext to reply.  
**Risk:** AI thread content, memories, and NVIDIA path are **server-visible**. Users must not treat AI chat as private like human E2EE DMs.

### M6 — Human E2EE is real (good) but client-side

**Live evidence:** messages from other party show `encryption` + ciphertext over REST.  
**Risk residual:** compromised client, key backup recovery flow, or plaintext send bugs (sender sometimes writes plaintext before seal — review send path for any unencrypted inserts).

### M7 — Display seeds (friends/likes)

**Not a break-in**, but **misleading public social proof** if treated as security/trust metrics. Seeds are operator-controlled.

### M8 — Edge `push-send` `verify_jwt = false`

Confirm only invocable with secret/service path, not world-callable with spam pushes. Review function auth (service role / cron secret).

### L1 — CORS reflects `Origin`

Used on edge functions. Ensure no sensitive cookie auth depends on Origin alone (Supabase uses Bearer).

### L2 — Test / operator sessions

JWT session files on disk during testing are high value if laptop leaks. Rotate passwords for test accounts used in chats.

---

## What looks solid

1. **RLS on core tables** — anon cannot dump messages/profiles/posts.
2. **Cannot hijack another profile** via simple PATCH as another user.
3. **Cannot inject messages** into arbitrary conversations.
4. **AI endpoint** requires real user JWT + AI conversation ownership check (code + 401 probe).
5. **TURN secrets** not in browser; function requires sign-in.
6. **No service_role in production frontend bundle** (this scan).
7. **Username login** does not expose email addresses.

---

## Recommended next actions (order)

1. **Tighten storage policies** for `voice` / `photos` / `snaps` / `stories` where possible (member-aware or owner-prefix only).  
2. **Rate-limit** `username-login` at edge (IP + handle).  
3. **Audit `push-send`** auth and disable public invoke.  
4. **Secret scan CI** on GitHub (gitleaks/trufflehog).  
5. **Rotate** any test account passwords used in live social tests.  
6. **Document** AI chat privacy vs E2EE DMs in UI (already partial in product copy).  
7. Optional: **pentest** with second non-friend account for group chat IDOR and realtime event leakage.

---

## Out of scope / residual

- Full Cloudflare WAF / DDoS posture  
- Mobile app binary reverse engineering  
- Supply-chain (npm) deep audit  
- Social engineering / SIM swap  
- Exhaustive RPC fuzzing of every `security definer` function  

---

## Probe artifacts

- Local: `_security_report.json` (machine-readable probe output)  
- Do **not** commit session tokens or probe scripts that embed secrets  

**Conclusion:** No live proof of “log in as someone else” or “anon dumps all chats” in this pass. Harden **storage path access**, **edge rate limits**, and **push function auth**; keep E2EE client discipline and never ship service_role to the browser.
