/**
 * PINGO AI side chats (Recents): naming one after its first reply.
 *
 * A side chat starts as 'New chat'. On its first turn Luna is asked for a
 * hidden `[[title:...]]` tag in the same reply (no extra model call), taken
 * out of the text by `takeMood` / `MoodFilter` exactly like the mood tag.
 * When there is no tag (a picture, the fallback paths, a model that forgot),
 * the first words of what the person said are the name.
 *
 * Stored through `set_ai_side_chat_title`, which only the service role may
 * call and which only changes a side chat of this owner still called
 * 'New chat'. See 20261025000000_ai_side_chats_goals.sql.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

import { firstWordsTitle, sideChatNeedsTitle, type ChatRow } from './side-chat-title.ts';

export { cleanTitle, firstWordsTitle, NEW_CHAT_TITLE, sideChatNeedsTitle, TITLE_NOTE } from './side-chat-title.ts';

/**
 * Names the side chat as PINGO AI, with the service role.
 *
 * Never throws: a chat left as 'New chat' is a cosmetic miss, and the next
 * turn tries again because the title is still the default.
 */
export async function nameSideChat(
  supabaseUrl: string,
  ownerId: string,
  conversationId: string,
  title: string | undefined,
): Promise<boolean> {
  if (!title) return false;
  try {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) return false;
    const admin = createClient(supabaseUrl, key, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc('set_ai_side_chat_title', {
      target: conversationId,
      owner: ownerId,
      new_title: title,
    });
    if (error) {
      console.warn('[side-chat] title', error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.warn('[side-chat] title', err);
    return false;
  }
}

/** The fallback paths (no Luna): read the row, and name it from the first words if it needs one. */
export async function nameSideChatFromMessage(
  // deno-lint-ignore no-explicit-any
  db: any,
  supabaseUrl: string,
  ownerId: string,
  conversationId: string,
  message: string | undefined,
): Promise<void> {
  try {
    const { data } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
    if (!sideChatNeedsTitle(data as ChatRow)) return;
    await nameSideChat(supabaseUrl, ownerId, conversationId, firstWordsTitle(message));
  } catch (err) {
    console.warn('[side-chat] fallback title', err);
  }
}
