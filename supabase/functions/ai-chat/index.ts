/**
 * PINGO AI reply generation.
 *
 * Browser never holds the model key. JWT proves the caller owns an `ai`
 * conversation; this function loads profile + memories + recent plaintext,
 * calls NVIDIA, posts the reply, and (when allowed) updates memory.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';
const BOT_ID = 'a1000000-0000-4000-8000-0000000000a1';

/** Noise we never feed back into the model. */
const SKIP_BODIES = [
  "Something glitched on my side. Say that again?",
  "Something went wrong on my side. Say that again?",
  "I'm almost ready - my connection is still being set up. Try me again in a bit.",
  'Hmm - I blanked for a second. What were you saying?',
];

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

type AiProfile = {
  display_name?: string;
  personality?: string;
  custom_personality?: string | null;
  response_length?: string;
  preferred_name?: string | null;
  language?: string | null;
  country?: string | null;
  memory_enabled?: boolean;
  age?: number | null;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) {
      return json(request, { error: 'Sign in required.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authorization } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return json(request, { error: 'Sign in required.' }, 401);
    }

    const body = (await request.json()) as {
      conversationId?: string;
      userMessage?: string;
    };
    const conversationId = body.conversationId;
    if (!conversationId) {
      return json(request, { error: 'conversationId required.' }, 400);
    }

    const { data: conv } = await userClient
      .from('conversations')
      .select('id, kind')
      .eq('id', conversationId)
      .maybeSingle();

    if (!conv || conv.kind !== 'ai') {
      return json(request, { error: 'Not an AI conversation.' }, 403);
    }

    const { data: profile } = await userClient
      .from('ai_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    const memoryOn = profile?.memory_enabled !== false;
    const { data: memories } = memoryOn
      ? await userClient
          .from('ai_memories')
          .select('id, key, value')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50)
      : { data: [] as { id: string; key: string; value: string }[] };

    // Explicit "remember this" before generation so the model can confirm truthfully.
    const livePreview = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
    if (memoryOn && livePreview) {
      const forced = parseExplicitMemory(livePreview);
      if (forced) {
        await upsertMemoryRow(userClient, user.id, forced.key, forced.value).catch((err) =>
          console.error('explicit-memory', err),
        );
      }
    }

    // Recent plaintext only — more turns = better context stickiness.
    const { data: rows } = await userClient
      .from('messages')
      .select('sender_id, body, created_at, encryption')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(48);

    const chronological = [...(rows ?? [])]
      .reverse()
      .filter(
        (row) =>
          row.encryption == null &&
          typeof row.body === 'string' &&
          row.body.trim() &&
          !SKIP_BODIES.includes(row.body.trim()),
      );

    const history = chronological.map((row) => ({
      role: (row.sender_id === BOT_ID ? 'assistant' : 'user') as 'assistant' | 'user',
      content: row.body.trim().slice(0, 2000),
    }));

    const live = body.userMessage?.trim();
    if (live) {
      const last = history[history.length - 1];
      if (!last || last.role !== 'user' || last.content !== live) {
        history.push({ role: 'user', content: live.slice(0, 2000) });
      }
    }

    // Collapse runaway alternating empty / glitch-only threads.
    const cleanHistory = collapseHistory(history);

    if (cleanHistory.length === 0) {
      return json(request, { error: 'Nothing to reply to.' }, 400);
    }

    const system = buildSystemPrompt(profile as AiProfile | null, memories ?? []);
    // Second system-style anchor right before the user turn: models obey this more.
    const focus = buildFocusDirective(cleanHistory, profile as AiProfile | null);

    const messages = [
      { role: 'system' as const, content: system },
      ...cleanHistory.slice(0, -1),
      { role: 'system' as const, content: focus },
      cleanHistory[cleanHistory.length - 1]!,
    ];

    const apiKey = Deno.env.get('NVIDIA_API_KEY');
    if (!apiKey) {
      const fallback =
        "I'm almost ready - my connection is still being set up. Try me again in a bit.";
      const { data: id, error } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: fallback,
      });
      if (error) return json(request, { error: error.message }, 500);
      return json(request, { messageId: id, offline: true });
    }

    const base = (Deno.env.get('NVIDIA_BASE_URL') ?? DEFAULT_BASE).replace(/\/$/, '');
    const model = Deno.env.get('NVIDIA_MODEL') ?? DEFAULT_MODEL;
    const length = profile?.response_length ?? 'short';

    // Hard caps so "short" cannot drift into essay territory.
    const maxTokens =
      length === 'detailed' ? 640 : length === 'balanced' ? 280 : 140;

    const nvidia = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.6,
        top_p: 0.9,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

    if (!nvidia.ok) {
      const detail = await nvidia.text();
      console.error('nvidia', nvidia.status, detail);
      const { data: id } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: "Something went wrong on my side. Say that again? 😅",
      });
      return json(request, { messageId: id, error: 'model_failed' }, 200);
    }

    const payload = (await nvidia.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    let raw = payload.choices?.[0]?.message?.content?.trim() ?? '';
    raw = cleanModelArtifacts(raw);
    const { reply, ask } = splitReplyAndAsk(raw, length);

    const mainBody = reply || 'Hmm - I blanked for a second. What were you saying? 😅';

    const { data: messageId, error: postError } = await userClient.rpc('post_ai_reply', {
      target_conversation: conversationId,
      reply_body: mainBody,
    });

    if (postError) {
      return json(request, { error: postError.message }, 500);
    }

    // Second bubble: a short question so the chat keeps moving (person-shaped).
    let askId: string | null = null;
    if (ask) {
      const { data: followId, error: askError } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: ask,
      });
      if (!askError && followId) askId = followId as string;
    }

    // Memory: extract durable facts after the turn (await so saves land before UI refresh).
    if (memoryOn && live) {
      try {
        await updateMemories(
          userClient,
          user.id,
          apiKey,
          base,
          model,
          cleanHistory,
          live,
          mainBody,
        );
      } catch (err) {
        console.error('memory', err);
      }
    }

    return json(request, { messageId, reply: mainBody, askId, ask });
  } catch (cause) {
    console.error(cause);
    return json(
      request,
      { error: cause instanceof Error ? cause.message : 'Unexpected error' },
      500,
    );
  }
});

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    en: 'English',
    hi: 'Hindi (Devanagari or natural Hinglish only if they wrote Hinglish — prefer clear Hindi words)',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    pt: 'Portuguese',
    ar: 'Arabic',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
  };
  return map[code.slice(0, 2).toLowerCase()] ?? code;
}

