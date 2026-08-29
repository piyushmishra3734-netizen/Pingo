/**
 * Delivers a notification to somebody's devices, over FCM HTTP v1.
 *
 * ## Why a service account and not a server key
 *
 * FCM's legacy endpoint took a static server key in a header. It was retired,
 * and it deserved to be: one long-lived string that could send to every device
 * you had, with no scope and no expiry. The v1 API takes a short-lived OAuth
 * access token minted from a service account, so what leaves this function is
 * valid for an hour and only for `firebase.messaging`.
 *
 * The service account itself arrives base64-encoded in one secret rather than
 * as three. Its private key is a multi-line PEM, and every layer between a
 * shell and an environment variable mangles newlines differently - encoding the
 * whole document sidesteps a class of bug that presents as "invalid JWT
 * signature" and takes an afternoon to find.
 *
 * ## The caller must already be trusted
 *
 * This endpoint sends notifications to a user id it is handed. There is no
 * version of that which is safe to expose, so it demands a shared secret and is
 * only ever called from inside the database. `verify_jwt` is off because the
 * caller is Postgres, which has no user session - the secret is the whole
 * check, and it is compared in constant time.
 *
 * `PUSH_TRIGGER_SECRET` rather than the service role key, for two reasons. The
 * lesser one is that Supabase now issues keys in two formats and the value in
 * `SUPABASE_SERVICE_ROLE_KEY` is not necessarily the string a caller holds -
 * that mismatch is a 401 that looks exactly like a bug. The real one is least
 * privilege: a trigger that only needs to say "notify this person" should not
 * carry a credential that can read every table in the database.
 *
 * ## Dead tokens are pruned as a side effect of sending
 *
 * FCM answers `UNREGISTERED` for a token whose app was uninstalled and
 * `INVALID_ARGUMENT` for one that was never valid. Both mean the row should go.
 * Nothing else garbage-collects `device_tokens`, and without this a phone that
 * was factory-reset a year ago is still costing a request on every message.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** What the database hands over. Deliberately small - see `copyFor`. */
interface PushRequest {
  userId: string;
  kind: string;
  /** The idempotency key. Absent only for sends with no notification row. */
  notificationId?: string;
  actorId?: string;
  actorName?: string;
  subjectId?: string;
  /** Unread notifications of this kind from this actor, including this one. */
  count?: number;
  preview?: 'sender_only' | 'sender_and_text' | 'hidden';
  /** Set by the worker. Only changes what gets logged, never what is sent. */
  retry?: boolean;
}

/**
 * Whether an FCM rejection is worth trying again.
 *
 * `UNREGISTERED` is an uninstalled app and `INVALID_ARGUMENT` is a token that
 * was never valid - retrying either is not persistence, it is a loop that
 * cannot succeed, and it keeps a dead row alive for a day. Everything else
 * (429, 5xx, a timeout) is the service having a bad minute.
 */
function isPermanent(status: number, body: string): boolean {
  if (/UNREGISTERED|INVALID_ARGUMENT/.test(body)) return true;
  // 401/403 are our credentials, not the device's - never prune a token for
  // a mistake we made.
  return status === 404;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Compares without leaking where two strings first differ.
 *
 * A `===` on a secret answers faster for a wrong first character than for a
 * wrong last one, which is enough to recover the key one byte at a time given
 * enough attempts. The cost of doing it properly is a few microseconds.
 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** PEM to the DER bytes `crypto.subtle` wants. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/**
 * A Google access token, minted from the service account.
 *
 * Cached in module scope, which in Deno Deploy means "for the life of this
 * isolate". A token lasts an hour and a burst of messages would otherwise mint
 * one per notification - the same round trip, repeated, against a rate limit
 * that is not generous. Refreshed a minute early so a token never expires
 * mid-flight.
 */
let cached: { token: string; expiresAt: number } | undefined;

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ),
  );

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  );

  const assertion = `${header}.${claim}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`token exchange failed: ${response.status}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: now + body.expires_in };
  return body.access_token;
}

/**
 * What the notification says.
 *
 * Never the message itself. PINGO's privacy policy says the server does not
 * read message content, and putting a message body in an FCM payload would
 * route it through Google's infrastructure and onto a lock screen - which is
 * exactly the claim the product makes it does not do. Who, and what kind. The
 * app is where you find out what was said.
 */
