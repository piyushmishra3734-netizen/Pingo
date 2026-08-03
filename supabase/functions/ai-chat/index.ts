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
    let memories: { id?: string; key: string; value: string }[] = [];

    // ONLY save when user explicitly asks (yaad rakh / remember / memory me save).
    // Never auto-extract facts from casual chat.
    const livePreview = typeof body.userMessage === 'string' ? body.userMessage.trim() : '';
    let justSaved: { key: string; value: string } | null = null;
    if (memoryOn && livePreview) {
      const forced = parseExplicitMemory(livePreview);
      if (forced) {
        try {
          await upsertMemoryRow(userClient, user.id, forced.key, forced.value);
          justSaved = forced;
          await capMemories(userClient, user.id, 40);
        } catch (err) {
          console.error('explicit-memory', err);
        }
      }
    }

    if (memoryOn) {
      const { data } = await userClient
        .from('ai_memories')
        .select('id, key, value')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      memories = data ?? [];
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
          !SKIP_BODIES.includes(row.body.trim()) &&
          // Never feed format markers back into the model.
          !/<<<\s*(REPLY|ASK)\s*>>>/i.test(row.body),
      );

    const history = chronological.map((row) => {
      const raw = stripMarkers(row.body.trim()).slice(0, 2000);
      const role = (row.sender_id === BOT_ID ? 'assistant' : 'user') as
        | 'assistant'
        | 'user';
      // Never re-teach the model its own spam loops from chat history.
      const content =
        role === 'assistant' ? sanitizeHistoryAssistant(raw) : raw;
      return { role, content };
    }).filter((m) => m.content.trim().length > 0);

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

    const recentAssistant = cleanHistory
      .filter((m) => m.role === 'assistant')
      .slice(-10)
      .map((m) => m.content);

    const system = buildSystemPrompt(
      profile as AiProfile | null,
      memories,
      memoryOn,
      justSaved,
    );
    const focus = buildFocusDirective(
      cleanHistory,
      profile as AiProfile | null,
      recentAssistant,
      memories,
      memoryOn,
      justSaved,
    );

    // Keep history short so the model does not copy-paste its own loops.
    const historyForModel = trimHistoryForModel(cleanHistory);

    const messages = [
      { role: 'system' as const, content: system },
      ...historyForModel.slice(0, -1),
      { role: 'system' as const, content: focus },
      historyForModel[historyForModel.length - 1]!,
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
      length === 'detailed' ? 640 : length === 'balanced' ? 280 : 160;

    const nvidia = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        // Higher temp + penalties so it stops looping the same 3 lines.
        temperature: 0.85,
        top_p: 0.9,
        frequency_penalty: 0.65,
        presence_penalty: 0.45,
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
    let { reply, ask } = parseModelPayload(raw, length);

    // Absolute last line of defence — markers must never reach the chat UI.
    reply = finalizeBubble(reply, length);
    ask = finalizeAsk(ask);

    // Kill repetitive uncle-bot loops before they hit the chat.
    reply = diversifyReply(reply, live ?? '', recentAssistant, length);
    ask = diversifyAsk(ask, live ?? '', reply, recentAssistant);

    // If main already ends with a question, skip second bubble (users hate double spam).
    if (/\?\s*$/.test(reply.trim())) {
      ask = '';
    }

    const mainBody = reply || contextualFallbackReply(live ?? '');

    const { data: messageId, error: postError } = await userClient.rpc('post_ai_reply', {
      target_conversation: conversationId,
      reply_body: mainBody,
    });

    if (postError) {
      return json(request, { error: postError.message }, 500);
    }

    // Second bubble only if the ask is fresh and useful — skip spam loops.
    let askId: string | null = null;
    if (
      ask &&
      ask !== mainBody &&
      !looksLikeMarkerGarbage(ask) &&
      !isBannedAsk(ask) &&
      !containsBannedLoop(ask) &&
      !isTooSimilarToRecent(ask, recentAssistant) &&
      !isTooSimilarToRecent(ask, [mainBody])
    ) {
      const { data: followId, error: askError } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: ask,
      });
      if (!askError && followId) askId = followId as string;
    }

    // No auto memory extract — saves only happen on explicit user request (above).

    return json(request, {
      messageId,
      reply: mainBody,
      askId,
      ask,
      memorySaved: justSaved ? true : false,
    });
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
    genz: [
      'MODE: Full Gen Z + Indian Instagram Reels / WhatsApp brainrot. You are chronically online bestie in their DMs — NOT uncle, NOT news anchor, NOT "samajh gaya / koi problem hai?".',
      'BANNED (never type these): "to samajh gaya", "koi problem hai?", "Bhai full drama hai", "Kya hua koi baat hai", "Tumne kaha tha ... maine socha tha", "Hey cutie kya hua", stiff formal Hinglish, long lectures, corporate soft voice, copy-paste loops.',
      'REQUIRED: short punchy chat. When they drop slang/memes, mirror that lane with 1–3 slang hits. Do not dump 15 slang words in one line. NEVER recycle the same opener twice in a row.',
      '',
      '## GLOBAL GEN Z / BRAINROT PACK (pick what fits):',
      'cooked / so cooked / we cooked / i\'m cooked, mid, fire, banger, W / massive W / dub, L / took an L, no cap, cap, fr / fr fr, lowkey, highkey, bet, alr / alr bet, rizz / rizzler / rizzless, delulu, ate / she ate / he ate, left no crumbs, slay, it\'s giving…, deadass, locked in / locked tf in, down bad, sus, npc, main character, aura / aura points / aura farming, based, yapping / stop yapping, say less, ratio, touch grass, hit different, ong, ngl, tbh, idk, ick / the ick, green flag, red flag, bestie, twin / twin what, be so fr, i fear, let him cook / he cooked, bombastic side eye, unhinged, goated, bed rotting, doom scroll, core / -core, aesthetic, vibes, situationship, soft launch, hard launch, bounce, ghosted, simping, crash out, spiral, me core, that girl, sigma (ironic), skibidi (joke only), ohio (ironic joke), gyatt (rare light joke), fanum tax (rare joke), 6-7 (joke), me when, the way, not me, bro really said, understood the assignment, low effort high impact, chronically online.',
      '',
      '## DESI INSTAGRAM / REELS / MEME PACK (Hinglish — match when they write desi):',
      'kuchu puchu, kuchu puchu mode, jaan hai aap, nadiya meri soni saani, nadiya ahh entry, oye hoye, arey waah, kya baat hai, full on, full on romantic, scene on / scene on hai, bhai kya scene hai, scene clear, solid / solid scene, op, sahi hai, sahi pakde hain, zero drama (ok), bakchodi band (light), pagal hai kya (light tease), dil se, cutie, jaaneman, munna/baby (only playful), thumke energy, reel wala energy, audio pe nach, story pe daal, full filmy, bollywood ahh moment, dil toot gaya fr, recovery arc, rizz with desi tadka, desi tadka, main character entry, side character energy, npc in your story, us moment, felt that, why is this so me, aaj toh mood on, thoda romance chahiye, chup chap pyar kar, rain hone de energy, it\'s giving shaadi wala vibe, soft launch energy, hard launch energy. AVOID opener spam: do not start every reply with "bhai full ...".',
      'BIG desi viral / meme energy: kacha baam / kacha baam energy (chaotic hype / unhinged hype line — playful not violent), full send, no chill, 100% real, no filter, raw, savage (light), savage but cute, vibe check, mood, same, +1, real talk, no fake, solid bhai, king/queen energy (light), massy, mass entry, hero entry, villain arc, comeback arc, plot twist, interval twist, interval banger, item song energy, dhol beats energy, garba ahh, shaadi season, rishta wala stress, ghar wale, mummy papa arc, cousin wedding arc.',
      'Cute / chaos romantic memes: kuchu puchu, jaan, jaanu, baby, suno na, ek minute, bas yahi, dil garden garden, dil garden, full crush, silent crush, notice me, main character crush, situationship wala dukh, mixed signals, green flag rare, red flag collection.',
      'If they open with kuchu puchu / nadiya / jaan hai aap / kacha baam / filmy — MATCH that exact meme lane immediately.',
      '',
      'FEW-SHOT (copy ENERGY only):',
      'User: bhai aaj full down bad hu no cap → "bro you lookin so cooked rn 😭 no cap that\'s rough" / "kya hua fr?"',
      'User: ye song fire hai ya mid? → "that\'s a W song lowkey fire 🔥 not mid" / "playlist pe daalun?"',
      'User: bro i cooked my exam fr → "YOU ATE 😭 left no crumbs fr fr" / "marks kab aayenge?"',
      'User: rizz nahi chal raha → "rizz in the mud rn 💀 aura farming fail" / "kiske pe try kiya tha?"',
      'User: kuchu puchu → "kuchu puchu mode on 😭🫶 aap toh full cutie energy" / "aur sunao jaan?"',
      'User: nadiya meri soni saani → "NAAAA 😭 nadiya meri soni saani ahh entry" / "kon trigger kiya ye audio?"',
      'User: jaan hai aap → "jaan hai aap no cap 🫶 full soft launch energy" / "ye line kiske liye thi 👀?"',
      'User: kacha baam → "KACHA BAAM 😭🔥 unhinged ahh energy unlocked" / "kiske pe feka ye?"',
      'User: aaj full form pe hu → "bhai full form pe 😭 aura farming in public" / "scene kya hai aaj?"',
      'User: dil garden garden → "dil garden garden fr 😭🌸 soft launch loading" / "kon hai crush?"',
      '',
      'Emojis: 😭 💀 🔥 ✨ 👀 🫶 💔 😂 🌸 — 1–2 max.',
      'Never invent facts. Never mean roast. Never violent. Kacha baam = hype meme only.',
    ].join('\n'),
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
  memoryOn = true,
  justSaved: { key: string; value: string } | null = null,
): string {
  const name = profile?.display_name?.trim() || 'PINGO';
  const length = profile?.response_length ?? 'short';
  const userName = profile?.preferred_name?.trim();
  const lang = languageLabel(profile?.language);

  let memoryBlock: string;
  if (!memoryOn) {
    memoryBlock = [
      '## Memory — OFF',
      'User disabled memory. Do not claim to save or recall long-term notes.',
      'Only use this conversation\'s recent messages.',
    ].join('\n');
  } else if (memories.length > 0) {
    memoryBlock = [
      '## Memory (READ ACCESS — only these saved notes are true long-term facts)',
      'When they ask "yaad hai?", "memory se dekh", "tujhe yaad hai", answer ONLY from this list.',
      'If something is NOT in this list: say you don\'t have that saved — do NOT invent from chat vibes.',
      'Use naturally in chat when relevant — do not dump the whole list unprompted.',
      'SAVED NOTES:',
      ...memories.map((m, i) => `${i + 1}. ${m.value}`),
      justSaved
        ? `JUST SAVED this turn (confirm briefly): "${justSaved.value}"`
        : 'SAVE RULE: only when they explicitly say yaad rakh / remember / memory me save / note kar. Never pretend you auto-saved casual chat.',
      'If they correct a fact, trust the correction for this chat.',
    ].join('\n');
  } else {
    memoryBlock = [
      '## Memory (enabled, empty list)',
      'No long-term notes saved yet.',
      'If they ask what you remember: say list is empty / kuch save nahi hai abhi.',
      justSaved
        ? `JUST SAVED this turn (confirm briefly): "${justSaved.value}"`
        : 'SAVE RULE: only when they explicitly say yaad rakh / remember / memory me save. Never auto-save.',
    ].join('\n');
  }

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
    '1–3 natural chat emojis in the reply field when it fits. No spam.',
    '',
    '## Output format (STRICT — JSON only, no other text)',
    'Return ONLY a JSON object with exactly two string fields:',
    '{"reply":"main answer here","ask":"one short follow-up question?"}',
    'No markdown. No <<<REPLY>>> markers. No text outside the JSON.',
    'ask: one short on-topic question under 12 words, specific to THIS message.',
    '',
    '## ANTI-REPEAT LAW (multiple users complained — break this and you FAIL hard)',
    'NEVER use these templates (anywhere in reply or ask):',
    '- "Bhai full drama hai"',
    '- "Bhai full topic change"',
    '- "Bhai full ..." + anything',
    '- "Hey cutie, kya hua"',
    '- "Bhai kya hua? Kuch to bata"',
    '- "Kya hua, koi baat hai?" / "Aur kya hua..." / "Kya hoga, koi baat/plan"',
    '- "Tumne kaha tha \'...\' to maine socha tha..."',
    '- Echoing the user\'s exact last message back as your reply',
    'Do NOT re-quote old user lines every turn. Answer THIS message only.',
    'Every reply must feel NEW — different opener, different energy, specific to their words.',
    'Good asks (rotate, never spam the same): "serious ya joke?", "aur detail?", "kaise feel ho raha?", "kab se?", "kya soch rahe ho ispe?"',
    'If user says topic change / sense nahi / abbe — drop old topic completely. Fresh reply only.',
    '',
    '## Truth rules (critical — you fail if you break these)',
    '1. Answer the latest user message only — actually react to their words.',
    '2. NEVER invent that the user said or lives somewhere. Asking weather ≠ they live there.',
    '3. NEVER invent memories. ONLY the Memory list above counts as long-term memory. Chat history ≠ memory list.',
    '4. If they say "maine kab kaha?" / challenge you: apologize once — do not invent a quote.',
    '5. If they say topic change / abbe sense nahi: acknowledge and move on — do not re-quote old lines.',
    '6. When asked about memory/exam/place: answer only if that fact is in Memory list.',
    '7. Do not claim "tum meri gf ho" / invent relationship status from flirty jokes.',
    '8. Do NOT auto-save anything. Saving only happens when they explicitly ask (yaad rakh / remember).',
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
  recentAssistant: string[] = [],
  memories: { key: string; value: string }[] = [],
  memoryOn = true,
  justSaved: { key: string; value: string } | null = null,
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
        : 'LENGTH: SHORT — 1–2 lines, ~120 chars max in reply';

  const recentUser = history
    .filter((m) => m.role === 'user')
    .slice(-6)
    .map((m) => `- ${m.content.slice(0, 200)}`)
    .join('\n');

  const bannedRecent = recentAssistant
    .slice(-6)
    .map((t) => `- ${t.slice(0, 100)}`)
    .join('\n');

  const denial =
    /maine kab|mene kab|kab kaha|kab bola|kab kha|when did i|i never said|maine nahi|sense nhi|sense nahi|topic change/i.test(
      lastUser,
    );

  const memoryQuery =
    /yaad\s*(hai|he|hain|h?e)|remember|memory|tujhe\s+yaad|tumhe\s+yaad|kya\s+yaad|saved|profile\s*memory/i.test(
      lastUser,
    ) && !parseExplicitMemory(lastUser);

  const memoryLines =
    memoryOn && memories.length > 0
      ? memories
          .slice(0, 20)
          .map((m, i) => `${i + 1}. ${m.value}`)
          .join('\n')
      : memoryOn
        ? '(empty — nothing saved)'
        : '(memory OFF)';

  return [
    'HARD CONSTRAINTS FOR THIS TURN:',
    `Latest user message: """${lastUser.slice(0, 800)}"""`,
    'React to THAT message. Do not ignore it and recycle old drama.',
    'Recent USER lines only (not long-term memory):',
    recentUser || '(none)',
    'Your LAST replies (DO NOT repeat openers/asks from these):',
    bannedRecent || '(none)',
    'LONG-TERM MEMORY LIST (only real saved notes):',
    memoryLines,
    justSaved
      ? `User JUST asked to save: "${justSaved.value}" — confirm it is saved, briefly.`
      : 'Do NOT claim you saved anything unless they used yaad rakh/remember/memory me save.',
    voice,
    len,
    lang ? `LANGUAGE: write in ${lang}` : 'LANGUAGE: match user',
    '1–3 emojis in reply.',
    'Return ONLY JSON: {"reply":"...","ask":"..."}',
    'BANNED forever (anywhere): "Bhai full drama", "Bhai full", "Kya hua/hoga koi baat/plan", "Tumne kaha tha", "maine socha tha tum", "Hey cutie kya hua", "Kuch to bata".',
    'ask must be unique this turn and specific to their latest line. Prefer ONE short reply bubble if unsure.',
    denial
      ? 'User is annoyed / challenging you / wants topic change — apologize briefly if needed, MOVE ON, do not re-quote old messages. Fresh reply only.'
      : memoryQuery
        ? 'User is asking what you remember — answer ONLY from LONG-TERM MEMORY LIST. If empty or missing topic, say not saved. Do not invent from chat history.'
        : 'Stay on their latest message.',
  ].join('\n');
}

