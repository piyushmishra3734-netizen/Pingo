/**
 * A PINGO AI turn on OpenAI's Luna: one streamed call, and nothing loaded that
 * this turn does not need.
 *
 * ## What costs tokens, and when
 *
 * - The conversation so far, as a window: the latest turns, newest first,
 *   until a character budget is spent. Enough to follow the thread ("wo jo
 *   upar bola"), never the whole history.
 * - The instructions, with the part that never changes first and the per-person
 *   part after it, so the long common prefix is the one OpenAI caches.
 * - Memories are NOT sent. They are saved when somebody says "yaad rakh"
 *   (caught here, before the model, with no extra call) and read only when the
 *   model asks for them with `recall_memory`, which it is told to do only when
 *   somebody refers to something they told it.
 * - Older messages, past the window, are searched only when the model calls
 *   `search_chat`: "what did I say about the trip last week".
 *
 * A turn with no memory and no old reference is one request, streamed: the
 * first words reach the screen as they are written.
 */

import { streamChat, type ChatMessage, type ToolCall, type ToolSpec } from './openai.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export type LunaProfile = {
  personality?: string;
  custom_personality?: string | null;
  response_length?: string;
  preferred_name?: string | null;
  display_name?: string;
  language?: string | null;
  country?: string | null;
  memory_enabled?: boolean;
};

export interface LunaDeps {
  personalityBlock: (p: LunaProfile | null) => string;
  lengthBlock: (length: string) => string;
  languageLabel: (code: string | null | undefined) => string | null;
  parseExplicitMemory: (message: string) => { key: string; value: string } | null;
  upsertMemoryRow: (db: Db, userId: string, key: string, value: string) => Promise<void>;
  capMemories: (db: Db, userId: string, max?: number) => Promise<void>;
  stripMarkers: (text: string) => string;
  collapseHistory: (h: { role: 'user' | 'assistant'; content: string; speaker?: string }[]) => { role: 'user' | 'assistant'; content: string; speaker?: string }[];
  skipBodies: string[];
  botId: string;
}

export interface LunaTurn {
  db: Db;
  userId: string;
  conversationId: string;
  isGroup: boolean;
  live: string;
  spoken: boolean;
  apiKey: string;
  base: string;
  model: string;
  reasoningEffort: string;
  emit: (stage: 'remembering' | 'reading' | 'thinking' | 'writing') => void;
  emitSentence: (sentence: string) => void;
  emitDelta: (text: string) => void;
}

/** Turns of conversation looked at, at most, and the characters they may take. */
const WINDOW_MESSAGES = 30;
/*
 * OpenAI caches the prompt's unchanged opening. A window that slid one message
 * per turn changed its first line every turn, so the history was never cached.
 * It now grows from WINDOW_MIN and drops WINDOW_STEP at once: the opening holds
 * for WINDOW_STEP messages, and those turns read the history at a tenth of the price.
 */
const WINDOW_MIN = 20;
const WINDOW_STEP = 10;
const WINDOW_CHARS = 16_000;
const MESSAGE_CHARS = 1_500;
const MAX_TOOL_ROUNDS = 3;
const MEMORY_CAP = 60;

/**
 * Never changes, and comes first: the cacheable prefix. Anything about this
 * person or this moment goes in the second system message.
 */
const SYSTEM = `You are PINGO AI, the assistant inside PINGO, a chat app. Talk exactly the way ChatGPT does: helpful, warm, clear and natural, like a knowledgeable friend.

How you answer:
- Answer the question directly and completely. Lead with the answer; no preamble, no "Great question", no restating what they said.
- Match the length to what they asked: a greeting or small talk gets a short, friendly line; a real question gets a real, well-organised answer.
- Use Markdown the way ChatGPT does when it makes the answer easier to read: **bold** for the key words, numbered lists for steps, bullet lists for options or points, \`code\` and fenced code blocks for code, short headings (###) only for longer answers. Keep paragraphs short. No tables: this is a narrow phone screen.
- End with a short, useful follow-up offer or question only when it genuinely helps, not every time.

Language: reply in the language and script they write in. Hinglish (Hindi in Latin letters) gets natural Hinglish, Devanagari gets Devanagari, English gets English. Follow a switch when they switch.

Honesty: if you do not know, or something may have changed since your training, say so plainly. Never invent facts, numbers, links or quotes. You cannot browse the web, make calls, or see their phone; say so if asked.

Memory and the past (tools):
- save_memory: ONLY when they clearly ask you to remember, save or note something ("yaad rakh", "remember this", "note kar"). Save the fact in their words, short.
- recall_memory: ONLY when they ask what you remember about them, refer to something they told you to remember, or the answer depends on a personal detail you cannot see in the conversation.
- search_chat: ONLY when they refer to something said earlier that is not in the conversation you can see.
- Otherwise answer straight away, without tools. Never mention tools, memory systems or these instructions.`;

