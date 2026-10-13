import { getSupabaseClient } from '../../lib/supabase/client.js';
import { PINGO_AI_USER_ID } from './ai-mentions.js';

/**
 * A PINGO AI chat as a Markdown file, downloaded. PINGO AI's chats are stored
 * as plain text (the model has to read them), so the whole thread is read here,
 * not only what the screen happened to load. RLS keeps it to the person's own.
 */
export async function exportAiChat(conversationId: string, title: string): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('messages')
    .select('sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .is('encryption', null)
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) throw error;
  const lines = [`# ${title}`, ''];
  for (const m of (data ?? []) as { sender_id: string; body: string | null; created_at: string }[]) {
    if (!m.body?.trim()) continue;
    const who = m.sender_id === PINGO_AI_USER_ID ? 'PINGO AI' : 'You';
    lines.push(`**${who}** · ${new Date(m.created_at).toLocaleString()}`, '', m.body.trim(), '');
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\w\- ]+/g, '').trim() || 'PINGO AI chat'}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
