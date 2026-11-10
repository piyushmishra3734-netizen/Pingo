/**
 * PINGO AI reaches out to somebody who has been away.
 *
 * Called by the `ai-nudge` cron job (every 30 minutes) through
 * `public.ai_nudge_tick()`, and by hand with `?dry=1` to read what it would send
 * without sending anything. Authenticated with the same shared secret as the
 * push trigger (`x-pingo-push-secret`), never the service role key.
 *
 * WHO is decided in the database (`ai_nudge_candidates`: idle, reachable, their
 * own notification settings respected, spaced out, three at most without a
 * reply). This function only writes the line and posts it. Posting is an
 * ordinary message from PINGO AI, so the existing message trigger turns it into
 * a notification and `push-send` delivers it - and a muted or paused account
 * never receives it.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const MAX_PER_ROUND = 5;
const MAX_CHARS = 160;

const SYSTEM = [
  'You are PINGO, a friendly AI inside the PINGO chat app. The person has not opened the app for a couple of days.',
  'Write ONE short push-notification message (at most 140 characters) that picks up the last thing the two of you talked about, so they feel like coming back to it.',
  'Warm, light, curious. No guilt, no pressure, no "we miss you", no mention of days passing or of noticing they were away. At most one emoji.',
  'Match their language and style: if they write Hinglish, write Hinglish; if English, English.',
  'Use only what is in the conversation. Do not invent facts or ask for personal details.',
  'Output only the message text, on one line, with no quotation marks.',
].join('\n');

/** A half emoji (from cutting text mid-character) is rejected by providers; see ai-chat/well-formed.ts. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const wellFormed = (text: string) => text.replace(LONE_SURROGATE, '�');
const clip = (text: string, n: number) => Array.from(text).slice(0, n).join('');

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function write(transcript: string): Promise<string | null> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return null;
  const base = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = Deno.env.get('OPENAI_NUDGE_MODEL') || Deno.env.get('OPENAI_MODEL') || 'gpt-6-luna';

  const ask = async (withReasoning: boolean) =>
    fetch(`${base}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          model,
          input: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `The conversation so far:\n\n${transcript}\n\nWrite the message.` },
          ],
          max_output_tokens: 200,
          store: false,
          ...(withReasoning ? { reasoning: { effort: 'none' } } : {}),
        },
        (_k, v) => (typeof v === 'string' ? wellFormed(v) : v),
      ),
      signal: AbortSignal.timeout(25_000),
    });

  let res = await ask(true);
  // A model that does not know the reasoning field: the same request without it.
  if (res.status === 400) res = await ask(false);
  if (!res.ok) {
    console.error('[ai-nudge] model', res.status, (await res.text().catch(() => '')).slice(0, 300));
    return null;
  }
  const data = (await res.json()) as {
    output_text?: string;
    output?: { content?: { text?: string }[] }[];
  };
  const raw =
    data.output_text ??
    (data.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('');
  const line = wellFormed(raw).replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '').trim();
  if (line.length < 4) return null;
  return clip(line, MAX_CHARS);
}

Deno.serve(async (request) => {
  const expected = Deno.env.get('PUSH_TRIGGER_SECRET');
  if (!expected) {
    console.error('[ai-nudge] PUSH_TRIGGER_SECRET is not set');
    return new Response('not configured', { status: 500 });
  }
  if (!constantTimeEqual(request.headers.get('x-pingo-push-secret') ?? '', expected)) {
    return new Response('forbidden', { status: 403 });
  }

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: botId } = await admin.rpc('pingo_ai_user_id');
  const { data: candidates, error } = await admin.rpc('ai_nudge_candidates', { p_limit: dry ? 3 : MAX_PER_ROUND });
  if (error || !botId) {
    console.error('[ai-nudge] candidates', error?.message ?? 'no bot id');
    return new Response('failed', { status: 500 });
  }

  const results: { sent: boolean; text: string | null }[] = [];
  for (const candidate of (candidates ?? []) as { user_id: string; conversation_id: string }[]) {
    const { data: rows } = await admin
      .from('messages')
      .select('sender_id, body, kind')
      .eq('conversation_id', candidate.conversation_id)
      .eq('kind', 'text')
      .not('body', 'is', null)
      .order('created_at', { ascending: false })
      .limit(14);

    const lines = ((rows ?? []) as { sender_id: string; body: string }[])
      .filter((r) => r.body.trim().length > 0)
      .reverse()
      .map((r) => `${r.sender_id === botId ? 'You' : 'Them'}: ${clip(r.body.replace(/\s+/g, ' ').trim(), 300)}`);
    if (lines.length < 2) continue;

    const text = await write(lines.join('\n'));
    if (!text) {
      results.push({ sent: false, text: null });
      continue;
    }
    if (dry) {
      results.push({ sent: false, text });
      continue;
    }

    // An ordinary message from PINGO AI: the message trigger makes the notification.
    const { data: message, error: insertError } = await admin
      .from('messages')
      .insert({ conversation_id: candidate.conversation_id, sender_id: botId, body: text, kind: 'text' })
      .select('id')
      .single();
    if (insertError || !message) {
      console.error('[ai-nudge] insert', insertError?.message);
      results.push({ sent: false, text });
      continue;
    }
    await admin.from('ai_nudges').insert({
      user_id: candidate.user_id,
      conversation_id: candidate.conversation_id,
      message_id: message.id,
    });
    results.push({ sent: true, text });
  }

  return Response.json({ dry, candidates: (candidates ?? []).length, results });
});