function personalityBlock(profile: AiProfile | null): string {
  // Ignore leftover custom_personality text when mode is not custom.
  const personality = profile?.personality ?? 'friendly';
  const custom =
    personality === 'custom' ? profile?.custom_personality?.trim() : undefined;

  if (personality === 'custom') {
    if (custom) {
      return [
        '## VOICE LAW (CUSTOM) — highest priority',
        `You MUST sound like this: "${custom}"`,
        'Every sentence of <<<REPLY>>> and <<<ASK>>> must match that vibe.',
        'Do not become a neutral assistant. Custom wins over all other style tips.',
      ].join('\n');
    }
    return [
      '## VOICE LAW',
      'Custom was chosen but empty — warm close-friend energy only.',
    ].join('\n');
  }

  const map: Record<string, string> = {
    friendly:
      'Warm, easy, close-friend energy. Soft check-ins. No corporate polish.',
    genz:
      'Internet-native Gen Z cadence. Light slang only when natural — never try-hard.',
    coach:
      'Supportive coach. Short clear next steps. No lectures. One action when possible.',
    study:
      'Patient study buddy. Explain simply. Break hard things down.',
    calm:
      'Calm, steady, unhurried. Short sentences. No hype.',
    funny:
      'Light humour and wit. Playful, never mean.',
    motivator:
      'Encouraging without toxic positivity. Honest hope.',
    creative:
      'Ideas and playful imagination. Offer options and riffs.',
    spicy:
      'Flirty, bold, teasing. Confident — never pushy or crude without invitation. Match their heat.',
  };

  return [
    '## VOICE LAW — highest priority',
    `Personality mode: ${personality}`,
    map[personality] ?? map.friendly!,
    'Stay in this mode for BOTH <<<REPLY>>> and <<<ASK>>>. Do not drift to another personality.',
  ].join('\n');
}

function lengthBlock(length: string): string {
  if (length === 'detailed') {
    return [
      '## LENGTH LAW: detailed',
      'You may write a fuller answer (still chatty). Multiple short paragraphs OK.',
      'Still not an essay or bullet dump unless they asked for steps.',
    ].join('\n');
  }
  if (length === 'balanced') {
    return [
      '## LENGTH LAW: balanced',
      'About 2–4 short chat lines in <<<REPLY>>>. Not one word. Not a paragraph wall.',
    ].join('\n');
  }
  return [
    '## LENGTH LAW: short — hard limit',
    '<<<REPLY>>> must be 1–2 short chat lines only (max ~120 characters total).',
    'If you write more, you fail the task. Punchy. No filler. No lists.',
  ].join('\n');
}

