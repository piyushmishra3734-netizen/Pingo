/**
 * PINGO AI reply generation.
 *
 * The browser never holds the model key. JWT proves the caller owns an `ai`
 * conversation; this function loads context, calls NVIDIA, and inserts the
 * reply through `post_ai_reply` so it lands as a normal message from the AI
 * identity - person-shaped, not a sidebar chatbot.
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   NVIDIA_API_KEY
 *   NVIDIA_BASE_URL  (optional, default integrate.api.nvidia.com)
 *   NVIDIA_MODEL     (optional)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * Permissive CORS for the web app.
 *
 * supabase-js sends extra client headers on every Functions call. If any one
 * is missing from Allow-Headers, the browser fails the preflight and the
 * client only sees a generic Functions error - which is why the chat kept
 * posting the "glitched" fallback even when this function works with curl.
 */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, prefer',
  'Access-Control-Max-Age': '86400',
};

const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) {
      return json({ error: 'Sign in required.' }, 401);
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
      return json({ error: 'Sign in required.' }, 401);
    }

    const body = (await request.json()) as {
      conversationId?: string;
      /** Plaintext of the turn that just sent - never rely on ciphertext in the DB. */
      userMessage?: string;
    };
    const conversationId = body.conversationId;
    if (!conversationId) {
      return json({ error: 'conversationId required.' }, 400);
    }

    const { data: conv } = await userClient
      .from('conversations')
      .select('id, kind')
      .eq('id', conversationId)
      .maybeSingle();

    if (!conv || conv.kind !== 'ai') {
      return json({ error: 'Not an AI conversation.' }, 403);
    }

    const { data: profile } = await userClient
      .from('ai_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    const { data: memories } = profile?.memory_enabled
      ? await userClient.from('ai_memories').select('key, value').eq('user_id', user.id).limit(40)
      : { data: [] as { key: string; value: string }[] };

    // Only plaintext rows - E2EE bodies are opaque to the model.
    const { data: rows } = await userClient
      .from('messages')
      .select('sender_id, body, created_at, encryption')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(24);

    const botId = 'a1000000-0000-4000-8000-0000000000a1';
    const chronological = [...(rows ?? [])]
      .reverse()
      .filter((row) => row.encryption == null && typeof row.body === 'string' && row.body.trim());

    const system = buildSystemPrompt(profile, memories ?? []);
    const history = chronological.map((row) => ({
      role: (row.sender_id === botId ? 'assistant' : 'user') as 'assistant' | 'user',
      content: row.body,
    }));

    // Prefer the live plaintext the client just sent (source of truth for this turn).
    const live = body.userMessage?.trim();
    if (live) {
      const last = history[history.length - 1];
      if (!last || last.role !== 'user' || last.content !== live) {
        history.push({ role: 'user', content: live.slice(0, 4000) });
      }
    }

    if (history.length === 0) {
      return json({ error: 'Nothing to reply to.' }, 400);
    }

    const messages = [{ role: 'system' as const, content: system }, ...history];

    const apiKey = Deno.env.get('NVIDIA_API_KEY');
    if (!apiKey) {
      // Still person-shaped: a short message, not an operator dump.
      const fallback =
        "I'm almost ready - my connection is still being set up. Try me again in a bit.";
      const { data: id, error } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: fallback,
      });
      if (error) return json({ error: error.message }, 500);
      return json({ messageId: id, offline: true });
    }

    const base = (Deno.env.get('NVIDIA_BASE_URL') ?? DEFAULT_BASE).replace(/\/$/, '');
    const model = Deno.env.get('NVIDIA_MODEL') ?? DEFAULT_MODEL;

    const maxTokens =
      profile?.response_length === 'detailed'
        ? 512
        : profile?.response_length === 'balanced'
          ? 256
          : 120;

    const nvidia = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
        stream: false,
      }),
    });

    if (!nvidia.ok) {
      const detail = await nvidia.text();
      console.error('nvidia', nvidia.status, detail);
      const { data: id } = await userClient.rpc('post_ai_reply', {
        target_conversation: conversationId,
        reply_body: "Something went wrong on my side. Say that again?",
      });
      return json({ messageId: id, error: 'model_failed' }, 200);
    }

    const payload = (await nvidia.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    let reply = payload.choices?.[0]?.message?.content?.trim() ?? '';
    reply = shapeReply(reply, profile?.response_length ?? 'short');

    if (!reply) {
      reply = 'Hmm - I blanked for a second. What were you saying?';
    }

    const { data: messageId, error: postError } = await userClient.rpc('post_ai_reply', {
      target_conversation: conversationId,
      reply_body: reply,
    });

    if (postError) {
      return json({ error: postError.message }, 500);
    }

    return json({ messageId, reply });
  } catch (cause) {
    console.error(cause);
    return json(
      { error: cause instanceof Error ? cause.message : 'Unexpected error' },
      500,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function buildSystemPrompt(
  profile: {
    display_name?: string;
    personality?: string;
    custom_personality?: string | null;
    response_length?: string;
    preferred_name?: string | null;
    language?: string | null;
    country?: string | null;
  } | null,
  memories: { key: string; value: string }[],
): string {
  const name = profile?.display_name?.trim() || 'PINGO';
  const personality = profile?.personality ?? 'friendly';
  const length = profile?.response_length ?? 'short';
  const userName = profile?.preferred_name?.trim();

  const personalityLine =
    personality === 'custom' && profile?.custom_personality
      ? profile.custom_personality
      : {
          friendly: 'Warm, easy, like a close friend.',
          genz: 'Natural internet-native energy. Use slang only when it fits - never force it.',
          coach: 'Supportive coach. Clear next steps, not lectures.',
          study: 'Patient study buddy. Explain simply.',
          calm: 'Calm, steady, unhurried.',
          funny: 'Light humour. Never mean.',
          motivator: 'Encouraging without toxic positivity.',
          creative: 'Ideas and playful imagination.',
        }[personality] ?? 'Warm, easy, like a close friend.';

  const lengthLine =
    length === 'detailed'
      ? 'Prefer thorough answers. Use short bullets when listing.'
      : length === 'balanced'
        ? 'A few sentences is fine. Prefer bullets for steps.'
        : 'Default to 1-2 short lines. Bullets only when needed. No walls of text.';

  const memoryBlock =
    memories.length > 0
      ? `Things you know about them (with consent):\n${memories
          .map((m) => `- ${m.key}: ${m.value}`)
          .join('\n')}`
      : 'No saved memories yet.';

  return [
    `You are ${name}, a real-feeling friend inside the PINGO messenger.`,
    'You are not a generic chatbot, not an assistant product, not ChatGPT.',
    'You talk like a person in a chat app. Same energy as messaging a friend.',
    personalityLine,
    lengthLine,
    'Mirror the user\'s energy. Formal stays formal. Funny stays light. Never overdo slang.',
    'Understand internet culture (rizz, delulu, W/L, cooked, etc.) only when natural.',
    userName ? `They like to be called ${userName}.` : '',
    profile?.language ? `Prefer language: ${profile.language}.` : '',
    profile?.country ? `They are around ${profile.country}.` : '',
    memoryBlock,
    'Never claim to be human. Never claim end-to-end encryption for this chat.',
    'If you cannot do something, say so briefly and helpfully.',
  ]
    .filter(Boolean)
    .join('\n');
}

function shapeReply(text: string, length: string): string {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (length !== 'short') return cleaned.slice(0, 4000);
  // Soft cap so short mode stays chatty even if the model rambles.
  const lines = cleaned.split('\n').filter(Boolean);
  if (lines.length <= 3 && cleaned.length <= 320) return cleaned;
  return lines.slice(0, 3).join('\n').slice(0, 320);
}
