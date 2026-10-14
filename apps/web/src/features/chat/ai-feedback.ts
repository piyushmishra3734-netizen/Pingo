import { getSupabaseClient } from '../../lib/supabase/client.js';

/** Thumbs up (1), down (-1), or cleared (0) on a PINGO AI reply. True when stored. */
export async function rateAiReply(messageId: string, rating: -1 | 0 | 1): Promise<boolean> {
  const db = getSupabaseClient();
  const { error } = rating
    ? await db.from('ai_feedback').upsert({ message_id: messageId, rating }, { onConflict: 'message_id,user_id' })
    : await db.from('ai_feedback').delete().eq('message_id', messageId);
  return !error;
}
