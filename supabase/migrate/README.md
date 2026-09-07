# Moving PINGO to another Supabase project

Everything here was checked against the live project on 2026-09-07, not written
from memory. Where a number appears — 55 tables, 113 policies, 149 stored files —
it was counted.

---

## Read this first: do not rebuild from `supabase/migrations`

The obvious plan is to point the new project at this repo and replay the
migrations. That produces a database that does not match the one it is
replacing, and it does it quietly. Checked directly:

| | |
|---|---|
| Migrations applied to the live database | **122** |
| Migration files in `supabase/migrations` | **120** (115 before this was written) |
| Applied with no file at all | **5** — now recovered, see below |
| Files never applied | **3** |
| Same migration, different version number | throughout |

The five that existed only in the database were pulled back out of
`supabase_migrations.schema_migrations`, where Supabase keeps the SQL it ran, and
written to disk:

- `20260932000001_device_key_seen_column_privilege` — withholds `key_seen_at`
  from other accounts. Missing it silently widens a read.
- `20260932000002_device_key_sweep_enforces_limit`
- `20260937000001_backup_anchor_revoke_default_writes`
- `20260944000001_update_notice_revoke_anon_write`
- `20260945000001_clear_copied_ai_display_names` — a one-off data repair, kept
  for the record; it matches nothing on a fresh database.

Two more differ only in shape: `missions_referrals_badges` is one file here and
ran as three parts, and `premium_and_hd` is one file here and ran as
`premium_flag` + `premium_not_self_grantable`. Same content, different rows.

One is genuinely pending and is **not** in the live database:
`20260949000000_account_key.sql`. See "Still yours to do".

The repo is now honest about what ran. It is still not the thing to rebuild
from — **dump the live database instead.** The dump is the truth; the migration
history is how it got there.

---

## What moves, and how

| | How it moves |
|---|---|
| 55 tables, 371 columns, 202 constraints, 99 indexes | `pg_dump` |
| 113 RLS policies, 55 tables with RLS on | `pg_dump` |
| 118 functions, 19 triggers, 3 views | `pg_dump` |
| Column-level grants (4,172) | `pg_dump` |
| 43 auth users and their identities | `pg_dump --data-only` of two `auth` tables |
| All row data | `pg_dump` |
| 6 extensions | **`before-restore.sql`** |
| 8 cron jobs | **`after-restore.sql`** |
| 2 vault secrets | **`after-restore.sql`** — values are yours |
| Realtime publication (6 tables) | **`after-restore.sql`** |
| Old project URL inside 3 functions | **`after-restore.sql`** |
| Old project URL inside 28 rows | **`after-restore.sql`** |
| 8 storage bucket definitions | `pg_dump --data-only` of `storage.buckets` |
| 151 stored files, 89 MB | **`copy-storage.mjs`** |
| 10 edge functions | **yours** — `supabase functions deploy` |
| 24 edge-function secrets | **yours** — they are credentials |
| App config, auth providers, redirect URLs | **yours** — dashboard and `.env` |

---

## The order

### 1. Record what you are leaving

Run `fingerprint.sql` on the **old** project and keep the output. It is 14 rows.
Here is what it returned on 2026-09-07, so a difference is visible even if you
skip this step:

| category | items | digest |
|---|---|---|
| column grants | 4172 | `1eb05848b56dd6cbfcd9142bdc710d72` |
| columns | 371 | `0e68c87c6f8c8dcd73491cfe23c94602` |
| constraints | 202 | `fe2265647090c5d9826643b66709fe72` |
| cron jobs | 8 | `60310a0cf885697bd8e2e3488a254fb3` |
| extensions | 7 | `cca1b1c5ce9b500e654938c8884671af` |
| functions | 118 | `1d406a32f9fde2cc978b03aa42342c13` |
| indexes | 99 | `f38225913630437af2df97aac6e38da7` |
| policies | 113 | `5678c569900abacbf26eaff1beaf0ca1` |
| realtime tables | 6 | `e00bab20b9cc914065ebb59b24f18c5c` |
| rls enabled | 55 | `8ec075d20929da10b6a7b2ad203776d0` |
| storage buckets | 8 | `c3dce9ac74a88047bcbfcf9ac7a0f818` |
| storage policies | 26 | `e5cd70e2cc6aea21c0e311582b134a38` |
| triggers | 19 | `775a4da127b359ba159eaf066afbed65` |
| views | 3 | `8e22b7ef87893dff6c32e4fcae8d9363` |

These digests will move if anything changes in the old project between now and
the move, which is the point of re-running it rather than trusting the table.

### 1b. The line the dump has to match

Maintenance went on at **2026-09-07 16:38 UTC**, and the last message written
before it landed at 16:36:30. These are the counts at that moment:

| | |
|---|---|
| accounts | 43 |
| messages | 47,329 |
| conversations | 81 |
| device keys | 74 |
| storage objects | 151 |

After the restore, run the same counts on the new project. They must be equal.

```sql
select (select count(*) from auth.users)           as accounts,
       (select count(*) from public.messages)      as messages,
       (select count(*) from public.conversations) as conversations,
       (select count(*) from public.device_keys)   as device_keys,
       (select count(*) from storage.objects)      as files;
```

**Higher on the old project afterwards means the window was not actually shut**
- something reached it after the dump, and that something is not in the new
database. Lower on the new one means the restore dropped rows, which `psql`
reports and does not stop for.

These are row counts and move with use; the digests in step 1 are schema and do
not. Both have to match, and they fail differently: a wrong count is missing
data, a wrong digest is a missing rule. A restore can pass one and fail the
other.

### 2. Prepare the new project

Create it, then run **`before-restore.sql`** in its SQL editor. It installs the
six extensions and tells you if a version is older than the source.

### 3. Dump and restore

Both connection strings come from *Settings → Database → Connection string* in
each project. Use the **direct** connection, not the pooler — the pooler cannot
run a restore.

Three dumps, not one. `public` is yours and moves whole; `auth` and `storage` are
Supabase's own and already exist in the new project, so only their *rows* move.

```bash
OLD="postgresql://postgres:PASSWORD@db.lppzoqgvshhmxqsvggug.supabase.co:5432/postgres"
NEW="postgresql://postgres:PASSWORD@db.NEWREF.supabase.co:5432/postgres"

# 1. The application schema, structure and data together.
#    --no-owner because the roles differ. Privileges are deliberately NOT
#    skipped: there are 4,172 column grants, and one of them is the only thing
#    keeping `key_seen_at` out of other accounts' reach.
pg_dump "$OLD" --schema=public --no-owner --file=public.sql

# 2. The accounts, data only - those tables already exist and are managed.
#    `users` and `identities` and nothing else: sessions and refresh tokens are
#    signed with the old project's JWT secret and are void in the new one, and
#    `flow_state` and `one_time_tokens` are mid-flight junk.
pg_dump "$OLD" --data-only --no-owner \
  --table=auth.users --table=auth.identities --file=auth.sql

# 3. Bucket configuration only. The files themselves are step 5.
pg_dump "$OLD" --data-only --no-owner --table=storage.buckets --file=buckets.sql

psql "$NEW" --file=public.sql
psql "$NEW" --file=auth.sql
psql "$NEW" --file=buckets.sql
```

**Everybody will be signed out.** The new project signs its tokens with a
different secret, so every existing session is void whatever you copy. That is
unavoidable, and it is survivable: user ids come across unchanged, so every row
that points at an account still points at the right one, and signing out has
never cleared this app's local database or its device keys - people sign back in
and their chats are still there.

Expect errors on objects Supabase already created: roles, extensions, some `auth`
and `storage` objects. Those are normal. Read them anyway - an error on a
**`public`** object is not.

### 4. Everything the dump did not carry

Open **`after-restore.sql`**, fill in three values at the top of their sections
(the new project ref, and the two shared secrets), and run it on the new project.
It rewrites the three functions and the 28 rows that still point at the old
project, recreates the 8 cron jobs, sets the vault secrets, and asserts the
realtime publication.

The two rewrites matter most, because neither failure announces itself.

Without the **function** rewrite the new database keeps calling the *old*
project's edge functions. Everything returns 200. Push works, sweeps run, and all
of it belongs to a project nobody is using.

Without the **row** rewrite, 28 stored image URLs still name the old project:
19 profile avatars, 5 banners, a group's avatar, cover and wallpaper, and one AI
banner. These are full `https://<ref>.supabase.co/storage/...` URLs rather than
paths. While the old project is still up they keep working, which is the worse
outcome — the new app quietly serves pictures out of the old project until the
day you delete it, and then 28 people lose their avatar at once.

Check both afterwards:

```sql
-- functions: expect 0 rows
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc like '%lppzoqgvshhmxqsvggug%';

-- rows: expect 0
select count(*) from public.profiles where avatar_url like '%lppzoqgvshhmxqsvggug%';
```

### 5. Move the files

149 objects, 89 MB, across 8 buckets — `avatars` and `onboarding` are public, the
other six are not. Step 3 brought the bucket *configuration*; the bytes, and the
`storage.objects` rows that index them, did not come with it.

Copy them through the Storage API rather than dumping `storage.objects`: an
uploaded file writes its own row, so the index stays consistent with what is
actually there. A dumped row with no file behind it is a broken image that looks
like a bug in the app.

Keep the paths identical. The storage policies are path-based - they match on the
owner's id being the first segment - so a file that lands at a different path is
a file its owner can no longer read.

`copy-storage.mjs` does all of it:

```bash
export SOURCE_URL="https://lppzoqgvshhmxqsvggug.supabase.co"
export SOURCE_SERVICE_KEY="..."
export TARGET_URL="https://NEWREF.supabase.co"
export TARGET_SERVICE_KEY="..."

node supabase/migrate/copy-storage.mjs --check   # compare, write nothing
node supabase/migrate/copy-storage.mjs           # do it
```

Service role on both sides, because six of the eight buckets are private and
uploading into somebody else's folder is what the policies exist to stop. The
keys are read from the environment and are not written anywhere.

Run `--check` first. It reports what it would copy and refuses if the two URLs
are the same project, and it flags a bucket whose public flag differs between
the two — getting that backwards on `photos` publishes every chat photo in the
app, so it is checked rather than assumed.

The copy is resumable: an object already on the target at the same size is
skipped, so a run that dies at file 90 is finished by running it again.

### 6. Deploy the edge functions

```bash
supabase functions deploy --project-ref NEWREF
```

Ten of them: `ai-chat`, `livekit-token`, `purge-media`, `push-send`, `stt`,
`stt-stream`, `tts`, `turn-credentials`, `username-login`, `vision`.

Then set their secrets. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase — do not set those. These
are the 24 that are yours:

| function | secrets |
|---|---|
| `ai-chat` | `CF_ACCOUNT_ID` `CF_AI_TOKEN` `CF_IMAGE_MODEL` `CF_IMAGE_STEPS` `NVIDIA_API_KEY` `NVIDIA_BASE_URL` `NVIDIA_MODEL` |
| `livekit-token` | `LIVEKIT_API_KEY` `LIVEKIT_API_SECRET` `LIVEKIT_URL` |
| `purge-media` | `MEDIA_SWEEPER_SECRET` |
| `push-send` | `FCM_SERVICE_ACCOUNT_B64` `PUSH_TRIGGER_SECRET` |
| `stt` | `SARVAM_API_KEY` `SARVAM_STT_MODEL` |
| `stt-stream` | `SARVAM_API_KEY` |
| `tts` | `CF_ACCOUNT_ID` `CF_AI_TOKEN` `CF_TTS_MODEL` `SARVAM_API_KEY` `SARVAM_TTS_MODEL` `SARVAM_TTS_SPEAKER` `SARVAM_TTS_TEMPERATURE` |
| `turn-credentials` | `CF_TURN_API_TOKEN` `CF_TURN_KEY_ID` `CF_TURN_TOKEN_ID` `TURN_PROVIDER` `TURN_STATIC_AUTH_SECRET` `TURN_URLS` |
| `vision` | `CF_ACCOUNT_ID` `CF_AI_TOKEN` `CF_VISION_MODEL` |

`PUSH_TRIGGER_SECRET` and `MEDIA_SWEEPER_SECRET` must match what you put in the
vault in step 4. They are the same secret on two sides of one call — if they
disagree, push registers fine and never arrives.

### 7. Point the app at it

- `apps/web/.env` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- The same two in the **Cloudflare Pages** project's build environment. The build
  that runs on Cloudflare does not read the local `.env`; setting only one of the
  two places is the version of this that looks done and is not.
- The Android app embeds the same values at build time, so it needs a fresh APK.
  Not built as part of this.
- Dashboard: auth providers, redirect URLs, and site URL.

### 8. Check it

Run `fingerprint.sql` on the new project and compare all 14 rows against step 1.
A differing **count** means something is missing. A matching count with a
differing **digest** is the more interesting failure — same number of policies,
one of them weaker. The bottom of `fingerprint.sql` has the queries that print
the underlying rows for each category so the difference can be found.

One thing is normalised so it does not raise a false alarm: three function
bodies contain the project's own REST URL and are *supposed* to differ after the
move, so the ref is replaced with a placeholder before hashing. A function still
pointing at the old project is caught by `after-restore.sql`, which is the script
whose job that is.

Read the counts as well as the digests. Two digests matching over zero rows is a
pass that proves nothing.

---

## Still yours to do

These are blocked on you, not on the work:

1. **`20260949000000_account_key.sql` is written and committed but never
   applied.** It is the per-user key that ends the envelope fan-out — 3,261 bytes
   stored per message row of which 47 are the message. Decide whether the new
   project starts with it or without it. Applying it to the *old* project first
   means the data you migrate already has it.
2. **Two copy changes are held back, uncommitted** — `PrivacyPolicyScreen.tsx`
   and `AccountScreen.tsx`. They describe the account key, so they only become
   true once that migration is applied.
3. **Database passwords.** Steps 3 and 5 need them; they are not something to
   hand over. The scripts here are built so nothing else does.
4. **The 24 edge-function secrets.** Same reason.
5. **An APK**, if the Android app should point at the new project.