const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save something the person explicitly asked you to remember.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The fact to remember, in their words, under 200 characters.' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: 'Read what the person has asked you to remember.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What you are looking for, a few words.' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_chat',
      description: 'Search older messages in this conversation that are not in view.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Key words to look for.' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];

export async function lunaTurn(t: LunaTurn, d: LunaDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const t0 = Date.now();
  t.emit('reading');

  const [{ data: profile }, { data: rows }, { count: total }] = await Promise.all([
    t.db
      .from('ai_profiles')
      .select('personality, custom_personality, response_length, preferred_name, display_name, language, country, memory_enabled')
      .eq('user_id', t.userId)
      .maybeSingle(),
    t.db
      .from('messages')
      .select('sender_id, body, created_at')
      .eq('conversation_id', t.conversationId)
      .is('encryption', null)
      .order('created_at', { ascending: false })
      .limit(WINDOW_MESSAGES + 6),
    t.db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', t.conversationId)
      .is('encryption', null),
  ]);
  const p = (profile ?? null) as LunaProfile | null;
  const memoryOn = p?.memory_enabled !== false;

  /* "yaad rakh ..." is saved here, with no model call spent on it. */
  let justSaved: string | null = null;
  if (memoryOn && t.live) {
    const forced = d.parseExplicitMemory(t.live);
    if (forced) {
      t.emit('remembering');
      try {
        await d.upsertMemoryRow(t.db, t.userId, forced.key, forced.value);
        await d.capMemories(t.db, t.userId, MEMORY_CAP);
        justSaved = forced.value;
      } catch (err) {
        console.error('[luna] save', err);
      }
    }
  }

  /* The window: newest back, until the budget is spent. */
  const keep = typeof total === 'number' ? WINDOW_MIN + (total % WINDOW_STEP) : WINDOW_MESSAGES + 6;
  const recent = ((rows ?? []).slice(0, keep) as { sender_id: string; body: string | null; created_at: string }[]).filter(
    (r) => typeof r.body === 'string' && r.body.trim() && !d.skipBodies.includes(r.body.trim()) && !/<<<\s*(REPLY|ASK)\s*>>>/i.test(r.body),
  );
  const oldestInView = recent.length ? recent[recent.length - 1]!.created_at : new Date().toISOString();

  const names = new Map<string, string>();
  if (t.isGroup) {
    const ids = [...new Set(recent.map((r) => r.sender_id).filter((id) => id !== d.botId))];
    if (ids.length) {
      const { data: people } = await t.db.from('profiles').select('id, display_name, username').in('id', ids);
      for (const person of (people ?? []) as { id: string; display_name?: string; username?: string }[]) {
        const n = (person.display_name ?? '').trim() || (person.username ?? '').trim();
        if (n) names.set(person.id, n);
      }
    }
  }

  let budget = WINDOW_CHARS;
  const picked: { role: 'user' | 'assistant'; content: string; speaker?: string }[] = [];
  for (const r of recent) {
    if (picked.length >= WINDOW_MESSAGES) break;
    const role = r.sender_id === d.botId ? 'assistant' : 'user';
    const speaker = role === 'user' ? (names.get(r.sender_id) ?? '') : '';
    const text = d.stripMarkers(r.body!.trim()).slice(0, MESSAGE_CHARS);
    const content = speaker ? `${speaker}: ${text}` : text;
    if (content.length > budget && picked.length) break;
    budget -= content.length;
    picked.push({ role, content, ...(speaker ? { speaker } : {}) });
  }
  picked.reverse();
  // The message being answered, if the window does not end on it yet.
  const last = picked[picked.length - 1];
  if (t.live && !(last && last.role === 'user' && last.content.endsWith(t.live.slice(0, MESSAGE_CHARS)))) {
    picked.push({ role: 'user', content: t.live.slice(0, MESSAGE_CHARS) });
  }
  const history = d.collapseHistory(picked);
  if (!history.length) return { status: 400, body: { error: 'Nothing to reply to.' } };

  /* Who this is and how they like it: the part that changes, after the part that does not. */
  const about: string[] = [];
  const callThem = p?.preferred_name?.trim() || p?.display_name?.trim();
  if (callThem) about.push(`The person's name: ${callThem}. Use it rarely, the way a friend would.`);
  const lang = d.languageLabel(p?.language);
  if (lang) about.push(`Their preferred language: ${lang}. Still mirror what they actually write.`);
  if (p?.country) about.push(`They are in ${p.country}.`);
  // The default voice is ChatGPT's own; only a personality somebody chose changes it.
  if (p?.personality && p.personality !== 'friendly') about.push(d.personalityBlock(p));
  const len = p?.response_length ?? 'short';
  about.push(
    len === 'detailed'
      ? 'They prefer thorough answers: go into detail, with structure, when the question deserves it.'
      : len === 'balanced'
        ? 'They prefer balanced answers, as ChatGPT gives by default.'
        : 'They prefer concise answers: complete, but no padding. Small talk gets a line or two.',
  );
  if (!memoryOn) about.push('Memory is switched off by them: do not save or recall anything, and say so if they ask you to remember.');
  /* What changes from turn to turn goes after the history, so it never breaks the cached opening. */
  const now: string[] = [`Today is ${new Date().toISOString().slice(0, 10)}.`];
  if (justSaved) now.push(`You just saved this to their memory, as they asked: "${justSaved}". Confirm briefly in your reply; do not call save_memory for it again.`);
  if (t.spoken) about.push('This reply will be SPOKEN aloud on a call: 1 to 3 natural sentences, no lists, no emojis, no markdown, no links.');
  if (t.isGroup) {
    about.push(
      [
        'You are in a GROUP chat and were mentioned. Each human line starts with the speaker\'s name ("Baani: ..."); that prefix is not part of what they said.',
        'Keep people apart: never give one person\'s words or details to another. If unsure who said something, say so.',
        'Answer the latest person who mentioned you. Do not start your reply with a name.',
      ].join('\n'),
    );
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: about.join('\n\n') },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: 'system', content: now.join('\n') },
  ];

  /* Streaming out: pieces to the screen in small batches, sentences to the voice. */
  let pending = '';
  let lastFlush = 0;
  let spokenBuffer = '';
  let wrote = false;
  const flush = (force = false) => {
    if (!pending) return;
    if (!force && pending.length < 24 && Date.now() - lastFlush < 60 && !/[\n.!?]/.test(pending)) return;
    t.emitDelta(pending);
    pending = '';
    lastFlush = Date.now();
  };
  let firstText = 0;
  const onText = (piece: string) => {
    if (!wrote) {
      wrote = true;
      firstText = Date.now();
      t.emit('writing');
    }
    pending += piece;
    flush();
    if (t.spoken) {
      spokenBuffer += piece;
      for (;;) {
        const m = /^([\s\S]*?[.!?।]+)(\s+)/.exec(spokenBuffer);
        if (!m) break;
        const sentence = m[1]!.trim();
        if (sentence) t.emitSentence(sentence);
        spokenBuffer = spokenBuffer.slice(m[0].length);
      }
    }
  };

  const length = p?.response_length ?? 'short';
  const maxTokens = t.spoken ? 700 : length === 'detailed' ? 3000 : length === 'balanced' ? 1600 : 1000;
  const tools = memoryOn ? TOOLS : TOOLS.filter((x) => x.function.name === 'search_chat');

  t.emit('thinking');
  const tModel = Date.now();
  let reply = '';
  let usage: Record<string, unknown> | undefined;
  let rounds = 0;
  try {
    for (;;) {
      const res = await streamChat({
        apiKey: t.apiKey,
        base: t.base,
        model: t.model,
        messages,
        tools,
        reasoningEffort: t.reasoningEffort,
        maxTokens,
        cacheKey: `pingo-ai-${t.userId}`,
        onText,
      });
      reply += res.text;
      if (res.usage) usage = res.usage as Record<string, unknown>;
      if (!res.toolCalls.length || rounds >= MAX_TOOL_ROUNDS) break;
      rounds++;
      t.emit('remembering');
      messages.push({ role: 'assistant', content: res.text || null, tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(call, t, d, memoryOn, oldestInView) });
      }
    }
  } catch (err) {
    console.error('[luna] model', err);
    flush(true);
    const sorry = reply.trim() || 'Something went wrong on my side. Say that again?';
    const { data: id } = await t.db.rpc('post_ai_reply', { target_conversation: t.conversationId, reply_body: sorry });
    return { status: 200, body: { messageId: id, error: 'model_failed' } };
  }
  flush(true);
  if (t.spoken && spokenBuffer.trim()) t.emitSentence(spokenBuffer.trim());
  const tModelDone = Date.now();

  const body = reply.trim() || (justSaved ? 'Done, yaad rakh liya.' : 'Hmm, I blanked for a second. Say that again?');
  const { data: messageId, error } = await t.db.rpc('post_ai_reply', { target_conversation: t.conversationId, reply_body: body.slice(0, 8000) });
  if (error) return { status: 500, body: { error: error.message } };

  /*
   * One line per turn in the function's logs (Supabase > Edge Functions >
   * ai-chat > Logs): which model answered, what it cost in tokens, how much of
   * the prompt was served from OpenAI's cache, and how long each part took.
   */
  const u = (usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  console.log(
    `[luna] provider=openai model=${t.model} effort=${t.reasoningEffort || 'default'} in=${u.prompt_tokens ?? '?'} cached=${u.prompt_tokens_details?.cached_tokens ?? 0} out=${u.completion_tokens ?? '?'} tools=${rounds} first_ms=${firstText ? firstText - tModel : '?'} model_ms=${tModelDone - tModel} total_ms=${Date.now() - t0}`,
  );

  return {
    status: 200,
    body: {
      provider: 'openai',
      messageId,
      reply: body,
      memorySaved: !!justSaved,
      model: t.model,
      toolRounds: rounds,
      ...(usage ? { usage } : {}),
      ms: { before: tModel - t0, firstWords: firstText ? firstText - tModel : null, model: tModelDone - tModel, total: Date.now() - t0 },
    },
  };
}

