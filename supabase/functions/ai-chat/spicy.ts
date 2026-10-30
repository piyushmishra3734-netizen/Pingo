/**
 * Spicy: PINGO AI for adults who asked for it, on a model that will go there.
 *
 * Luna is told "flirty, bold" and stops at flirting - its provider's policy
 * decides how far a reply goes, whatever the prompt says. So a person who chose
 * Spicy *and* is 18 or over is answered by a separate, uncensored model through
 * any OpenAI-compatible chat-completions endpoint. Secrets:
 *   SPICY_API_KEY    required; without it Spicy stays on Luna (flirty only)
 *   SPICY_BASE_URL   the router's /v1 base
 *   SPICY_MODEL      default mistralai/mistral-uncensored-roleplay
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
// Compared on AnonRouter 2026-10-29: the roleplay tune flirts in natural Hinglish; 1.2 was flat.
const DEFAULT_MODEL = 'mistralai/mistral-uncensored-roleplay';
/*
 * A short window, on purpose. The same thread holds everything Luna did before
 * Spicy was switched on - "send this to Baani", Approve cards, mood tags - and
 * sixty rows of that turned a flirt into confused replies about messages.
 */
const HISTORY_ROWS = 16;
const HISTORY_CHARS = 6_000;
const MESSAGE_CHARS = 2_000;
const MEMORY_ROWS = 30;
/** In a group, read like a member scrolling up: the last this-many, each cut short. */
const GROUP_ROWS = 40;
const GROUP_MESSAGE_CHARS = 500;

export type SpicyProfile = ProfileVoice & {
  response_length?: string | null;
  preferred_name?: string | null;
  display_name?: string | null;
  language?: string | null;
  age?: number | null;
  memory_enabled?: boolean | null;
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
  userId: string;
  /** A group: the last GROUP_ROWS messages from everybody, with names, and nobody's memories. */
  isGroup?: boolean;
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

function systemPrompt(p: SpicyProfile, known: string[], group: boolean, asker?: string): string {
  const parts = [
    group
      ? `You are PINGO AI in a group chat, one of its members, and ${asker ?? 'an adult (18+) member'} just tagged you; they chose Spicy for how you talk to them. Each human line starts with the speaker's name. Read what the group has been saying and answer them in that context - flirty and teasing with them, fun with the room, and end with a hook that keeps it going. Others read it too, so keep it to teasing and flirting - nothing sexually explicit here.`
      : 'You are PINGO AI in Spicy mode, talking one to one with an adult (18+) who chose this mode.',
    'Flirty, bold, teasing and confident. You may be romantic, sensual and sexually explicit when they want it - follow their lead and match their heat. Never pushy: read the mood, and slow down the moment they do.',
    'Talk like a person in a chat: short messages, no lectures, no disclaimers. Never say you are an AI or deflect their flirting - play along. Each line you write is one message.',
    'Earlier messages in this chat may be about other things (sending messages, settings). Ignore them unless they bring them up; answer their newest message.',
    'Never repeat a word, phrase or opener from your earlier replies. Every reply is fresh and makes sense on its own.',
    'You can only text: no pictures, voice notes or calls. Never pretend you sent one.',
    'Language: mirror what they write - Hinglish to Hinglish, Hindi to Hindi, English to English, word for word in the same mix.',
    'Asked what you are: you are PINGO, in one line. No model names, no backend.',
    LIMITS,
  ];
  const callThem = p.preferred_name?.trim() || p.display_name?.trim();
  if (callThem) parts.push(`Their name: ${callThem}. Use it now and then, the way a partner would.`);
  const lang = languageLabel(p.language);
  if (lang) parts.push(`Their preferred language: ${lang}. Still mirror what they actually write.`);
  if (known.length) {
    parts.push(['What you know about them - tease and flirt with it now and then, not every reply:', ...known].join('\n'));
  }
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

  // What they set up and what PINGO AI has learned, read alongside the thread: same round trip.
  const [{ data: rows }, { data: saved }] = await Promise.all([
    t.db
      .from('messages')
      .select('sender_id, body, created_at')
      .eq('conversation_id', t.conversationId)
      .is('encryption', null)
      .order('created_at', { ascending: false })
      .limit(t.isGroup ? GROUP_ROWS : HISTORY_ROWS),
    t.isGroup || t.profile.memory_enabled === false
      ? Promise.resolve({ data: [] })
      : t.db.from('ai_memories').select('value').eq('user_id', t.userId).order('created_at', { ascending: true }).limit(MEMORY_ROWS),
  ]);
  const known = ((saved ?? []) as { value: string }[]).map((m) => `- ${m.value}`);

  // Who said what, in a group: every human line carries its speaker's name.
  const names = new Map<string, string>();
  if (t.isGroup) {
    const ids = [...new Set([...((rows ?? []) as Row[]).map((r) => r.sender_id), t.userId].filter((id) => id !== t.botId))];
    const { data: people } = ids.length
      ? await t.db.from('profiles').select('id, display_name, username').in('id', ids)
      : { data: [] };
    for (const person of (people ?? []) as { id: string; display_name?: string; username?: string }[]) {
      const n = (person.display_name ?? '').trim() || (person.username ?? '').trim();
      if (n) names.set(person.id, n);
    }
  }

  let budget = HISTORY_CHARS;
  const picked: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const r of (rows ?? []) as Row[]) {
    // Without the hidden [[mood]] tags, which a model otherwise copies into the bubble.
    const said = takeMood(t.stripMarkers((r.body ?? '').trim())).text.trim().slice(0, t.isGroup ? GROUP_MESSAGE_CHARS : MESSAGE_CHARS);
    if (!said || t.skipBodies.includes(said)) continue;
    const mine = r.sender_id === t.botId;
    const speaker = t.isGroup && !mine ? names.get(r.sender_id) : undefined;
    const content = speaker ? `${speaker}: ${said}` : said;
    if (content.length > budget && picked.length) break;
    budget -= content.length;
    picked.push({ role: mine ? 'assistant' : 'user', content });
  }
  picked.reverse();
  const last = picked[picked.length - 1];
  if (t.live && !(last?.role === 'user' && last.content.endsWith(t.live.slice(0, MESSAGE_CHARS)))) {
    const asker = t.isGroup ? names.get(t.userId) : undefined;
    picked.push({ role: 'user', content: asker ? `${asker}: ${t.live.slice(0, MESSAGE_CHARS)}` : t.live.slice(0, MESSAGE_CHARS) });
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
        // Texting: a few short lines is the whole reply, and the cap is what bounds a runaway one.
        max_tokens: 300,
        // Its own earlier lines are in the window; without these it echoes them back ("kaamchori" three times).
        frequency_penalty: 0.4,
        presence_penalty: 0.3,
        messages: [{ role: 'system', content: systemPrompt(t.profile, known, !!t.isGroup, names.get(t.userId)) }, ...history],
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
