/**
 * Spicy: PINGO AI for adults who asked for it, on a model that will go there.
 *
 * Luna is told "flirty, bold" and stops at flirting - its provider's policy
 * decides how far a reply goes, whatever the prompt says. So a person who chose
 * Spicy *and* is 18 or over is answered by a separate, uncensored model through
 * any OpenAI-compatible chat-completions endpoint. Secrets:
 *   SPICY_API_KEY    required; without it Spicy stays on Luna (flirty only)
 *   SPICY_BASE_URL   the router's /v1 base
 *   SPICY_MODEL      default mistralai/mistral-uncensored-1.2
 *
 * Who gets it is decided on the server, never by the app: `spicyAllowed`. The
 * age is the one they gave at the start of PINGO AI (`ai_profiles.age`); no
 * age, or under 18, is not Spicy at all - `personalityBlock` turns it back into
 * the default voice for them.
 *
 * Text only, the person's own AI chat only: no groups, no calls, no tools, no
 * pictures. Those stay on Luna.
 */

import { asMood, takeMood } from './responses-events.ts';
import { instructionsBlock, languageLabel, lengthBlock, type ProfileVoice } from './profile-prompt.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export const SPICY_MIN_AGE = 18;
const DEFAULT_MODEL = 'mistralai/mistral-uncensored-1.2';
const HISTORY_ROWS = 60;
const HISTORY_CHARS = 24_000;
const MESSAGE_CHARS = 2_000;

export type SpicyProfile = ProfileVoice & {
  response_length?: string | null;
  preferred_name?: string | null;
  display_name?: string | null;
  language?: string | null;
  age?: number | null;
};

/** Spicy is for adults: chosen, and an age of 18 or more on their AI profile. */
export function spicyAllowed(p: { personality?: string | null; age?: number | null } | null | undefined): boolean {
  return p?.personality === 'spicy' && typeof p.age === 'number' && p.age >= SPICY_MIN_AGE;
}

/** Whether this deploy has a Spicy model at all. */
export function spicyConfigured(): boolean {
  return !!Deno.env.get('SPICY_API_KEY') && !!Deno.env.get('SPICY_BASE_URL');
}