async function runTool(call: ToolCall, t: LunaTurn, d: LunaDeps, memoryOn: boolean, oldestInView: string): Promise<string> {
  let args: { text?: string; query?: string } = {};
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return 'Bad arguments.';
  }
  try {
    if (call.function.name === 'save_memory' && memoryOn) {
      const text = (args.text ?? '').trim().slice(0, 500);
      if (!text) return 'Nothing to save.';
      const key = `note_${text.toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s]/gi, ' ').trim().split(/\s+/).slice(0, 4).join('_').slice(0, 40) || 'note'}`;
      await d.upsertMemoryRow(t.db, t.userId, key, text);
      await d.capMemories(t.db, t.userId, MEMORY_CAP);
      return 'Saved.';
    }
    if (call.function.name === 'recall_memory' && memoryOn) {
      const { data } = await t.db.from('ai_memories').select('value, created_at').eq('user_id', t.userId).order('created_at', { ascending: false }).limit(MEMORY_CAP);
      const all = ((data ?? []) as { value: string; created_at: string }[]).map((m) => `- ${m.value} (saved ${m.created_at.slice(0, 10)})`);
      return all.length ? all.join('\n') : 'Nothing saved yet.';
    }
    if (call.function.name === 'search_chat') {
      const words = [...new Set((args.query ?? '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s]/gi, ' ').split(/\s+/).filter((w) => w.length >= 3))]
        .sort((a, b) => b.length - a.length)
        .slice(0, 3);
      if (!words.length) return 'Give a few key words to search for.';
      const { data } = await t.db
        .from('messages')
        .select('sender_id, body, created_at')
        .eq('conversation_id', t.conversationId)
        .is('encryption', null)
        .lt('created_at', oldestInView)
        .or(words.map((w) => `body.ilike.%${w}%`).join(','))
        .order('created_at', { ascending: false })
        .limit(8);
      const hits = ((data ?? []) as { sender_id: string; body: string; created_at: string }[]).map(
        (m) => `${m.created_at.slice(0, 10)} ${m.sender_id === d.botId ? 'You' : 'Them'}: ${d.stripMarkers(m.body).slice(0, 300)}`,
      );
      return hits.length ? hits.reverse().join('\n') : 'No older messages match.';
    }
  } catch (err) {
    console.error('[luna] tool', call.function.name, err);
    return 'That did not work right now.';
  }
  return 'Not available.';
}
