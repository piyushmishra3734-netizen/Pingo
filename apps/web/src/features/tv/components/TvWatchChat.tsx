import { messagePreview, useChat, useMessages, type Conversation } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const LAST_KEY = 'pingo.tv.chat.last';
const REACTIONS = ['😂', '🔥', '😮', '❤️', '👀', '😭'];

/**
 * Chat while the film plays: the same conversations as the Chats tab, inside the
 * player's side panel, so nothing said here is lost and nothing needs
 * re-saying there. It sits under the picture on a phone and beside it on a
 * laptop, which is the whole point: the video stays on screen.
 *
 * When watching along it opens on that friend's chat; otherwise on the last one
 * used here, then the newest.
 */
export function TvWatchChat({ alongId }: { alongId?: string }) {
  const { conversations, currentUser, users } = useChat();

  const chats = useMemo(
    () => conversations.filter((c) => (c.kind === 'direct' || c.kind === 'group') && c.participantIds.length > 1).slice(0, 14),
    [conversations],
  );
  const [pickedId, setPickedId] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(LAST_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });

  const alongChat = alongId ? chats.find((c) => c.kind === 'direct' && c.participantIds.includes(alongId)) : undefined;
  const active: Conversation | undefined = alongChat && pickedId === undefined ? alongChat : chats.find((c) => c.id === pickedId) ?? alongChat ?? chats[0];

  if (!currentUser) return null;
  if (!active) {
    return <p className="px-6 py-12 text-center text-sm text-white/55">Start a chat with a friend and it will show up here.</p>;
  }

  return (
    <div className="flex h-full min-h-[19rem] flex-col">
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chats.map((c) => {
          const on = c.id === active.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              title={c.title}
              onClick={() => {
                setPickedId(c.id);
                try {
                  localStorage.setItem(LAST_KEY, c.id);
                } catch {
                  // Ignore
                }
              }}
              className={cn('inline-flex shrink-0 rounded-full p-0.5 transition', on ? 'ring-2 ring-brand' : 'opacity-60 hover:opacity-100')}
            >
              <Avatar name={c.title} id={c.id} src={c.avatarUrl} size="sm" />
            </button>
          );
        })}
      </div>
      <Thread key={active.id} conversation={active} currentUserId={currentUser.id} users={users} />
    </div>
  );
}

function Thread({ conversation, currentUserId, users }: { conversation: Conversation; currentUserId: string; users: ReturnType<typeof useChat>['users'] }) {
  const { messages, loading, send } = useMessages(conversation.id);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => messages.filter((m) => !m.deleted).slice(-60), [messages]);
  const last = shown[shown.length - 1]?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [last]);

  const submit = (body: string) => {
    const value = body.trim();
    if (!value) return;
    void send(value);
  };

  return (
    <>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:thin]">
        {loading && shown.length === 0 && <p className="py-6 text-center text-xs text-white/45">Loading...</p>}
        {!loading && shown.length === 0 && <p className="py-6 text-center text-xs text-white/45">Say something about what you are watching.</p>}
        {shown.map((m) => {
          const mine = m.authorId === currentUserId;
          const author = mine ? undefined : users.find((u) => u.id === m.authorId);
          return (
            <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
              {!mine && conversation.kind === 'group' && author && <span className="mb-0.5 px-1 text-[11px] text-white/45">{author.name.split(' ')[0]}</span>}
              <span
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13.5px] leading-snug',
                  mine ? 'rounded-br-md bg-brand text-on-brand' : 'rounded-bl-md bg-white/10 text-white',
                  m.status === 'sending' && 'opacity-70',
                )}
              >
                {messagePreview(m, { conversation, currentUserId, users })}
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-white/10 px-3 pb-3 pt-2">
        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" onClick={() => submit(emoji)} className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.07] text-[17px] transition active:scale-90 hover:bg-white/15">
              {emoji}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
            setText('');
          }}
          className="flex items-center gap-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message"
            enterKeyHint="send"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-[14px] text-white outline-none placeholder:text-white/40 focus:ring-2 focus:ring-brand/60"
          />
          <button type="submit" aria-label="Send" disabled={!text.trim()} className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-on-brand transition active:scale-90 disabled:opacity-40">
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </>
  );
}