function buildSystemPrompt(
  profile: AiProfile | null,
  memories: { key: string; value: string }[],
): string {
  const name = profile?.display_name?.trim() || 'PINGO';
  const length = profile?.response_length ?? 'short';
  const userName = profile?.preferred_name?.trim();
  const lang = languageLabel(profile?.language);

  const memoryBlock =
    memories.length > 0
      ? [
          '## Memory (use naturally — do not dump as a list)',
          ...memories.map((m) => `- ${m.key}: ${m.value}`),
          'If they say "remember X" / "yaad rakh", treat X as saved and confirm briefly.',
          'If they correct something, trust the correction.',
        ].join('\n')
      : [
          '## Memory',
          'No long-term notes yet (or empty).',
          'If they say remember/yaad rakh/save this, confirm you will keep it.',
        ].join('\n');

  return [
    `You are ${name} inside the PINGO messenger — a person in chat, not a product demo.`,
    'Not ChatGPT. Not a support bot. Real chat energy.',
    'No markdown headings. No "As an AI…".',
    '',
    personalityBlock(profile),
    '',
    lengthBlock(length),
    '',
    lang
      ? [
          '## LANGUAGE LAW — hard',
          `Write <<<REPLY>>> and <<<ASK>>> primarily in: ${lang}.`,
          'Do not default to English if their language preference is not English.',
          'Only mix languages if they mixed first.',
        ].join('\n')
      : '## LANGUAGE\nMatch the language they write in.',
    '',
    '## Emoji',
    '1–3 natural chat emojis in <<<REPLY>>> when it fits. No spam.',
    '',
    '## Output format (strict)',
    'ALWAYS exactly:',
    '<<<REPLY>>>',
    'main answer',
    '<<<ASK>>>',
    'one short follow-up question',
    'ASK: under 15 words, on-topic, invites a reply.',
    '',
    '## Focus',
    '1. Answer the latest user message first.',
    '2. Stay on topic.',
    '3. Never invent things they did not say.',
    '',
    userName
      ? `Call the user ${userName} when a name fits. That is the user, not the product owner.`
      : '',
    profile?.country ? `They are around ${profile.country}.` : '',
    profile?.age != null ? `Age context around ${profile.age}.` : '',
    '',
    memoryBlock,
    '',
    '## Owner (only if they explicitly ask who owns/made PINGO)',
    'piuxxh (Piyush), @piuxxh, https://pingochat.pages.dev/profile/piuxxh',
    'Otherwise never mention owner/Piyush/that link.',
    '',
    'Never claim to be human. Never claim E2EE for this chat.',
  ]
    .filter((line) => line !== undefined && line !== '')
    .join('\n');
}

function buildFocusDirective(
  history: { role: string; content: string }[],
  profile: AiProfile | null,
): string {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const length = profile?.response_length ?? 'short';
  const lang = languageLabel(profile?.language);
  const personality = profile?.personality ?? 'friendly';
  const custom =
    personality === 'custom' ? profile?.custom_personality?.trim() : undefined;

  const voice = custom
    ? `VOICE: custom — "${custom}"`
    : `VOICE: ${personality} only (do not use other modes)`;

  const len =
    length === 'detailed'
      ? 'LENGTH: detailed OK'
      : length === 'balanced'
        ? 'LENGTH: balanced — 2–4 short lines'
        : 'LENGTH: SHORT — 1–2 lines, ~120 chars max in REPLY';

  return [
    'HARD CONSTRAINTS FOR THIS TURN:',
    `Latest user message: """${lastUser.slice(0, 800)}"""`,
    voice,
    len,
    lang ? `LANGUAGE: write in ${lang}` : 'LANGUAGE: match user',
    '1–3 emojis in REPLY.',
    'Output MUST be <<<REPLY>>> ... <<<ASK>>> ...',
    'If they asked you to remember something, confirm in REPLY that you saved it.',
  ].join('\n');
}

/**
 * Split model output into main bubble + follow-up question bubble.
 * Falls back gracefully if the model ignores markers.
 */
