import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/** Messages kept word for word after a compaction, so the next reply still has the thread in hand. */
const COMPACT_KEEP = 6;

export function serviceClient(supabaseUrl: string) {
  return createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Folds a PINGO AI chat's older messages into one summary, on the person's
 * say-so (the ring in the app). The model reads the previous summary, if any,
 * and every message since it except the newest few, and writes what it needs
 * to carry on as if it had read them all. Read through the person's own client
 * (RLS: their chat); written with the service role (not their columns to edit).
 */
export async function compactChat(
  supabaseUrl: string,
  // deno-lint-ignore no-explicit-any
  userClient: any,
  conversationId: string,
  botId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return { status: 503, body: { error: 'PINGO AI is not set up.' } };

  const { data: chat } = await userClient
    .from('conversations')
    .select('ai_summary, ai_summary_upto')
    .eq('id', conversationId)
    .maybeSingle();
  let query = userClient
    .from('messages')
    .select('sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .is('encryption', null)
    .order('created_at', { ascending: true })
    .limit(600);
  if (chat?.ai_summary_upto) query = query.gt('created_at', chat.ai_summary_upto);
  const { data: rows, error } = await query;
  if (error) return { status: 500, body: { error: 'Could not read the chat.' } };

  const said = ((rows ?? []) as { sender_id: string; body: string | null; created_at: string }[]).filter((r) => r.body?.trim());
  const fold = said.slice(0, Math.max(0, said.length - COMPACT_KEEP));
  if (fold.length < 4) return { status: 200, body: { compacted: false, reason: 'Nothing to compact yet.' } };

  const transcript = fold
    .map((r) => `${r.sender_id === botId ? 'PINGO AI' : 'Them'}: ${r.body!.trim().slice(0, 4000)}`)
    .join('\n\n');
  const previous = chat?.ai_summary ? `Summary so far:\n${chat.ai_summary}\n\n` : '';
  const base = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '');

  const res = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('OPENAI_MODEL') || 'gpt-6-luna',
      reasoning: { effort: 'none' },
      max_output_tokens: 1800,
      input: [
        {
          role: 'system',
          content:
            'You compress a chat between a person and PINGO AI so PINGO AI can continue it as if it had read every message. ' +
            'Keep everything it would need: who they are and what they told it, decisions, numbers, names, dates, plans, open questions and promises, ' +
            'what they liked or disliked, and the topic it was on and where it stopped. Drop greetings, small talk and repeats. ' +
            'Write in the language the chat was in, as short notes under a few plain headings. No preamble. At most 450 words.',
        },
        { role: 'user', content: `${previous}Messages since:\n\n${transcript}`.slice(0, 120_000) },
      ],
    }),
  });
  const out = (await res.json().catch(() => null)) as { output?: { content?: { type?: string; text?: string }[] }[] } | null;
  const summary = (out?.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();
  if (!res.ok || !summary) {
    console.error('[ai-chat] compact', res.status);
    return { status: 502, body: { error: 'Could not compact right now. Try again.' } };
  }

  const upto = fold[fold.length - 1]!.created_at;
  const kept = said.slice(fold.length).reduce((n, r) => n + (r.body?.length ?? 0), 0);
  // An estimate until the next turn measures it: the usual prompt around it, the summary, and what was kept.
  const tokens = 6_500 + Math.round((summary.length + kept) / 3.5);
  const { error: saveError } = await serviceClient(supabaseUrl)
    .from('conversations')
    .update({ ai_summary: summary.slice(0, 12_000), ai_summary_upto: upto, ai_context_tokens: tokens })
    .eq('id', conversationId);
  if (saveError) return { status: 500, body: { error: 'Could not save the summary.' } };
  console.log(`[ai-chat] compacted messages=${fold.length} summary_chars=${summary.length}`);
  return { status: 200, body: { compacted: true, folded: fold.length, tokens } };
}
