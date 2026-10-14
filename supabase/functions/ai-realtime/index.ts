/**
 * PINGO AI on a live voice call: OpenAI's Realtime API, speech to speech, over
 * WebRTC straight from the browser.
 *
 * ## Two actions, one function
 *
 * `POST { conversationId, voice? }` (or `action: 'start'`): mints a short-lived
 * client secret for one call. The browser uses it once, to post its SDP offer
 * to OpenAI; the real API key never leaves this function. The session it
 * opens already carries PINGO AI's character, this person's settings and a
 * few of their saved memories, so nothing about them is sent from the client.
 * Answers `{ clientSecret, expiresAt, model, voice, maxSeconds, callsUrl }`.
 *
 * `POST { action: 'preview', voice, speed?, language? }`: a few seconds of that
 * voice saying hello, as MP3, for the profile page's voice picker. Same voices
 * as a call, through `/v1/audio/speech`. No conversation needed.
 *
 * `POST { conversationId, action: 'save', callId?, turns: [{ role, text }] }`:
 * posts a finished call's transcript into the thread, so the chat carries on
 * from what was said. Each turn is its own message, in order:
 *   - their turns as THEIR messages, inserted with their own JWT exactly like a
 *     normal send (RLS: `sender_id = auth.uid()` and a member). Inserted here,
 *     not by `ChatService.sendMessage`, because that path asks for an AI reply
 *     after every message in an `ai` thread; a row inserted here does not.
 *     `meta.aiCall = true`, plus `meta.callId`.
 *   - PINGO AI's turns through `post_ai_reply` with `reply_meta`, which lands
 *     as `meta.ai = { call: true, callId }`.
 *   AI threads are plaintext (`encryption` null), the same as ai-chat reads
 *   and writes them. With a `callId`, a second save of the same call is a
 *   no-op, so a retry cannot post the transcript twice.
 *
 * Who may call: the same check as ai-chat. The caller's JWT is verified, and
 * the conversation must be visible to them under RLS and be `kind = 'ai'`.
 *
 * Secrets:
 *   OPENAI_API_KEY               required
 *   OPENAI_BASE_URL              default https://api.openai.com/v1
 *   OPENAI_REALTIME_MODEL        default gpt-realtime-mini
 *   OPENAI_TRANSCRIBE_MODEL      default gpt-4o-mini-transcribe (what is shown and saved of what they said)
 *   OPENAI_REALTIME_VAD          semantic_vad (default) | server_vad
 *   OPENAI_REALTIME_MAX_SECONDS  default 900: the longest call the app allows
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

import {
  buildCallInstructions,
  capMemories,
  cleanTurns,
  pickSpeed,
  pickVoice,
  previewSpeechBody,
  realtimeSessionConfig,
  CALL_MEMORIES,
  type CallProfile,
} from './session.ts';

/* The wire, in one place, in case OpenAI moves it. */
const DEFAULT_BASE = 'https://api.openai.com/v1';
const CLIENT_SECRETS_PATH = '/realtime/client_secrets';
/** Where the browser posts its SDP offer with the client secret (returned as `callsUrl`). */
const CALLS_PATH = '/realtime/calls';
// Mini: about a third of gpt-realtime's price per minute. OPENAI_REALTIME_MODEL=gpt-realtime brings the full one back.
const DEFAULT_MODEL = 'gpt-realtime-mini';
const DEFAULT_TRANSCRIBE = 'gpt-4o-mini-transcribe';
/** How long the browser has to use the secret to connect. The call may outlast it. */
const SECRET_SECONDS = 120;
const DEFAULT_MAX_SECONDS = 900;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsHeaders(request: Request): HeadersInit {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') ?? '*',
    'Access-Control-Allow-Headers':
      request.headers.get('Access-Control-Request-Headers') ??
      'authorization, x-client-info, apikey, content-type, x-pingo-client',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

type Body = {
  conversationId?: string;
  action?: 'start' | 'save' | 'preview';
  voice?: string;
  speed?: number;
  language?: string;
  callId?: string;
  turns?: unknown;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'POST only.' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json(request, { error: 'Sign in required.' }, 401);

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error: userError,
    } = await db.auth.getUser();
    if (userError || !user) return json(request, { error: 'Sign in required.' }, 401);

    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return json(request, { error: 'Expected a JSON body.' }, 400);
    }
    if (body.action === 'preview') return await preview(request, body);
    const conversationId = body.conversationId?.trim();
    if (!conversationId || !UUID.test(conversationId)) return json(request, { error: 'conversationId required.' }, 400);

    // RLS answers "may they see it"; the kind answers "is it their PINGO AI thread".
    const { data: conv } = await db.from('conversations').select('id, kind').eq('id', conversationId).maybeSingle();
    if (!conv) return json(request, { error: 'Conversation not found.' }, 404);
    if (conv.kind !== 'ai') return json(request, { error: 'Not a PINGO AI conversation.' }, 403);

    if (body.action === 'save') return await save(request, db, user.id, conversationId, body);
    return await start(request, db, user.id, body);
  } catch (err) {
    console.error('[ai-realtime]', err instanceof Error ? err.message : err);
    return json(request, { error: 'Something went wrong starting the call.' }, 500);
  }
});

