import { useChat, useProfile } from '@pingo/core';
import { useEffect } from 'react';

import { isBlocked } from '../safety/blocks.js';
import { mentionBody, mentionedIn, onStoryPosted } from './story-mentions.js';

/**
 * Sends "mentioned you in their story" to everybody a new story mentions, in
 * the chat with them. Mounted once, inside chat; draws nothing.
 */
export function StoryMentionRelay() {
  const { service } = useChat();
  const { profile } = useProfile();
  const name = profile?.username ? `@${profile.username}` : profile?.displayName ?? 'Someone';

  useEffect(
    () =>
      onStoryPosted((story) => {
        for (const id of mentionedIn(story)) {
          if (isBlocked(id)) continue;
          void (async () => {
            try {
              const conversationId = await service.startDirectConversation(id);
              await service.sendMessage({ conversationId, body: mentionBody(story, name) });
            } catch {
              // A mention that could not be delivered is not worth an error over the story that did post.
            }
          })();
        }
      }),
    [service, name],
  );
  return null;
}
