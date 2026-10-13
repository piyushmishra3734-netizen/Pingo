/**
 * Pure helpers for PINGO AI's Recents and goals, shared by the Supabase
 * service and `verify-ai-data`.
 */

import type { AiGoal, Message } from '@pingo/core';

/** The fields of a message row a Recents subtitle needs. */
export interface SnippetRow {
  body: string | null;
  kind: string;
  file_name?: string | null;
  sender_id?: string;
  deleted_at?: string | null;
}

/**
 * One line under a Recents row: the last message, without Markdown, or what
 * it carried when it has no words. Empty when there is nothing yet.
 */
export function aiSnippet(row: SnippetRow | undefined, botId?: string): string {
  if (!row || row.deleted_at) return '';
  const text = (row.body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) return text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text;
  if (row.kind === 'photo') return botId && row.sender_id === botId ? 'Image' : 'Photo';
  if (row.kind === 'document') return row.file_name?.trim() || 'File';
  if (row.kind === 'voice') return 'Voice message';
  return '';
}

/** The same line from a `Message` the app already holds (a live update). */
export function messageSnippet(message: Message | undefined, botId?: string): string {
  if (!message) return '';
  const file = message.attachments.find((a) => a.kind === 'file');
  return aiSnippet(
    {
      body: message.body,
      kind: message.photo ? 'photo' : file ? 'document' : message.attachments.some((a) => a.kind === 'audio') ? 'voice' : 'text',
      file_name: file && 'fileName' in file ? file.fileName : null,
      sender_id: message.authorId,
    },
    botId,
  );
}

/** A goal row as the app shows it. */
export function toAiGoal(row: {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  done_at: string | null;
}): AiGoal {
  return {
    id: row.id,
    title: row.title,
    done: row.done,
    createdAt: Date.parse(row.created_at),
    ...(row.done_at ? { doneAt: Date.parse(row.done_at) } : {}),
  };
}