// deno-lint-ignore no-explicit-any
type Db = any;

async function start(request: Request, db: Db, userId: string, body: Body): Promise<Response> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    console.error('[ai-realtime] OPENAI_API_KEY is unset');
    return json(request, { error: 'Voice calls are not set up yet.' }, 503);
  }
  const base = (Deno.env.get('OPENAI_BASE_URL') || DEFAULT_BASE).replace(/\/$/, '');
  const model = Deno.env.get('OPENAI_REALTIME_MODEL') || DEFAULT_MODEL;
  const transcribeModel = Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || DEFAULT_TRANSCRIBE;
  const vad = Deno.env.get('OPENAI_REALTIME_VAD') === 'server_vad' ? 'server_vad' : 'semantic_vad';
  /*
   * Free accounts get 120 seconds of calls a day (ai_usage). What is left is
   * reserved now - two calls at once cannot both have it - and the call's end
   * (save) gives back what it did not use, timed here, not by the app.
   */
  const allowed = await callAllowance(userId);
  if (allowed === 0) return json(request, { error: 'Your 2 free call minutes for today are used up. They come back at midnight.', code: 'call_limit' }, 402);
  const maxSeconds = Math.min(Number(Deno.env.get('OPENAI_REALTIME_MAX_SECONDS')) || DEFAULT_MAX_SECONDS, allowed > 0 ? allowed : Infinity);
  const { data: profile } = await db
    .from('ai_profiles')
    .select('personality, custom_personality, custom_instructions, response_length, preferred_name, display_name, language, country, memory_enabled, voice, voice_speed, voice_language')
    .eq('user_id', userId)
    .maybeSingle();
  const p = (profile ?? null) as CallProfile | null;
  // The voice saved on their profile wins; the one the app sent is for rows from before it was saved there.
  const voice = pickVoice(p?.voice ?? body.voice);
  const speed = pickSpeed(p?.voice_speed);

  let memories: string[] = [];
  if (p?.memory_enabled !== false) {
    const { data } = await db
      .from('ai_memories')
      .select('value')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(CALL_MEMORIES);
    memories = capMemories(((data ?? []) as { value: string }[]).map((m) => m.value ?? ''));
  }

  const instructions = buildCallInstructions(p, memories);
  const res = await fetch(`${base}${CLIENT_SECRETS_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenAI asks for a stable, non-identifying id per end user, for abuse handling.
      'OpenAI-Safety-Identifier': await hashed(userId),
    },
    body: JSON.stringify(realtimeSessionConfig({ model, voice, speed, instructions, transcribeModel, turnDetection: vad, secretSeconds: SECRET_SECONDS })),
  });
  const out = (await res.json().catch(() => ({}))) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string; expires_at?: number };
    error?: { message?: string; code?: string };
  };
  // `value` is the GA shape; `client_secret.value` the older beta one.
  const secret = out.value ?? out.client_secret?.value;
  if (!res.ok || !secret) {
    // The error OpenAI sent, never the request (which holds nothing secret anyway, but the key is in its headers).
    console.error('[ai-realtime] client_secrets', res.status, out.error?.code ?? '', out.error?.message ?? '');
    return json(request, { error: 'Could not start the call. Try again in a moment.' }, 502);
  }
  console.log(`[ai-realtime] start model=${model} voice=${voice} speed=${speed} vad=${vad} memories=${memories.length} instructions_chars=${instructions.length}`);
  return json(request, {
    clientSecret: secret,
    expiresAt: out.expires_at ?? out.client_secret?.expires_at ?? Math.floor(Date.now() / 1000) + SECRET_SECONDS,
    model,
    voice,
    maxSeconds,
    callsUrl: `${base}${CALLS_PATH}`,
  });
}

/* The same line in the same voice is the same sound: kept for as long as this instance lives. */
const previews = new Map<string, ArrayBuffer>();

async function preview(request: Request, body: Body): Promise<Response> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json(request, { error: 'Voice previews are not set up yet.' }, 503);
  const base = (Deno.env.get('OPENAI_BASE_URL') || DEFAULT_BASE).replace(/\/$/, '');
  const voice = pickVoice(body.voice);
  const speed = pickSpeed(body.speed);
  const language = typeof body.language === 'string' ? body.language.slice(0, 8) : null;
  const payload = previewSpeechBody(voice, speed, language);
  const key = JSON.stringify(payload);
  let bytes = previews.get(key);
  if (!bytes) {
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: key,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      console.error('[ai-realtime] preview', res.status, err.error?.message ?? '');
      return json(request, { error: 'Could not play that voice right now.' }, 502);
    }
    bytes = await res.arrayBuffer();
    previews.set(key, bytes);
    if (previews.size > 80) previews.delete(previews.keys().next().value!);
  }
  return new Response(bytes, { headers: { ...corsHeaders(request), 'Content-Type': 'audio/mpeg' } });
}

async function save(request: Request, db: Db, userId: string, conversationId: string, body: Body): Promise<Response> {
  await usageAdmin().rpc('ai_call_end', { p_user: userId }).then(({ error }: { error: { message: string } | null }) => {
    if (error) console.error('[ai-realtime] call end', error.message);
  });
  const turns = cleanTurns(body.turns);
  if (!turns.length) return json(request, { saved: 0 });
  const callId = typeof body.callId === 'string' && UUID.test(body.callId) ? body.callId : undefined;

  if (callId) {
    const { data: already } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .or(`meta->>callId.eq.${callId},meta->ai->>callId.eq.${callId}`)
      .limit(1);
    if (already?.length) return json(request, { saved: 0, duplicate: true });
  }

  /*
   * One at a time, in order: each row gets its own `created_at`, so the thread
   * reads in the order it was said. A bulk insert would stamp them all alike.
   */
  const ids: string[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      const { data, error } = await db
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: userId,
          body: t.text,
          encryption: null,
          envelope: null,
          meta: { aiCall: true, ...(callId ? { callId } : {}) },
        })
        .select('id')
        .single();
      if (error) {
        console.error('[ai-realtime] save user turn', error.message);
        return json(request, { saved: ids.length, messageIds: ids, error: 'Could not save the whole call.' }, 500);
      }
      ids.push(data.id);
    } else {
      const { data, error } = await db.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: t.text,
        reply_meta: { call: true, ...(callId ? { callId } : {}) },
      });
      if (error) {
        console.error('[ai-realtime] save ai turn', error.message);
        return json(request, { saved: ids.length, messageIds: ids, error: 'Could not save the whole call.' }, 500);
      }
      ids.push(data as string);
    }
  }
  console.log(`[ai-realtime] save turns=${ids.length}`);
  return json(request, { saved: ids.length, messageIds: ids });
}

async function hashed(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pingo:${id}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function usageAdmin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Seconds this call may last: 0 none left today, -1 unlimited. Fails open: a broken counter must not stop calls. */
async function callAllowance(userId: string): Promise<number> {
  const { data, error } = await usageAdmin().rpc('ai_call_start', { p_user: userId });
  if (error) {
    console.error('[ai-realtime] call allowance', error.message);
    return -1;
  }
  return Number(data);
}