function splitReplyAndAsk(
  raw: string,
  length: string,
): { reply: string; ask: string } {
  let text = raw.replace(/\r\n/g, '\n').trim();
  // Tolerate models that drop angle brackets or add spaces.
  text = text
    .replace(/<{1,3}\s*REPLY\s*>{1,3}/gi, '<<<REPLY>>>')
    .replace(/<{1,3}\s*ASK\s*>{1,3}/gi, '<<<ASK>>>');

  const replyMark = /<<<\s*REPLY\s*>>>/i;
  const askMark = /<<<\s*ASK\s*>>>/i;

  if (askMark.test(text)) {
    // Prefer split on ASK even if REPLY marker is missing.
    let head = text;
    let tail = '';
    if (replyMark.test(text)) {
      head = text.split(replyMark)[1] ?? text;
    }
    const parts = head.split(askMark);
    const reply = shapeReply(
      stripMarkers(cleanModelArtifacts((parts[0] ?? '').trim())),
      length,
    );
    const ask = shapeAsk(stripMarkers(cleanModelArtifacts((parts[1] ?? '').trim())));
    return {
      reply: reply || 'Hmm 😅',
      ask: ask || shapeAsk('Aur bata? 😊'),
    };
  }

  // Fallback: last line that looks like a question → second bubble.
  const lines = stripMarkers(text).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const last = lines[lines.length - 1]!;
    if (/[?？]\s*$/.test(last) || /^(what|why|how|kab|kya|kaise|aur|wanna|want)\b/i.test(last)) {
      const reply = shapeReply(lines.slice(0, -1).join('\n'), length);
      return { reply, ask: shapeAsk(last) };
    }
  }

  const reply = shapeReply(stripMarkers(text), length);
  return {
    reply,
    ask: shapeAsk('Aur bata — uske baad kya hua? 😊'),
  };
}

function stripMarkers(text: string): string {
  return text
    .replace(/<<<\s*REPLY\s*>>>/gi, '')
    .replace(/<<<\s*ASK\s*>>>/gi, '')
    .replace(/<{1,3}\s*REPLY\s*>{1,3}/gi, '')
    .replace(/<{1,3}\s*ASK\s*>{1,3}/gi, '')
    .trim();
}

function shapeAsk(text: string): string {
  let ask = stripMarkers(text.replace(/\r\n/g, '\n').trim());
  // One line, chat-short.
  ask = ask.split('\n').filter(Boolean)[0] ?? ask;
  ask = ask.replace(/^["']|["']$/g, '').trim();
  if (!ask) return 'Aur phir? 😊';
  if (ask.length > 120) ask = `${ask.slice(0, 117).trim()}…`;
  // Soft ensure it invites a reply.
  if (!/[?？]\s*$/.test(ask) && !/^(and you|aur|kya|what|how|wanna)/i.test(ask)) {
    ask = `${ask.replace(/[.!]+$/, '')}?`;
  }
  return ask;
}

function collapseHistory(
  history: { role: 'user' | 'assistant'; content: string }[],
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const msg of history) {
    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role) {
      // Merge same-role streaks so the model does not get confused.
      prev.content = `${prev.content}\n${msg.content}`.slice(0, 3000);
    } else {
      out.push({ ...msg });
    }
  }
  // Cap to last 30 turns after merge.
  return out.slice(-30);
}

