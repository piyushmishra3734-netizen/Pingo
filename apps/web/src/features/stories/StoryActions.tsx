import { STORY_REACTIONS, useChat, type Story } from '@pingo/core';
import { HeartIcon, SendIcon, cn } from '@pingo/ui';
import { useState } from 'react';

/**
 * The row under a story: like it, react to it, or say something.
 *
 * ## All three are private, and that is the product decision
 *
 * A story has no comments. A like tells the author and nobody else; a reaction
 * and a reply both arrive as ordinary messages in the thread between the two of
 * you. There is deliberately nowhere for a third person to see any of it,
 * because a thing posted for a day should not grow a public conversation
 * attached to it that outlives it.
 *
 * So a reaction is not a new concept - it is a one-emoji message, sent the way
 * every other message is sent, tagged with the story so the thread can say what
 * it is answering.
 *
 * ## Why replying happens here rather than in the chat
 *
 * Sending from inside the viewer keeps the story on screen while you type,
 * which is the whole reason you are replying. The spec's "reply opens the
 * existing chat" is honoured by the message landing in exactly that chat, and
 * a confirmation offers to go there, rather than the viewer throwing you into
 * a different screen mid-story.
 */

export function StoryActions({
  story,
  liked,
  onLike,
  onHold,
  onOpenChat,
}: {
  story: Story;
  liked: boolean;
  onLike: (liked: boolean) => void;
  /** Pauses playback while the composer has focus. Returns the release. */
  onHold: () => () => void;
  /** Offered after a reply lands, so the author's thread is one tap away. */
  onOpenChat: (conversationId: string) => void;
}) {
  const { service, conversations } = useChat();

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string>();
  const [error, setError] = useState<string>();
  const [release, setRelease] = useState<(() => void) | undefined>();

  /** Pauses on focus, resumes on blur. See `useStoryPlayer`. */
  const holdWhileTyping = (holding: boolean) => {
    if (holding) {
      if (!release) setRelease(() => onHold());
      return;
    }
    release?.();
    setRelease(undefined);
  };

  const send = async (body: string) => {
    if (!body.trim() || sending) return;
    setSending(true);
    setError(undefined);
    try {
      /*
       * The existing chat if there is one, a new one if there is not. A story
       * reply is the most common way two people who have never spoken start
       * speaking, so refusing to reply without a prior thread would block the
       * exact case that matters.
       */
      const existing = conversations.find(
        (c) => c.kind === 'direct' && c.participantIds.includes(story.authorId),
      );
      const conversationId = existing?.id ?? (await service.startDirectConversation(story.authorId));

      await service.sendMessage({
        conversationId,
        body: body.trim(),
        storyReply: { storyId: story.id },
      });

      setDraft('');
      setSent(conversationId);
      window.setTimeout(() => setSent(undefined), 4000);
    } catch {
      setError('That did not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      {sent && (
        <div
          role="status"
          className={cn(
            'animate-fade-in flex items-center justify-between gap-3 rounded-full',
            'bg-white/15 px-4 py-2 backdrop-blur-glass',
          )}
        >
          <span className="text-caption text-white">Sent to {story.authorName}</span>
          <button
            type="button"
            onClick={() => onOpenChat(sent)}
            className="focus-ring rounded-full px-2 py-0.5 text-caption font-medium text-white underline"
          >
            Open chat
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-caption text-white">
          {error}
        </p>
      )}

      {/* ---- the five quick reactions ---------------------------------- */}
      <div className="flex items-center justify-center gap-1.5">
        {STORY_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => void send(emoji)}
            aria-label={`React with ${emoji}`}
            className={cn(
              'focus-ring grid size-11 place-items-center rounded-full text-[1.4rem]',
              'transition-transform duration-instant ease-standard',
              'hover:bg-white/10 active:scale-125',
            )}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* ---- reply, and the heart -------------------------------------- */}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => holdWhileTyping(true)}
          onBlur={() => holdWhileTyping(false)}
          placeholder={`Reply to ${story.authorName.split(' ')[0]}…`}
          aria-label={`Reply to ${story.authorName}`}
          maxLength={1000}
          className={cn(
            'focus-ring min-w-0 flex-1 rounded-full border border-white/25 bg-white/10',
            'px-4 py-2.5 text-body text-white placeholder:text-white/60 backdrop-blur-glass',
          )}
        />

        {draft.trim() ? (
          <button
            type="submit"
            disabled={sending}
            aria-label="Send reply"
            className={cn(
              'focus-ring grid size-11 shrink-0 place-items-center rounded-full',
              'bg-brand-gradient text-on-brand shadow-brand',
              'transition-transform duration-instant active:scale-95',
              sending && 'opacity-50',
            )}
          >
            <SendIcon size={20} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onLike(!liked)}
            aria-label={liked ? 'Unlike this story' : 'Like this story'}
            aria-pressed={liked}
            className={cn(
              'focus-ring grid size-11 shrink-0 place-items-center rounded-full',
              'transition-transform duration-instant ease-standard active:scale-125',
              liked ? 'text-danger' : 'text-white hover:bg-white/10',
            )}
          >
            <HeartIcon size={26} fill={liked ? 'currentColor' : 'none'} />
          </button>
        )}
      </form>
    </div>
  );
}