function copyFor(request: PushRequest): { title: string; body: string } {
  const who = request.actorName?.trim() || 'Someone';
  const many = request.count && request.count > 1 ? request.count : 0;

  switch (request.kind) {
    case 'message':
      /*
       * "3 new messages", not three notifications saying "Sent you a message".
       *
       * Somebody typing "hey", "hey??", "bro???" in five seconds produces three
       * rows, and three lock-screen lines for one thought is what makes people
       * mute an app. Paired with the collapse key below, the newest push
       * replaces the previous one and the count is the only thing that moves.
       */
      return { title: who, body: many ? `${many} new messages` : 'Sent you a message' };
    case 'snap':
      return { title: who, body: many ? `${many} new Pings` : 'Sent you a Ping' };
    case 'voice':
      /*
       * Named, because answering one costs more than answering text.
       * A line of text can be read on a lock screen and replied to with a
       * thumb; a voice note has to be listened to. Knowing which is waiting is
       * what lets somebody decide whether to pick the phone up now or later.
       */
      return { title: who, body: many ? `${many} voice notes` : 'Sent a voice note' };
    case 'call':
      return { title: who, body: 'Missed call' };
    case 'mention':
      return {
        title: who,
        body: many ? `Mentioned you ${many} times` : 'Mentioned you',
      };
    case 'like':
      return { title: who, body: 'Liked your post' };
    case 'comment':
      return { title: who, body: 'Commented on your post' };
    case 'story_reply':
      return { title: who, body: 'Replied to your story' };
    case 'ai':
      return { title: 'PINGO AI', body: 'Replied to you' };
    case 'story':
      return { title: who, body: 'Added to their story' };
    case 'follow_request':
      return { title: 'PINGO', body: `${who} wants to follow you` };
    case 'follow_accepted':
      return { title: 'PINGO', body: `${who} accepted your follow request` };
    default:
      return { title: 'PINGO', body: 'Something happened' };
  }
}

