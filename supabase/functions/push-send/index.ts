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

  let sent = 0;
  let pruned = 0;
  let transient = 0;
  let lastError: string | undefined;

  try {
    const payload = (await request.json()) as PushRequest;
    if (!payload?.userId || !payload?.kind) return json({ error: 'bad request' }, 400);

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
     * at the bottom, where both paths meet - is what makes that safe. Doing it
     * in the callers would mean coordinating two of them, which is a race
     * waiting for a bad week.
     */
    if (payload.notificationId) {
      const { data: already } = await admin
        .from('push_deliveries')
        .select('notification_id')
        .eq('notification_id', payload.notificationId)
        .maybeSingle();

      if (already) return json({ skipped: 'already-delivered' });
    }

    const { data: devices } = await admin
      .from('device_tokens')
      .select('token')
      .eq('user_id', payload.userId);

    if (!devices || devices.length === 0) {
      /*
       * Nobody to send to is not a failure and must never be retried - the
       * queue would hold it for 24 hours over a person who has not installed
       * the app. The queue entry goes, if there was one.
       */
      if (payload.notificationId) {
        await admin.from('push_failures').delete().eq('notification_id', payload.notificationId);
      }
      return json({ sent: 0, pruned: 0, reason: 'no devices' });
    }

    const token = await accessToken(account);
    const { title, body } = copyFor(payload);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;

    const dead: string[] = [];

    await Promise.all(
      devices.map(async (device: { token: string }) => {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: device.token,
              notification: { title, body },
              /*
               * Ids only. `data` reaches the app when it is opened, and the
               * app already has every conversation - it needs to know *where*
               * to go, not what is there.
               */
              data: {
                kind: payload.kind,
                ...(payload.subjectId ? { subjectId: payload.subjectId } : {}),
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
                collapseKey: `${payload.kind}:${payload.actorId ?? 'system'}`,
                notification: {
                  channelId: 'pingo_messages',
                  sound: 'default',
                  tag: `${payload.kind}:${payload.actorId ?? 'system'}`,
                  notificationCount: payload.count && payload.count > 1 ? payload.count : 1,
                },
              },
            },
          }),
        });

        if (response.ok) {
          sent += 1;
          await admin
            .from('device_tokens')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('token', device.token);
          return;
        }

        const text = await response.text();

        if (isPermanent(response.status, text)) {
          dead.push(device.token);
        } else {
          // Transient: 429, 5xx, a timeout. The token survives and the
          // notification goes back in the queue below.
          transient += 1;
          lastError = `${response.status} ${text.slice(0, 180)}`;
          console.warn('[push-send] fcm transient', response.status, text.slice(0, 200));
        }
      }),
    );

    if (dead.length > 0) {
      await admin.from('device_tokens').delete().in('token', dead);
      pruned = dead.length;
      // Recorded so pruning is measurable. The token itself is not kept - it
      // is gone, and storing dead tokens would only rebuild the table this
      // just cleaned.
      await admin.from('push_pruned_tokens').insert(
        dead.map(() => ({ user_id: payload.userId, reason: 'fcm rejected token' })),
      );
    }

    /*
     * The outcome, written where the worker can see it.
     *
     * A send counts as delivered if it reached at least one device. Somebody
     * with a live phone and a stale tablet has been notified, and holding the
     * notification in a queue for the tablet would send them a second copy on
     * the phone a minute later.
     */
    if (payload.notificationId) {
      if (sent > 0) {
        const { data: row } = await admin
          .from('notifications')
          .select('created_at')
          .eq('id', payload.notificationId)
          .maybeSingle();

        const latency = row?.created_at
          ? Date.now() - new Date(row.created_at as string).getTime()
          : null;

        // Upsert, not insert: an overlapping attempt may have got here first,
        // and the unique key is the whole point.
        await admin.from('push_deliveries').upsert(
          {
            notification_id: payload.notificationId,
            user_id: payload.userId,
            device_count: sent,
            ...(latency !== null ? { latency_ms: latency } : {}),
          },
          { onConflict: 'notification_id' },
        );

        await admin.from('push_failures').delete().eq('notification_id', payload.notificationId);
      } else if (transient > 0) {
        /*
         * Queued for the worker. `next_attempt_at` is left at its default of
         * now() so the first retry happens on the next tick rather than a
         * minute after this row was written - `push_backoff` owns the schedule
         * from the second attempt onward.
         */
        await admin.from('push_failures').upsert(
          {
            notification_id: payload.notificationId,
            user_id: payload.userId,
            reason: 'fcm transient failure',
            last_error: lastError,
            kind: payload.kind,
            actor_id: payload.actorId ?? null,
            actor_name: payload.actorName ?? null,
            subject_id: payload.subjectId ?? null,
          },
          { onConflict: 'notification_id', ignoreDuplicates: false },
        );
      } else {
        // Every device was permanently dead. Nothing to retry to.
        await admin.from('push_failures').delete().eq('notification_id', payload.notificationId);
      }
    }

    return json({ sent, pruned, transient, queued: sent === 0 && transient > 0 });
  } catch (cause) {
    console.error('[push-send]', cause);
    return json({ error: 'failed' }, 500);
  }
});