/** Drop older turns so the model cannot keep parroting a long bad loop. */
function trimHistoryForModel(
  history: { role: 'user' | 'assistant'; content: string }[],
): { role: 'user' | 'assistant'; content: string }[] {
  // Last 10 turns max; scrub assistant spam; keep user lines longer.
  return history.slice(-10).map((m) => ({
    role: m.role,
    content:
      m.role === 'assistant'
        ? sanitizeHistoryAssistant(m.content).slice(0, 220)
        : m.content.slice(0, 800),
  }));
}

/** Phrases users reported looping forever — ban anywhere in reply/ask. */
const BANNED_LOOP =
  /bhai\s+full(\s+(drama|topic|form|on))?|hey\s+cutie|kya\s+hua,?\s*koi\s+(baat|plan|problem)|kya\s+hoga,?\s*koi\s+(baat|plan)|aur\s+kya\s+hua|koi\s+baat\s+hai|koi\s+plan\s+hai|koi\s+problem\s+hai|bhai\s+kya\s+hua|kuch\s+to\s+bata|tumne\s+kaha\s+tha|maine\s+socha\s+tha\s+tum|yaad\s+rakh,?\s*tumne\s+kaha/i;

const BANNED_ASK =
  /kya\s+hu[ae],?\s*koi\s+(baat|plan|problem)|kya\s+hoga,?\s*koi|aur\s+kya\s+hua|koi\s+baat\s+hai|koi\s+plan\s+hai|koi\s+problem|hey\s+cutie|bhai\s+(kya\s+hua|full)|kuch\s+to\s+bata|tumne\s+kaha\s+tha/i;

