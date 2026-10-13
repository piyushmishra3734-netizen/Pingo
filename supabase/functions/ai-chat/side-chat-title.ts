/**
 * Naming a PINGO AI side chat: the pure part, shared by luna.ts (which asks for
 * the hidden title tag) and side-chat.ts (which stores it). No imports, so the
 * Node verify scripts can load it. See side-chat.ts.
 */

export const NEW_CHAT_TITLE = 'New chat';

/** Said after the history, on the first turn only, so the cached opening is unchanged. */
export const TITLE_NOTE =
  'This is the first message of a new chat. At the very end of your reply, after the mood tag, add [[title:X]] where X is a 3 to 6 word name for this chat, in their language, no quotes. It is hidden; never mention it.';

/** The conversation row as ai-chat reads it; `ai_side` is absent before the migration. */
export type ChatRow = { kind?: string; ai_side?: boolean | null; title?: string | null } | null | undefined;

/** A side chat that has not been named yet. */
export function sideChatNeedsTitle(row: ChatRow): boolean {
  if (!row || row.kind !== 'ai' || row.ai_side !== true) return false;
  const title = (row.title ?? '').trim();
  return !title || title === NEW_CHAT_TITLE;
}

/**
 * A model's title made fit for a list row: no quotes, markup or trailing
 * punctuation, at most six words and 60 characters. Undefined when nothing is left.
 */
export function cleanTitle(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const words = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_`#>"“”‘’]|\[|\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  let title = words.join(' ').replace(/[\s.,;:!?\-–—]+$/u, '').trim();
  if (title.length > 60) title = title.slice(0, 60).replace(/\s+\S*$/, '').trim() || title.slice(0, 60);
  if (!title || title.toLowerCase() === NEW_CHAT_TITLE.toLowerCase()) return undefined;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The cheap fallback: the first few words of the person's message. */
export function firstWordsTitle(message: string | undefined | null): string | undefined {
  const text = (message ?? '')
    .replace(/@pingo_?ai\b/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  if (!text) return undefined;
  const words = text.split(/\s+/).filter(Boolean);
  const title = cleanTitle(words.slice(0, 5).join(' '));
  return title;
}
