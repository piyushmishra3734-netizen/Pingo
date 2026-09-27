import type { Story } from '@pingo/core';

import { publicAppUrl } from '../../lib/public-origin.js';

/**
 * Story mentions, delivered as a chat message - Instagram's "mentioned you in
 * their story" card.
 *
 * Stories and chats are separate providers (stories sit outside chat), so the
 * story side only announces a post here, and `StoryMentionRelay`, which lives
 * inside chat, sends one message per person mentioned.
 *
 * The message is ordinary text - a sentence and a link - so an older build
 * still shows something sensible; this build reads the link and draws the card.
 * It carries the story's id, never its picture: story media is signed for an
 * hour, and the card finds the story in the reader's own tray instead, which is
 * also how it knows the story has run out.
 */

type Listener = (story: Story) => void;
const listeners = new Set<Listener>();

export function announceStoryPosted(story: Story) {
  listeners.forEach((fn) => fn(story));
}

export function onStoryPosted(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Who a story mentions, by user id (mention stickers made before ids were kept are skipped). */
export function mentionedIn(story: Story): string[] {
  const ids = (story.decor?.stickers ?? [])
    .filter((s) => s.type === 'men' && typeof s.d?.uid === 'string')
    .map((s) => s.d.uid as string);
  return [...new Set(ids)].filter((id) => id !== story.authorId);
}

export interface StoryMention {
  storyId: string;
  authorId: string;
}

export function mentionBody(story: Story, authorName: string): string {
  const q = new URLSearchParams({ m: story.id, a: story.authorId });
  return `${authorName} mentioned you in their story\n${publicAppUrl(`/story?${q.toString()}`)}`;
}

const ID = /^[\w.-]{1,64}$/;

export function parseStoryMention(body: string): StoryMention | undefined {
  const match = /https?:\/\/\S+\/story\?(\S+)/.exec(body);
  if (!match) return undefined;
  const q = new URLSearchParams(match[1]);
  const storyId = q.get('m') ?? '', authorId = q.get('a') ?? '';
  return ID.test(storyId) && ID.test(authorId) ? { storyId, authorId } : undefined;
}
