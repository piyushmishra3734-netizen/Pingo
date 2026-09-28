import { useChat, type Story } from '@pingo/core';
import { cn } from '@pingo/ui';
import { Heart, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useStories } from './StoryContext.js';

/**
 * The foot of somebody else's story, the stories sample's: "Send message", the
 * heart, and Send. Focusing the reply holds the story and lays the quick
 * reactions over it; a reply or a reaction goes to your chat with them.
 */
export function StoryActions({
  story,
  liked,
  onLike,
  onHold,
  onTyping,
  onSend,
  overlayHost,
}: {
  story: Story;
  liked: boolean;
  onLike: (liked: boolean) => void;
  onHold: () => () => void;
  /** The reply box is open: the viewer steps its stickers back. */
  onTyping: (typing: boolean) => void;
  /** The paper plane: Send to. */
  onSend: () => void;
  /** Where the quick reactions are laid: over the whole story, above the foot. */
  overlayHost: HTMLElement | null;
}) {
  const { service, conversations } = useChat();
  const { notify } = useStories();
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const release = useRef<(() => void) | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  const type = (on: boolean) => {
    if (on) release.current ??= onHold();
    else { release.current?.(); release.current = undefined; }
    setTyping(on); onTyping(on);
  };

  const deliver = async (body: string) => {
    const existing = conversations.find((c) => c.kind === 'direct' && c.participantIds.includes(story.authorId));
    const conversationId = existing?.id ?? (await service.startDirectConversation(story.authorId));
    await service.sendMessage({ conversationId, body, storyReply: { storyId: story.id } });
  };
  const reply = () => {
    const body = draft.trim(); if (!body) return;
    setDraft(''); input.current?.blur(); type(false);
    deliver(body).then(() => notify(`Reply sent to ${story.authorName}`, <Send />), () => notify('That did not send', <Send />));
  };
  const react = (emoji: string) => {
    burst(emoji);
    setDraft(''); input.current?.blur(); type(false);
    deliver(emoji).then(() => notify('Reaction sent', <Send />), () => notify('That did not send', <Send />));
  };

  return (
    <>
      {typing && overlayHost && createPortal(
        <div className="absolute inset-x-0 top-0 bottom-16 z-[6] flex flex-col items-center justify-center gap-4 bg-black/72 text-white"
          style={{ animation: 'sv-fade .2s' }}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onPointerUp={(e) => e.stopPropagation()}>
          <h5 className="mb-1 text-[15px] font-semibold">Quick reactions</h5>
          <div className="grid grid-cols-[repeat(4,64px)] gap-3.5">
            {QUICK.map((emoji) => (
              <button key={emoji} type="button" aria-label={`React with ${emoji}`} onClick={() => react(emoji)}
                className="text-[40px] transition-transform duration-150 active:scale-125">{emoji}</button>
            ))}
          </div>
        </div>,
        overlayHost,
      )}
      <label className="flex h-11 min-w-0 flex-1 items-center rounded-[22px] px-4 text-[14.5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.55)]">
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => type(true)}
          onBlur={() => window.setTimeout(() => { if (!input.current?.value) type(false); }, 120)}
          onKeyDown={(e) => { if (e.key === 'Enter') reply(); }}
          placeholder="Send message"
          enterKeyHint="send"
          aria-label={`Reply to ${story.authorName}`}
          maxLength={1000}
          className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/85"
        />
      </label>
      <button type="button" aria-label="Like" aria-pressed={liked}
        onClick={(e) => { if (!liked) hearts(e.currentTarget); onLike(!liked); }}
        className={cn('relative grid size-[38px] shrink-0 place-items-center [&>svg]:size-[26px]', liked && 'text-danger')}>
        <Heart fill={liked ? '#ff3040' : 'none'} style={liked ? { animation: 'sv-pop .45s cubic-bezier(.34,1.56,.64,1)' } : undefined} />
      </button>
      <button type="button" aria-label="Send" onClick={onSend} className="grid size-[38px] shrink-0 place-items-center [&>svg]:size-[26px]"><Send /></button>
    </>
  );
}

const QUICK = ['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'];

/** A reaction sent: the emoji rises up the screen, a few at once. */
function burst(emoji: string) {
  for (let i = 0; i < 9; i += 1) {
    const n = document.createElement('span');
    n.textContent = emoji;
    n.style.cssText = `position:fixed;z-index:2000;left:${10 + Math.random() * 75}%;bottom:60px;font-size:38px;pointer-events:none`;
    document.body.append(n);
    void n.animate(
      [{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { opacity: 1, offset: 0.1 }, { transform: `translate(${(Math.random() - 0.5) * 120}px, -620px) scale(1.2) rotate(${(Math.random() - 0.5) * 60}deg)`, opacity: 0 }],
      { duration: 1600, delay: i * 70, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' },
    ).finished.then(() => n.remove());
  }
}

/** A like: small hearts lift off the button. */
function hearts(from: HTMLElement) {
  for (let i = 0; i < 6; i += 1) {
    const n = document.createElement('span');
    n.textContent = '♥';
    n.style.cssText = 'position:absolute;left:50%;top:0;color:#ff3040;font-size:14px;pointer-events:none';
    from.append(n);
    void n.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${(Math.random() - 0.5) * 60}px, -90px) scale(1.4)`, opacity: 0 }],
      { duration: 900, delay: i * 60, easing: 'ease-out', fill: 'both' }).finished.then(() => n.remove());
  }
}
