/**
 * Reply and Mark as read, from a notification.
 *
 * The phone's notification has two buttons, and pressing either must work with
 * the app closed: no WebView, no session, nothing but what the notification
 * itself carries. So the device proves who it is with what it was given when
 * the app last ran: its push token and a random action key whose SHA-256 the
 * app stored against that token (`set_push_action_key`). The key never leaves
 * the phone except to come here, and only the hash is stored.
 *
 * `POST { token, key, action: 'read' | 'reply', conversationId, text? }`
 *
 * - `read`: the chat is marked read for that account, exactly as opening it
 *   would (`mark_conversation_read_as`), which also clears its notifications
 *   on every device.
 * - `reply`: a text message is sent as that account, then the chat is read.
 *
 * `verify_jwt` is off: the caller has no session by design. The token and key
 * are the whole check, compared in constant time, and the account must be a
 * member of the chat.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Body = { token?: string; key?: string; action?: string; conversationId?: string; text?: string };

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const token = body.token?.trim() ?? '';
  const key = body.key?.trim() ?? '';
  const conversationId = body.conversationId?.trim() ?? '';
  const action = body.action;
  if (!token || key.length < 32 || !UUID.test(conversationId) || (action !== 'read' && action !== 'reply')) {
    return json({ error: 'bad request' }, 400);
  }
  const text = (body.text ?? '').trim().slice(0, 4000);
  if (action === 'reply' && !text) return json({ error: 'empty reply' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: device } = await admin
      .from('device_tokens')
      .select('user_id, action_key_hash')
      .eq('token', token)
      .maybeSingle();
    const stored = (device as { user_id: string; action_key_hash: string | null } | null) ?? null;
    if (!stored?.action_key_hash || !sameSecret(await sha256Hex(key), stored.action_key_hash)) {
      return json({ error: 'not allowed' }, 401);
    }
    const userId = stored.user_id;

    const { data: member } = await admin
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!member) return json({ error: 'not allowed' }, 403);

    if (action === 'reply') {
      const { data: sent, error } = await admin
        .from('messages')
        .insert({ conversation_id: conversationId, sender_id: userId, body: text, kind: 'text' })
        .select('id')
        .single();
      if (error) {
        console.error('[push-action] reply', error.message);
        return json({ error: 'could not send' }, 500);
      }
      await admin.rpc('mark_conversation_read_as', { target_user: userId, conv: conversationId });
      return json({ ok: true, messageId: (sent as { id: string }).id });
    }

    const { error } = await admin.rpc('mark_conversation_read_as', { target_user: userId, conv: conversationId });
    if (error) {
      console.error('[push-action] read', error.message);
      return json({ error: 'could not mark read' }, 500);
    }
    await admin.from('device_tokens').update({ last_seen_at: new Date().toISOString() }).eq('token', token);
    return json({ ok: true });
  } catch (cause) {
    console.error('[push-action]', cause instanceof Error ? cause.message : cause);
    return json({ error: 'failed' }, 500);
  }
});
