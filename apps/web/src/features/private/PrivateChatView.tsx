import type { Conversation } from '@pingo/core';
import { ChevronLeftIcon, SendIcon, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { endPrivateChat, retryPrivateMessage, sendPrivateMessage, type PrivateSession } from '../../lib/private/service.js';

/** "2h 41m", "12m", "under a minute": what is left if nobody says anything. */
function left(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  if (m <= 1) return 'under a minute';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/**
 * The private chat, drawn over the normal thread while a session is on.
 *
 * Its own header, list and composer, so nothing in the normal chat is touched or
 * has to know about it. The back arrow at the top left **ends** it for both
 * people, after asking; leaving the screen any other way does not.
 */
export function PrivateChatView({ conversation, session }: { conversation: Conversation; session: PrivateSession }) {
  const confirm = useConfirm();
  const [text, setText] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [session.messages.length]);

  const remaining = session.expiresAt - now;
  const name = conversation.title;

  const end = async () => {
    const yes = await confirm({
      title: 'End private chat?',
      description: `Everything in it is deleted for good, for both of you. ${name} will be told it ended.`,
      confirmLabel: 'End private chat',
    });
    if (!yes) return;
    try {
      await endPrivateChat(conversation.id);
    } catch (e) {
      await confirm({ title: 'Could not end it', description: e instanceof Error ? e.message : 'Try again.', confirmLabel: 'OK', tone: 'normal' });
    }
  };

  const send = () => {
    if (!text.trim()) return;
    sendPrivateMessage(conversation.id, text);
    setText('');
  };

  return (
    <div className="absolute inset-0 z-[120] flex flex-col bg-[#0a0a0d] text-white" role="region" aria-label="Private chat">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => void end()}
          aria-label="End private chat"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 active:scale-95"
        >
          <ChevronLeftIcon size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold leading-tight">{name}</div>
          <div className="truncate text-[12.5px] text-white/60">🔒 Private chat · end-to-end encrypted</div>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
        <p className="mx-auto max-w-xs pb-3 text-center text-[12.5px] leading-snug text-white/50">
          Only you and {name} can read this. When it ends, the messages and the keys are deleted for both of you.
        </p>

        {session.unreadable && (
          <p className="mx-auto max-w-xs rounded-2xl bg-white/10 px-4 py-3 text-center text-[13.5px] text-white/80">
            This private chat was started on another device, so this one cannot read it. You can end it with the back arrow.
          </p>
        )}
        {!session.ready && !session.unreadable && (
          <p className="mx-auto max-w-xs rounded-2xl bg-white/10 px-4 py-3 text-center text-[13.5px] text-white/80">
            Waiting for {name} to open Pingo. What you write is held on this phone, not sent, until they do. If you close Pingo before then, it is lost.
          </p>
        )}

        {session.messages.map((m) => (
          <div key={m.id} className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[78%] whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 text-[15.5px] leading-snug',
                m.mine ? 'rounded-br-md bg-white text-black' : 'rounded-bl-md bg-white/12 text-white',
                m.status === 'sending' && 'opacity-60',
              )}
            >
              {m.text}
              {m.status === 'failed' && (
                <button type="button" onClick={() => retryPrivateMessage(conversation.id, m.id)} className="mt-0.5 block text-[12px] font-semibold text-[#e5544b]">
                  Not sent. Tap to retry
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {remaining < 5 * 60_000 && (
        <div className="shrink-0 bg-[#3a2d14] px-4 py-2 text-center text-[13px] text-[#ffeccb]">
          Ends in {left(remaining)}. Send a message to keep it going.
        </div>
      )}

      <div className="flex shrink-0 items-end gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={session.unreadable}
          rows={1}
          maxLength={4000}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder="Private message"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] border border-white/10 bg-white/8 px-4 py-2.5 text-[16px] text-white outline-none placeholder:text-white/40 focus:border-white/30"
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || session.unreadable}
          aria-label="Send"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-black transition active:scale-95 disabled:opacity-30"
        >
          <SendIcon size={20} />
        </button>
      </div>
    </div>
  );
}