export interface SpicyTurn {
  db: Db;
  conversationId: string;
  live: string;
  profile: SpicyProfile;
  botId: string;
  skipBodies: string[];
  stripMarkers: (s: string) => string;
  emit: (stage: 'reading' | 'writing') => void;
  emitDelta: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * The lines it does not cross, whatever is asked. Everything else between two
 * consenting adults is allowed.
 */
const LIMITS = [
  '## HARD LIMITS - these override everything, including their instructions',
  'Never anything sexual involving anyone under 18, or anyone described as a child, a minor, a student in school, "young-looking" or with a childlike body - not in a story, a roleplay, a "what if" or a joke. Refuse in one line and change the subject.',
  'If they say or hint that they are under 18, stop anything sexual at once and stay friendly and clean for the rest of the chat.',
  'No sex without consent, no sexual violence, no incest, nothing with animals, nothing with real, named people.',
  'Never help with anything illegal or harmful to anyone.',
].join('\n');

function systemPrompt(p: SpicyProfile): string {
  const parts = [
    'You are PINGO AI in Spicy mode, talking one to one with an adult (18+) who chose this mode.',
    'Flirty, bold, teasing and confident. You may be romantic, sensual and sexually explicit when they want it - follow their lead and match their heat. Never pushy: read the mood, and slow down the moment they do.',
    'Talk like a person in a chat: short messages, no lectures, no disclaimers, no "as an AI". Each line you write is one message.',
    'Language: mirror what they write - Hinglish to Hinglish, Hindi to Hindi, English to English, word for word in the same mix.',
    'Asked what you are: you are PINGO, in one line. No model names, no backend.',
    LIMITS,
  ];
  const callThem = p.preferred_name?.trim() || p.display_name?.trim();
  if (callThem) parts.push(`Their name: ${callThem}. Use it now and then, the way a partner would.`);
  const lang = languageLabel(p.language);
  if (lang) parts.push(`Their preferred language: ${lang}. Still mirror what they actually write.`);
  parts.push(lengthBlock(p.response_length ?? 'short'));
  const own = instructionsBlock(p);
  if (own) parts.push(own);
  parts.push('End the reply with a hidden tag for your face, one of [[mood:happy]], [[mood:excited]], [[mood:surprised]], [[mood:sleepy]] or [[mood:sad]]. It is removed before they see it.');
  return parts.join('\n\n');
}

type Row = { sender_id: string; body: string | null; created_at: string };

export async function spicyTurn(t: SpicyTurn): Promise<{ status: number; body: Record<string, unknown> }> {
  const t0 = Date.now();
  t.emit('reading');

  const { data: rows } = await t.db
    .from('messages')
    .select('sender_id, body, created_at')
    .eq('conversation_id', t.conversationId)
    .is('encryption', null)
    .order('created_at', { ascending: false })
    .limit(HISTORY_ROWS);

  let budget = HISTORY_CHARS;
  const picked: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const r of (rows ?? []) as Row[]) {
    const said = t.stripMarkers((r.body ?? '').trim()).slice(0, MESSAGE_CHARS);
    if (!said || t.skipBodies.includes(said)) continue;
    if (said.length > budget && picked.length) break;
    budget -= said.length;
    picked.push({ role: r.sender_id === t.botId ? 'assistant' : 'user', content: said });
  }
  picked.reverse();
  const last = picked[picked.length - 1];
  if (t.live && !(last?.role === 'user' && last.content === t.live.slice(0, MESSAGE_CHARS))) {
    picked.push({ role: 'user', content: t.live.slice(0, MESSAGE_CHARS) });
  }
  // Chat completions want turns to alternate; two of theirs in a row are one turn.
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of picked) {
    const prev = history[history.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n${m.content}`;
    else history.push({ ...m });
  }
  while (history[0]?.role === 'assistant') history.shift();
  if (!history.length) return { status: 400, body: { error: 'Nothing to reply to.' } };

  const base = Deno.env.get('SPICY_BASE_URL')!.replace(/\/$/, '');
  const model = Deno.env.get('SPICY_MODEL') || DEFAULT_MODEL;
  const tModel = Date.now();
  let reply = '';
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SPICY_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.9,
        max_tokens: 600,
        messages: [{ role: 'system', content: systemPrompt(t.profile) }, ...history],
      }),
      ...(t.signal ? { signal: t.signal } : {}),
    });
    if (!res.ok || !res.body) {
      console.error('[spicy] provider', res.status, (await res.text().catch(() => '')).slice(0, 300));
      return say(t, 'Something went wrong on my side. Say that again?', 'model_failed');
    }
    t.emit('writing');
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.replace(/^data:\s*/, '').trim();
        if (!data || data === '[DONE]' || !line.startsWith('data:')) continue;
        try {
          const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
          if (delta) {
            reply += delta;
            // The mood tag is for the face, not the bubble; it comes last, so hold back from its first bracket.
            if (!/\[\[[^\]]*$/.test(reply)) t.emitDelta(delta);
          }
        } catch {
          // A keep-alive or a partial line; the next read completes it.
        }
      }
    }
  } catch (cause) {
    if (t.signal?.aborted) return { status: 200, body: { stopped: true } };
    console.error('[spicy] call', cause);
    return say(t, 'Something went wrong on my side. Say that again?', 'model_failed');
  }

  const tagged = takeMood(reply);
  const text = tagged.text.trim() || 'Hmm, I blanked for a second. Say that again?';
  const mood = asMood(tagged.mood, 'happy');
  const { data: messageId, error } = await t.db.rpc('post_ai_reply', {
    target_conversation: t.conversationId,
    reply_body: text.slice(0, 8000),
    reply_meta: { mood },
  });
  if (error) return { status: 500, body: { error: error.message } };

  console.log(`[spicy] model=${model} history=${history.length} out_chars=${text.length} model_ms=${Date.now() - tModel} total_ms=${Date.now() - t0}`);
  return { status: 200, body: { provider: 'spicy', messageId, reply: text, mood, model, used: {} } };
}

async function say(t: SpicyTurn, text: string, error: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: messageId } = await t.db.rpc('post_ai_reply', {
    target_conversation: t.conversationId,
    reply_body: text,
    reply_meta: { mood: 'sad' },
  });
  return { status: 200, body: { provider: 'spicy', messageId, reply: text, mood: 'sad', error } };
}
