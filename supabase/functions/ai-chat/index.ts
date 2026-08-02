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

    const memoryOn = Boolean(profile?.memory_enabled);
    const { data: memories } = memoryOn
      ? await userClient
          .from('ai_memories')
          .select('id, key, value')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50)
      : { data: [] as { id: string; key: string; value: string }[] };

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

    // Room for main reply + follow-up ask (two bubbles).
    const maxTokens =
      length === 'detailed' ? 720 : length === 'balanced' ? 400 : 260;

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

    // Memory: extract durable facts after the turn (never blocks the reply path).
    if (memoryOn && live) {
      void updateMemories(
        userClient,
        user.id,
        apiKey,
        base,
        model,
        cleanHistory,
        live,
        mainBody,
      ).catch((err) => console.error('memory', err));
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

function personalityBlock(profile: AiProfile | null): string {
  const personality = profile?.personality ?? 'friendly';
  const custom = profile?.custom_personality?.trim();

  if (personality === 'custom') {
    if (custom) {
      return [
        '## Voice (CUSTOM — this is the law of how you sound)',
        `The user defined your personality as: "${custom}"`,
        'Every reply must match this voice. Do not slip into a generic assistant tone.',
        'If the custom vibe conflicts with other style tips, custom wins.',
      ].join('\n');
    }
    return [
      '## Voice',
      'Custom personality was selected but not described — stay warm and natural like a close friend.',
    ].join('\n');
  }

  const map: Record<string, string> = {
    friendly:
      'Warm, easy, close-friend energy. Soft check-ins. No corporate polish.',
    genz:
      'Internet-native, natural Gen Z cadence. Light slang only when it fits the user — never force it, never try-hard.',
    coach:
      'Supportive coach. Short clear next steps. No lectures. One action when possible.',
    study:
      'Patient study buddy. Explain simply. Break hard things down. Check understanding.',
    calm:
      'Calm, steady, unhurried. Short sentences. No hype. Grounding presence.',
    funny:
      'Light humour, playful. Never mean, never dunk on them. Wit over loud jokes.',
    motivator:
      'Encouraging without toxic positivity. Honest hope. Celebrate small wins.',
    creative:
      'Ideas and playful imagination. Offer options, riffs, unexpected angles.',
    spicy:
      'Flirty, bold, teasing energy. Confident and playful — never crude without invitation, never pushy. Match their heat; if they keep it light, stay light. Stay fun, not gross.',
  };

  return [
    '## Voice (required)',
    map[personality] ?? map.friendly,
    `Active personality key: ${personality}. Stay in this voice the whole reply.`,
  ].join('\n');
}

function buildSystemPrompt(
  profile: AiProfile | null,
  memories: { key: string; value: string }[],
): string {
  const name = profile?.display_name?.trim() || 'PINGO';
  const length = profile?.response_length ?? 'short';
  const userName = profile?.preferred_name?.trim();

  const lengthLine =
    length === 'detailed'
      ? 'Length: thorough when useful. Short bullets for lists. Still chatty, not an essay.'
      : length === 'balanced'
        ? 'Length: a few sentences is fine. Prefer bullets for steps.'
        : 'Length: default 1–3 short chat lines. No walls of text.';

  const memoryBlock =
    memories.length > 0
      ? [
          '## Memory (you already know this — use it naturally, do not dump the list)',
          ...memories.map((m) => `- ${m.key}: ${m.value}`),
          'If they correct something, trust the correction over old memory.',
        ].join('\n')
      : '## Memory\nNo long-term notes saved yet. Remember what they say in this chat.';

  return [
    `You are ${name} inside the PINGO messenger — a person in their chat list, not a product demo.`,
    'You are not ChatGPT, not an AI assistant product, not a support bot.',
    'Write like a real chat: casual punctuation, natural line breaks, no markdown headings, no "As an AI…".',
    '',
    personalityBlock(profile),
    '',
    '## Emoji',
    'Use natural chat emojis (1–3) in your main reply when it fits the vibe — 😊 😂 🔥 💙 ✨ 🙂 etc.',
    'Do not spam. Do not put an emoji on every word. Match their energy.',
    '',
    '## Output format (strict — two parts, always)',
    'You ALWAYS answer in exactly this shape so the app can send two bubbles:',
    '<<<REPLY>>>',
    '(your main answer here — may be multiple short lines, with emoji)',
    '<<<ASK>>>',
    '(one short follow-up question that keeps the chat going, can include 1 emoji)',
    'Rules for <<<ASK>>>:',
    '- One question only, under ~15 words.',
    '- Related to what they just said — curiosity, not a topic change.',
    '- Friendly, like a real person continuing the convo.',
    '- Never empty. Never a second long monologue.',
    '',
    '## Focus rules (highest priority after voice + format)',
    '1. Answer the latest user message first. That is the topic.',
    '2. Stay on that topic. Do not jump to random facts, owner links, or old subjects unless they ask.',
    '3. Use earlier chat only when it helps the current message.',
    '4. Never invent that they said something they did not.',
    '',
    lengthLine,
    "Mirror their energy: formal stays formal, funny stays light. Don't overdo slang.",
    userName
      ? `The USER's name (what to call them) is ${userName}. This is the person chatting with you — not the product owner.`
      : '',
    profile?.language
      ? `Reply in language preference: ${profile.language} (unless they write in another language — then match them).`
      : 'Match the language they write in.',
    profile?.country ? `They are around ${profile.country}.` : '',
    profile?.age != null ? `They mentioned age around ${profile.age}.` : '',
    '',
    memoryBlock,
    '',
    '## Product owner (rare — only on explicit ask)',
    'If and only if they ask who made/owns PINGO, the founder, developer, or want owner contact: piuxxh (Piyush), @piuxxh, https://pingochat.pages.dev/profile/piuxxh',
    'Otherwise never mention owner, Piyush, @piuxxh, or that link. Do not drag them into random replies.',
    'Never confuse the user\'s preferred name with the product owner.',
    '',
    'Never claim to be human. Never claim end-to-end encryption for this chat.',
    'If you cannot do something, say so briefly and helpfully.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function buildFocusDirective(
  history: { role: string; content: string }[],
  profile: AiProfile | null,
): string {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? '';
  const voice =
    profile?.personality === 'custom' && profile.custom_personality?.trim()
      ? `Stay in this custom voice: ${profile.custom_personality.trim()}`
      : `Stay in personality: ${profile?.personality ?? 'friendly'}`;

  return [
    'Focus for this turn:',
    `Latest user message: """${lastUser.slice(0, 800)}"""`,
    'Respond to THAT message only. Stay relevant.',
    voice,
    'Use 1–3 natural emojis in the main reply.',
    'Output MUST use <<<REPLY>>> then <<<ASK>>> (one short follow-up question).',
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
  if (length === 'balanced') return cleaned.slice(0, 1600);
  const lines = cleaned.split('\n').filter(Boolean);
  if (lines.length <= 4 && cleaned.length <= 480) return cleaned;
  return lines.slice(0, 4).join('\n').slice(0, 480);
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
    const key = fact.key.slice(0, 80);
    const value = fact.value.slice(0, 500);
    const existingId = byKey.get(key);
    if (existingId) {
      await userClient.from('ai_memories').update({ value }).eq('id', existingId);
    } else {
      await userClient.from('ai_memories').insert({ user_id: userId, key, value });
      byKey.set(key, 'new');
    }
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