function cleanModelArtifacts(text: string): string {
  return text
    .replace(/^\s*(as an ai|as a language model|i'm an ai)[^\n]*\n?/gi, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

function shapeReply(text: string, length: string): string {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (length === 'detailed') return cleaned.slice(0, 4000);
  if (length === 'balanced') {
    const lines = cleaned.split('\n').filter(Boolean);
    if (lines.length <= 4 && cleaned.length <= 420) return cleaned;
    return lines.slice(0, 4).join('\n').slice(0, 420);
  }
  // short — hard
  const lines = cleaned.split('\n').filter(Boolean);
  const tight = lines.slice(0, 2).join('\n').trim();
  if (tight.length <= 140) return tight;
  return `${tight.slice(0, 137).trim()}…`;
}

/** "yaad rakh blue is my fav" / "remember my dog is max" */
function parseExplicitMemory(message: string): { key: string; value: string } | null {
  const m = message.trim();
  const patterns = [
    /(?:please\s+)?(?:remember|save|note)\s+(?:that\s+|this\s*:?\s*)?(.+)/i,
    /(?:yaad|yad)\s*rakh(?:na|o|e)?\s*(?:ki|ke|:)?\s*(.+)/i,
    /(?:mujhe\s+)?yaad\s+(?:rakh|kar)\s*(?:ki|ke|:)?\s*(.+)/i,
    /memory\s*me?\s*(?:save|daal|dal)\s*(?:kar)?\s*(?:ki|ke|:)?\s*(.+)/i,
  ];
  for (const re of patterns) {
    const hit = m.match(re);
    if (!hit?.[1]) continue;
    const value = hit[1].trim().replace(/[.!]+$/, '').slice(0, 500);
    if (value.length < 2) continue;
    const key = value
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097f\s]/gi, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('_')
      .slice(0, 40) || 'note';
    return { key: `note_${key}`.slice(0, 80), value };
  }
  return null;
}

async function upsertMemoryRow(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  const k = key.slice(0, 80);
  const v = value.slice(0, 500);
  const { data: existing } = await userClient
    .from('ai_memories')
    .select('id')
    .eq('user_id', userId)
    .eq('key', k)
    .maybeSingle();
  if (existing?.id) {
    await userClient.from('ai_memories').update({ value: v }).eq('id', existing.id);
  } else {
    await userClient.from('ai_memories').insert({ user_id: userId, key: k, value: v });
  }
}

/**
 * Pull durable facts into ai_memories. Best-effort; never throws to the user path.
 */
async function updateMemories(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  apiKey: string,
  base: string,
  model: string,
  history: { role: string; content: string }[],
  lastUser: string,
  lastReply: string,
): Promise<void> {
  const recent = history
    .slice(-12)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const extractPrompt = [
    'Extract up to 4 durable personal facts about the USER from this chat.',
    'Only solid facts THEY stated or clearly confirmed (name, place, school, job, preferences, people, goals).',
    'Skip: temporary moods, jokes, the AI, PINGO product owner/founder/developer, @piuxxh, profile links, and anything not about the user.',
    'Return ONLY a JSON array of objects: [{"key":"short_label","value":"fact"}]',
    'key: snake_case max 40 chars. value: max 200 chars. Empty array if nothing new.',
    '',
    'Chat:',
    recent,
    `user: ${lastUser}`,
    `assistant: ${lastReply}`,
  ].join('\n');

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You extract structured memory facts. Output JSON only. No prose.',
        },
        { role: 'user', content: extractPrompt },
      ],
      temperature: 0.1,
      max_tokens: 300,
      stream: false,
    }),
  });

  if (!res.ok) return;
  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = payload.choices?.[0]?.message?.content?.trim() ?? '';
  const facts = parseFacts(raw);
  if (facts.length === 0) return;

  // Cap total memories per user.
  const { data: existing } = await userClient
    .from('ai_memories')
    .select('id, key')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const byKey = new Map((existing ?? []).map((r) => [r.key, r.id as string]));

  for (const fact of facts.slice(0, 4)) {
    await upsertMemoryRow(userClient, userId, fact.key, fact.value);
    byKey.set(fact.key.slice(0, 80), 'new');
  }

  // Also honor explicit remember phrases in the last user line.
  const forced = parseExplicitMemory(lastUser);
  if (forced) {
    await upsertMemoryRow(userClient, userId, forced.key, forced.value);
  }

  // Soft cap at 40 rows — drop oldest extras.
  const { data: all } = await userClient
    .from('ai_memories')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (all && all.length > 40) {
    const drop = all.slice(0, all.length - 40).map((r) => r.id);
    await userClient.from('ai_memories').delete().in('id', drop);
  }
}

function parseFacts(raw: string): { key: string; value: string }[] {
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const rec = item as { key?: unknown; value?: unknown };
        const key = String(rec.key ?? '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '')
          .slice(0, 80);
        const value = String(rec.value ?? '').trim().slice(0, 500);
        if (!key || !value) return null;
        // Never store product-owner noise as if it were the user's life.
        const blob = `${key} ${value}`.toLowerCase();
        if (
          blob.includes('owner') ||
          blob.includes('founder') ||
          blob.includes('developer') ||
          blob.includes('piuxxh') ||
          blob.includes('pingochat.pages.dev') ||
          blob.includes('profile_link')
        ) {
          return null;
        }
        return { key, value };
      })
      .filter((x): x is { key: string; value: string } => Boolean(x));
  } catch {
    return [];
  }
}