/**
 * One invocation, every recipient of one message.
 *
 * ## Why this is a batch now
 *
 * It used to be one invocation per recipient, and on 2026-08-29 that took the
 * API down. A nine-person group received 226 messages in forty-five minutes;
 * the trigger fired 1,573 invocations, each ~1.16 s and each opening with its
 * own dedupe query and its own device lookup. Postgres crossed its statement
 * timeout, message inserts started failing, and everything returned 503 for six
 * minutes.
 *
 * The work was never large - it was just multiplied. A group message is one
 * event with N recipients, so it is now one call: the FCM access token is
 * minted once, the ledger is read once, every recipient's devices are read
 * once, and the bookkeeping is written once per table instead of once per
 * person. The number of round trips stops depending on the size of the group.
 *
 * ## Both shapes are accepted, on purpose
 *
 * `{ recipients: [...] }` is what the trigger sends now; a bare `PushRequest`
 * is what the retry worker still sends, one row at a time, and what any
 * trigger not yet migrated sends. They are the same code path - a single
 * request is a batch of one - so there is no second implementation to keep in
 * step, and no deploy ordering to get right.
 */
Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const expected = Deno.env.get('PUSH_TRIGGER_SECRET');

  if (!expected) {
    console.error('[push-send] PUSH_TRIGGER_SECRET is not set');
    return json({ error: 'not configured' }, 500);
  }

  /*
   * Its own header, not `Authorization`. Supabase's gateway inspects that one,
   * and a value it does not recognise as a key can be rejected before this
   * function ever runs - so the secret travels somewhere nothing else reads.
   */
  const presented = request.headers.get('x-pingo-push-secret') ?? '';

  if (!presented || !sameSecret(presented, expected)) {
    return json({ error: 'not allowed' }, 401);
  }

  try {
    const raw = (await request.json()) as PushRequest | { recipients?: PushRequest[] };
    const batch: PushRequest[] = Array.isArray((raw as { recipients?: PushRequest[] }).recipients)
      ? (raw as { recipients: PushRequest[] }).recipients
      : [raw as PushRequest];

    if (batch.length === 0 || batch.some((r) => !r?.userId || !r?.kind)) {
      return json({ error: 'bad request' }, 400);
    }

    const encoded = Deno.env.get('FCM_SERVICE_ACCOUNT_B64');
    if (!encoded) {
      // Named rather than swallowed: this is an operator mistake with an
      // obvious fix, and it presents as "push silently does nothing".
      console.error('[push-send] FCM_SERVICE_ACCOUNT_B64 is not set');
      return json({ error: 'not configured' }, 500);
    }

    const account = JSON.parse(atob(encoded)) as ServiceAccount;

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    /*
     * At most once, whoever asked.
     *
     * The trigger and the retry worker both call this, and a slow first attempt
     * can still be in flight when a retry starts. Checking the ledger here -
     * where both paths meet - is what makes that safe. One query for the whole
     * batch rather than one per recipient.
     */
    const notificationIds = batch
      .map((r) => r.notificationId)
      .filter((id): id is string => Boolean(id));

    const delivered = new Set<string>();
    if (notificationIds.length > 0) {
      const { data } = await admin
        .from('push_deliveries')
        .select('notification_id')
        .in('notification_id', notificationIds);
      for (const row of (data ?? []) as { notification_id: string }[]) {
        delivered.add(row.notification_id);
      }
    }

    /* Every recipient's devices, in one read. */
    const userIds = [...new Set(batch.map((r) => r.userId))];
    const { data: tokenRows } = await admin
      .from('device_tokens')
      .select('token,user_id')
      .in('user_id', userIds);

    const devicesFor = new Map<string, string[]>();
    for (const row of (tokenRows ?? []) as { token: string; user_id: string }[]) {
      const list = devicesFor.get(row.user_id) ?? [];
      list.push(row.token);
      devicesFor.set(row.user_id, list);
    }

    /*
     * Nobody to send to is not a failure and must never be retried - the queue
     * would hold it for twenty-four hours over a person who has not installed
     * the app. `on_notification_push` now skips these before they ever reach
     * here; the check stays because the retry worker has no such guard.
     */
    const dropped: string[] = [];
    const targets = batch.filter((r) => {
      if (r.notificationId && delivered.has(r.notificationId)) return false;
      if ((devicesFor.get(r.userId) ?? []).length > 0) return true;
      if (r.notificationId) dropped.push(r.notificationId);
      return false;
    });

    if (dropped.length > 0) {
      await admin.from('push_failures').delete().in('notification_id', dropped);
    }

    if (targets.length === 0) {
      return json({ sent: 0, pruned: 0, recipients: batch.length, skipped: batch.length });
    }

    const token = await accessToken(account);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;

    /** Per recipient, what happened. Filled by the sends below. */
    const outcome = new Map<
      PushRequest,
      { sent: number; transient: number; lastError?: string; permanentError?: string }
    >();
    for (const target of targets) outcome.set(target, { sent: 0, transient: 0 });

    const alive: string[] = [];
    const dead: { token: string; userId: string; reason: string }[] = [];

    /*
     * Every device of every recipient at once.
     *
     * Flattened rather than nested so the whole batch is one wave of requests
     * instead of a wave per person - the point of batching is lost if the
     * recipients are still walked in series.
     */
    await Promise.all(
      targets.flatMap((target) =>
        (devicesFor.get(target.userId) ?? []).map(async (deviceToken) => {
          const result = outcome.get(target)!;
          const { title, body } = copyFor(target);

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: {
                token: deviceToken,
                notification: { title, body },
                /*
                 * Ids only. `data` reaches the app when it is opened, and the
                 * app already has every conversation - it needs to know *where*
                 * to go, not what is there.
                 */
                data: {
                  kind: target.kind,
                  ...(target.subjectId ? { subjectId: target.subjectId } : {}),
                },
                android: {
                  priority: 'HIGH',
                  /*
                   * One tray entry per conversation, updated in place.
                   *
                   * `tag` is what makes Android replace rather than append, and
                   * keying it on the actor and kind means a rapid burst from one
                   * person collapses while a message from somebody else still
                   * arrives separately - which is the distinction that matters.
                   */
                  collapseKey: `${target.kind}:${target.actorId ?? 'system'}`,
                  notification: {
                    channelId: 'pingo_messages',
                    sound: 'default',
                    tag: `${target.kind}:${target.actorId ?? 'system'}`,
                    notificationCount: target.count && target.count > 1 ? target.count : 1,
                  },
                },
              },
            }),
          });

          if (response.ok) {
            result.sent += 1;
            alive.push(deviceToken);
            return;
          }

          const text = await response.text();

          if (isPermanent(response.status, text)) {
            /*
             * Keep what FCM actually said.
             *
             * "fcm rejected token" was the whole reason recorded, which is
             * enough to know a token went and useless for knowing why - and the
             * two causes need different responses. UNREGISTERED is an uninstall
             * and is entirely normal; INVALID_ARGUMENT usually means the payload
             * is wrong, which would prune every healthy device on the product.
             */
            result.permanentError = `${response.status} ${text.slice(0, 180)}`;
            dead.push({
              token: deviceToken,
              userId: target.userId,
              reason: result.permanentError,
            });
          } else {
            // Transient: 429, 5xx, a timeout. The token survives and the
            // notification goes back in the queue below.
            result.transient += 1;
            result.lastError = `${response.status} ${text.slice(0, 180)}`;
            console.warn('[push-send] fcm transient', response.status, text.slice(0, 200));
          }
        }),
      ),
    );

    /* One statement per table, whatever the size of the batch. */
    if (alive.length > 0) {
      await admin
        .from('device_tokens')
        .update({ last_seen_at: new Date().toISOString() })
        .in('token', alive);
    }

    if (dead.length > 0) {
      await admin.from('device_tokens').delete().in('token', dead.map((d) => d.token));
      // Recorded so pruning is measurable. The token itself is not kept - it is
      // gone, and storing dead tokens would only rebuild the table this just
      // cleaned.
      await admin
        .from('push_pruned_tokens')
        .insert(dead.map((d) => ({ user_id: d.userId, reason: d.reason })));
    }

    /*
     * The outcome, written where the worker can see it.
     *
     * A send counts as delivered if it reached at least one device. Somebody
     * with a live phone and a stale tablet has been notified, and holding the
     * notification in a queue for the tablet would send them a second copy on
     * the phone a minute later.
     */
    const sentRows = targets.filter((t) => t.notificationId && outcome.get(t)!.sent > 0);
    const retryRows = targets.filter(
      (t) => t.notificationId && outcome.get(t)!.sent === 0 && outcome.get(t)!.transient > 0,
    );
    const exhausted = targets.filter(
      (t) => t.notificationId && outcome.get(t)!.sent === 0 && outcome.get(t)!.transient === 0,
    );

    if (sentRows.length > 0) {
      /* Created-at for every delivered notification, in one read, for latency. */
      const { data: rows } = await admin
        .from('notifications')
        .select('id,created_at')
        .in('id', sentRows.map((t) => t.notificationId!));

      const createdAt = new Map(
        ((rows ?? []) as { id: string; created_at: string }[]).map((r) => [r.id, r.created_at]),
      );

      // Upsert, not insert: an overlapping attempt may have got here first, and
      // the unique key is the whole point.
      await admin.from('push_deliveries').upsert(
        sentRows.map((t) => {
          const at = createdAt.get(t.notificationId!);
          const latency = at ? Date.now() - new Date(at).getTime() : null;
          return {
            notification_id: t.notificationId!,
            user_id: t.userId,
            device_count: outcome.get(t)!.sent,
            ...(latency !== null ? { latency_ms: latency } : {}),
          };
        }),
        { onConflict: 'notification_id' },
      );
    }

    if (retryRows.length > 0) {
      /*
       * Queued for the worker. `next_attempt_at` is left at its default of
       * now() so the first retry happens on the next tick rather than a minute
       * after this row was written - `push_backoff` owns the schedule from the
       * second attempt onward.
       */
      await admin.from('push_failures').upsert(
        retryRows.map((t) => ({
          notification_id: t.notificationId!,
          user_id: t.userId,
          reason: 'fcm transient failure',
          last_error: outcome.get(t)!.lastError,
          kind: t.kind,
          actor_id: t.actorId ?? null,
          actor_name: t.actorName ?? null,
          subject_id: t.subjectId ?? null,
        })),
        { onConflict: 'notification_id', ignoreDuplicates: false },
      );
    }

    /* Delivered, or every device permanently dead. Neither is worth retrying. */
    const settled = [...sentRows, ...exhausted].map((t) => t.notificationId!);
    if (settled.length > 0) {
      await admin.from('push_failures').delete().in('notification_id', settled);
    }

    const sent = targets.reduce((n, t) => n + outcome.get(t)!.sent, 0);
    const transient = targets.reduce((n, t) => n + outcome.get(t)!.transient, 0);

    return json({
      sent,
      pruned: dead.length,
      transient,
      recipients: batch.length,
      skipped: batch.length - targets.length,
      queued: retryRows.length,
    });
  } catch (cause) {
    console.error('[push-send]', cause);
    return json({ error: 'failed' }, 500);
  }
});