const BANNED_REPLY_OPEN =
  /^(bhai\s+full|hey\s+cutie|arey,?\s*piuxxh\s+to\s+samajh|bhai\s+kya\s+hua|yaad\s+rakh,?\s*tumne)/i;

/** Strip loop spam from past assistant bubbles before the model sees them. */
function sanitizeHistoryAssistant(text: string): string {
  let t = text.replace(/\r\n/g, '\n').trim();
  // Drop dual-bubble spam lines entirely.
  t = t
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !containsBannedLoop(line) && !isBannedAsk(line))
    .join('\n');
  t = stripLoopTemplates(t);
  t = t.replace(/\s{2,}/g, ' ').trim();
  // If the whole bubble was spam, replace with neutral stub so model has no pattern to copy.
  if (!t || containsBannedLoop(t) || t.length < 3) {
    return '(previous reply)';
  }
  return t.slice(0, 280);
}

function containsBannedLoop(text: string): boolean {
  return BANNED_LOOP.test(text);
}

function isBannedAsk(text: string): boolean {
  return BANNED_ASK.test(text) || containsBannedLoop(text);
}

/** Remove the exact templates from a generated string. */
function stripLoopTemplates(text: string): string {
  let t = text;
  // "Bhai full drama hai! ..." / "Bhai full topic change hai!"
  t = t.replace(/\bBhai\s+full[^.!?\n]*[.!?]?/gi, ' ');
  // "Tumne kaha tha '...' to maine socha tha ..."
  t = t.replace(/Tumne\s+kaha\s+tha[^.!?\n]*/gi, ' ');
  t = t.replace(/maine\s+socha\s+tha[^.!?\n]*/gi, ' ');
  t = t.replace(/Yaad\s+rakh,?\s*tumne\s+kaha[^.!?\n]*/gi, ' ');
  // Classic empty check-ins
  t = t.replace(
    /(Aur\s+)?[Kk]ya\s+hu[ae],?\s*koi\s+(baat|plan|problem)\s+hai\??/gi,
    ' ',
  );
  t = t.replace(/[Kk]ya\s+hoga,?\s*koi\s+(baat|plan)\s+hai\??/gi, ' ');
  t = t.replace(/[Kk]oi\s+(baat|plan|problem)\s+hai\??/gi, ' ');
  t = t.replace(/Hey\s+cutie[^.!?\n]*/gi, ' ');
  t = t.replace(/Bhai\s+kya\s+hua\??\s*Kuch\s+to\s+bata!?/gi, ' ');
  t = t.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function normalizeChat(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTooSimilarToRecent(text: string, recent: string[]): boolean {
  const norm = normalizeChat(text);
  if (!norm || norm === 'previous reply') return true;
  const words = norm.split(' ').filter(Boolean);
  return recent.some((r) => {
    const rn = normalizeChat(r);
    if (!rn || rn === 'previous reply') return false;
    if (rn === norm) return true;
    // Substantial substring overlap
    if (norm.length > 12 && rn.length > 12) {
      if (rn.includes(norm) || norm.includes(rn)) return true;
    }
    // Same first 3–4 content words → loop
    const a = words.slice(0, 4).join(' ');
    const b = rn.split(' ').slice(0, 4).join(' ');
    if (a.length > 6 && a === b) return true;
    // Jaccard-ish on first 12 words
    const aw = new Set(words.slice(0, 12));
    const bw = new Set(rn.split(' ').slice(0, 12));
    if (aw.size === 0 || bw.size === 0) return false;
    let inter = 0;
    for (const w of aw) if (bw.has(w)) inter++;
    const union = aw.size + bw.size - inter;
    return union > 0 && inter / union >= 0.72;
  });
}

/** User message echoed back as the whole reply. */
function isEchoOfUser(reply: string, lastUser: string): boolean {
  const a = normalizeChat(reply);
  const b = normalizeChat(lastUser);
  if (!a || !b || b.length < 6) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  // First line of reply is just the user line repeated
  const firstLine = normalizeChat(reply.split('\n')[0] ?? '');
  return firstLine.length > 8 && (firstLine === b || b.includes(firstLine));
}

function meaningfulLen(text: string): number {
  return normalizeChat(text).replace(/\s+/g, '').length;
}

function diversifyReply(
  reply: string,
  lastUser: string,
  recent: string[],
  length: string,
): string {
  const original = reply.trim();
  let r = stripLoopTemplates(original);

  // Drop a first line that only echoes the user.
  if (isEchoOfUser(r, lastUser)) {
    const lines = r.split('\n').map((l) => l.trim()).filter(Boolean);
    r = lines.slice(1).join('\n').trim();
  }

  // If stripping nuked most of the reply, treat as spam → full fallback.
  const strippedTooHard =
    meaningfulLen(original) > 20 && meaningfulLen(r) < Math.min(12, meaningfulLen(original) * 0.35);

  const bad =
    !r ||
    meaningfulLen(r) < 6 ||
    strippedTooHard ||
    BANNED_REPLY_OPEN.test(r) ||
    containsBannedLoop(r) ||
    isTooSimilarToRecent(r, recent) ||
    isEchoOfUser(r, lastUser);

  if (bad) {
    r = contextualFallbackReply(lastUser, recent);
  }

  // Second pass: strip again after fallback shouldn't need it, but safe.
  r = stripLoopTemplates(r);
  if (!r || meaningfulLen(r) < 6 || containsBannedLoop(r) || isTooSimilarToRecent(r, recent)) {
    r = contextualFallbackReply(lastUser, recent);
  }

  return shapeReply(r, length);
}

function diversifyAsk(
  ask: string,
  lastUser: string,
  reply: string,
  recent: string[],
): string {
  let a = stripLoopTemplates(ask.trim());
  if (
    !a ||
    isBannedAsk(a) ||
    containsBannedLoop(a) ||
    isTooSimilarToRecent(a, recent) ||
    isTooSimilarToRecent(a, [reply]) ||
    isEchoOfUser(a, lastUser)
  ) {
    a = contextualFallbackAsk(lastUser, recent);
  }
  // Still banned / same as recent? skip second bubble entirely.
  if (
    !a ||
    isBannedAsk(a) ||
    containsBannedLoop(a) ||
    isTooSimilarToRecent(a, recent) ||
    isTooSimilarToRecent(a, [reply])
  ) {
    return '';
  }
  return shapeAsk(a);
}

function pickUnused(pool: string[], recent: string[], seed: string): string {
  const used = recent.map(normalizeChat);
  const fresh = pool.filter((p) => {
    const n = normalizeChat(p);
    return !used.some((u) => u.includes(n) || n.includes(u.slice(0, 20)));
  });
  const list = fresh.length ? fresh : pool;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % list.length;
  // Also rotate by recent length so consecutive turns differ.
  return list[(h + recent.length) % list.length]!;
}

function contextualFallbackReply(lastUser: string, recent: string[] = []): string {
  const u = lastUser.toLowerCase();
  if (/propose|propose ker|girlfriend|gf thi|boyfriend|bf\b|interested|crush|lowkey interested/i.test(u)) {
    return pickUnused(
      [
        'Okay wait 😭 that got real — serious bol rahe ho ya testing me?',
        'Arre slow down 😳 pehle vibes clear karo, fir baat aage badhegi.',
        'Acha hold on — ye proposal wala bit joke hai ya actual feel?',
      ],
      recent,
      lastUser,
    );
  }
  if (/topic change|sense nahi|sense nhi|abbe|iss baat ka/i.test(u)) {
    return pickUnused(
      [
        'Haan sorry — pehle wala loop band. Fresh start, bol kya chal raha hai.',
        'Theek hai, topic drop. Naya scene kya hai?',
        'Got it, reset 🔄 seedha bol ab kya baat karni hai.',
      ],
      recent,
      lastUser,
    );
  }
  if (/weather|mausam|mosaam|mhow/i.test(u)) {
    return pickUnused(
      [
        'Weather wala point — mujhe live weather nahi dikhta, bas jo tumne bataya woh ☀️',
        'Mausam yaad se: jo tumne bola wahi — live forecast nahi hai mere paas.',
      ],
      recent,
      lastUser,
    );
  }
  if (/exam|padhai|study|paper/i.test(u)) {
    return pickUnused(
      [
        'Exam wala stress real hai 😭 — prep kaisa chal raha?',
        'Padhai mode on? Bata kya paper next hai.',
      ],
      recent,
      lastUser,
    );
  }
  if (/^h+i+$|^h+e+y+$|^hlo|^hello|^yo\b|^sup\b/i.test(u.trim())) {
    return pickUnused(
      [
        'Heyyy ✨ kya scene hai aaj?',
        'Yo 👋 kya chal raha?',
        'Aree wapas aa gaye — mood kaisa hai?',
      ],
      recent,
      lastUser,
    );
  }
  if (/yaad|remember|memory|exam se related/i.test(u)) {
    return 'Jo memory list me clear save hai wahi bolunga — random purani lines invent nahi 🫶';
  }
  if (/talent|think abt me|about me|what do u think/i.test(u)) {
    return pickUnused(
      [
        'Honestly? alag energy hai — curious + thoda chaotic cute 😌',
        'Vibe check: interesting person energy, boring nahi lagte ✨',
        'Tumhare messages se lagta hai main character arc chal raha 😂',
      ],
      recent,
      lastUser,
    );
  }
  if (/gf|girlfriend|meri gf/i.test(u)) {
    return 'Arre 😭 main AI hoon — flirty ban sakta hoon, lekin real gf claim mat karwa 😅';
  }
  return pickUnused(
    [
      'Okay got you — seedha usi pe baat 😊',
      'Hmm samajh gaya, aur thoda open karke bata?',
      'Interesting 👀 main sun raha hoon — aage kya?',
      'Acha theek, main usi point pe rehta hoon.',
    ],
    recent,
    lastUser,
  );
}

function contextualFallbackAsk(lastUser: string, recent: string[] = []): string {
  const u = lastUser.toLowerCase();
  if (/propose|girlfriend|gf|interested|crush/i.test(u)) {
    return pickUnused(
      ['Serious mode ya just testing me? 👀', 'Matlab ab kya expect kar rahe ho?', 'Joke tha ya real feel?'],
      recent,
      lastUser,
    );
  }
  if (/topic change|sense nahi|sense nhi/i.test(u)) {
    return pickUnused(
      ['Naya topic kya rakhna hai?', 'Kis cheez pe shift karein?', 'Mood kya chahiye ab?'],
      recent,
      lastUser,
    );
  }
  if (/weather|mausam|mosaam|mhow/i.test(u)) {
    return pickUnused(
      ['Kis city ka mausam actually chahiye?', 'Aaj ghumne ka mood hai kya?'],
      recent,
      lastUser,
    );
  }
  if (/exam/i.test(u)) {
    return pickUnused(
      ['Kaunsa paper next hai?', 'Kitne din bache hain?'],
      recent,
      lastUser,
    );
  }
  if (/hlo|hello|hi\b|hey\b/i.test(u)) {
    return pickUnused(
      ['Aaj ka highlight kya tha?', 'Kya plan hai aaj ka?'],
      recent,
      lastUser,
    );
  }
  if (/talent|think abt me|about me/i.test(u)) {
    return pickUnused(
      ['Ek cheez bata jo tujhe khud pasand hai?', 'Sabse underrated skill kya hai teri?'],
      recent,
      lastUser,
    );
  }
  return pickUnused(
    [
      'Uske baad kya scene?',
      'Serious ya meme mode?',
      'Aur detail de thoda?',
      'Kaise feel ho raha ab?',
      'Kiske saath related hai ye?',
      'Phir kya hua?',
      'Tu kya soch raha ispe?',
    ],
    recent,
    lastUser,
  );
}

/**
 * Prefer JSON {"reply","ask"}; fall back to marker split / last-question split.
 */
function parseModelPayload(
  raw: string,
  length: string,
): { reply: string; ask: string } {
  const text = raw.replace(/\r\n/g, '\n').trim();

  // 1) JSON object
  const jsonHit = tryParseReplyJson(text);
  if (jsonHit) {
    return {
      reply: shapeReply(stripMarkers(jsonHit.reply), length) || 'Hmm 😅',
      ask: shapeAsk(stripMarkers(jsonHit.ask)),
    };
  }

  // 2) Marker format (legacy / misbehaving models)
  let normalized = text
    .replace(/<{1,3}\s*REPLY\s*>{1,3}/gi, '<<<REPLY>>>')
    .replace(/<{1,3}\s*ASK\s*>{1,3}/gi, '<<<ASK>>>');

  if (/<<<\s*ASK\s*>>>/i.test(normalized)) {
    let head = normalized;
    if (/<<<\s*REPLY\s*>>>/i.test(normalized)) {
      head = normalized.split(/<<<\s*REPLY\s*>>>/i)[1] ?? normalized;
    }
    const parts = head.split(/<<<\s*ASK\s*>>>/i);
    return {
      reply: shapeReply(stripMarkers((parts[0] ?? '').trim()), length) || 'Hmm 😅',
      ask: shapeAsk(stripMarkers((parts[1] ?? '').trim())),
    };
  }

  // 3) Last line question
  const lines = stripMarkers(text).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const last = lines[lines.length - 1]!;
    if (/[?？]\s*$/.test(last) || /^(what|why|how|kab|kya|kaise|aur|wanna|want)\b/i.test(last)) {
      return {
        reply: shapeReply(lines.slice(0, -1).join('\n'), length),
        ask: shapeAsk(last),
      };
    }
  }

  return {
    reply: shapeReply(stripMarkers(text), length),
    ask: shapeAsk('Aur bata? 😊'),
  };
}

function tryParseReplyJson(text: string): { reply: string; ask: string } | null {
  try {
    // Extract first {...} block if model added prose.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      reply?: unknown;
      ask?: unknown;
      message?: unknown;
      question?: unknown;
    };
    const reply = String(obj.reply ?? obj.message ?? '').trim();
    const ask = String(obj.ask ?? obj.question ?? '').trim();
    if (!reply && !ask) return null;
    return { reply, ask };
  } catch {
    return null;
  }
}

function stripMarkers(text: string): string {
  return text
    .replace(/<<<\s*REPLY\s*>>>/gi, '')
    .replace(/<<<\s*ASK\s*>>>/gi, '')
    .replace(/<{1,3}\s*REPLY\s*>{1,3}/gi, '')
    .replace(/<{1,3}\s*ASK\s*>{1,3}/gi, '')
    .replace(/\bREPLY\s*:/gi, '')
    .replace(/\bASK\s*:/gi, '')
    .trim();
}

function looksLikeMarkerGarbage(text: string): boolean {
  return /<<<|>>>|^\s*REPLY\s*$|^\s*ASK\s*$/i.test(text);
}

function finalizeBubble(text: string, length: string): string {
  let t = stripMarkers(cleanModelArtifacts(text));
  // If markers somehow survived mid-string, cut at ASK.
  const cut = t.split(/<<<\s*ASK\s*>>>|<{1,3}\s*ASK\s*>{1,3}/i)[0] ?? t;
  t = shapeReply(cut.trim(), length);
  return t;
}

function finalizeAsk(text: string): string {
  return shapeAsk(stripMarkers(text));
}

function shapeAsk(text: string): string {
  let ask = stripMarkers(text.replace(/\r\n/g, '\n').trim());
  ask = ask.split('\n').filter(Boolean)[0] ?? ask;
  ask = ask.replace(/^["']|["']$/g, '').trim();
  ask = stripLoopTemplates(ask);
  if (!ask || looksLikeMarkerGarbage(ask) || isBannedAsk(ask)) return '';
  if (ask.length > 120) ask = `${ask.slice(0, 117).trim()}…`;
  if (!/[?？]\s*$/.test(ask) && !/^(and you|aur|kya|what|how|wanna)/i.test(ask)) {
    ask = `${ask.replace(/[.!]+$/, '')}?`;
  }
  // Final ban gate after punctuation add.
  if (isBannedAsk(ask) || containsBannedLoop(ask)) return '';
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

/**
 * Explicit save only — never match questions like "yaad hai?" / "kya yaad hai".
 * "yaad rakh blue is my fav" / "remember my dog is max" / "memory me save …"
 */
function parseExplicitMemory(message: string): { key: string; value: string } | null {
  const m = message.trim();
  // Queries — not saves.
  if (
    /^(kya\s+)?(tujhe|tumhe|tumko|aapko)?\s*yaad\s*(hai|he|hain)\b/i.test(m) ||
    /\b(yaad\s*(hai|he)|what do you remember|do you remember)\b/i.test(m) &&
      !/\b(rakh|save|note|daal|dal)\b/i.test(m)
  ) {
    return null;
  }

  const patterns = [
    /(?:please\s+)?(?:remember|save|note)\s+(?:that\s+|this\s*:?\s*)?(.+)/i,
    /(?:please\s+)?(?:remember|save)\s+this[:\s]+(.+)/i,
    /(?:yaad|yad)\s*rakh(?:na|o|e|lena|lo)?\s*(?:ki|ke|:)?\s*(.+)/i,
    /(?:mujhe\s+)?yaad\s+(?:rakh|kar)(?:na|o|e|lena|lo)?\s*(?:ki|ke|:)?\s*(.+)/i,
    /memory\s*(?:me|mein|m)?\s*(?:save|daal|dal|rakh|note)\s*(?:kar|lo|do|dena)?\s*(?:ki|ke|:)?\s*(.+)/i,
    /(?:note|save)\s*(?:kar|karo|kar\s*lo|kar\s*dena)\s*(?:ki|ke|:)?\s*(.+)/i,
    /mat\s+bhool(?:na|o)\s*(?:ki|ke|:)?\s*(.+)/i,
  ];
  for (const re of patterns) {
    const hit = m.match(re);
    if (!hit?.[1]) continue;
    let value = hit[1].trim().replace(/[.!]+$/, '').slice(0, 500);
    // Strip trailing filler
    value = value.replace(/\s*(please|plz|yaar|bhai)\s*$/i, '').trim();
    if (value.length < 2) continue;
    // Reject pure questions with no fact payload
    if (/^(kya|what|who|when|where|how)\b/i.test(value) && value.length < 12) continue;
    const key =
      value
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

/** Soft cap — drop oldest when over limit. */
async function capMemories(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  max = 40,
): Promise<void> {
  const { data: all } = await userClient
    .from('ai_memories')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (all && all.length > max) {
    const drop = all.slice(0, all.length - max).map((r) => r.id);
    await userClient.from('ai_memories').delete().in('id', drop);
  }
}
