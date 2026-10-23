import { useChat } from '@pingo/core';
import { ChevronLeft, Lock, LockKeyhole } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { ConversationRow } from '../conversations/ConversationRow.js';
import { PinGate } from './PinGate.js';
import { loadLocks, relock, touchSession, useLockedIds, useUnlocked } from './lock-store.js';

/**
 * Locked chats: the chats the person has put behind their PIN.
 *
 * Opens on the PIN pad. Once it is open the chats are an ordinary list, with the
 * one difference that this is the only list that shows them. "Lock now" closes
 * it again without waiting for the session to run out.
 */
export function LockedChatsScreen() {
  const { conversations, ready } = useChat();
  const ids = useLockedIds();
  const unlocked = useUnlocked();
  const navigate = useNavigate();

  useEffect(() => void loadLocks(), []);

  // Keep the session alive while this screen is in use.
  useEffect(() => {
    if (!unlocked) return;
    touchSession();
    const id = setInterval(touchSession, 30_000);
    return () => clearInterval(id);
  }, [unlocked]);

  const locked = useMemo(
    () => conversations.filter((c) => ids.has(c.id)).sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations, ids],
  );

  if (!unlocked) return <PinGate onSuccess={() => undefined} onCancel={() => navigate('/chats', { replace: true })} />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" aria-label="Back" onClick={() => navigate('/chats')} className="grid size-10 place-items-center rounded-full text-ink hover:bg-hover focus-ring">
          <ChevronLeft size={24} aria-hidden />
        </button>
        <h1 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
          <Lock size={16} strokeWidth={2} aria-hidden /> Locked chats
        </h1>
        <button
          type="button"
          onClick={() => {
            relock();
            navigate('/chats', { replace: true });
          }}
          className="rounded-full px-3 py-1.5 text-[14px] font-medium text-brand hover:bg-hover focus-ring"
        >
          Lock now
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {ready && locked.length === 0 ? (
          <div className="mx-auto flex max-w-xs flex-col items-center gap-3 px-6 pt-24 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-hover text-text-secondary">
              <LockKeyhole size={26} strokeWidth={1.7} aria-hidden />
            </span>
            <p className="text-[17px] font-semibold text-ink">Nothing locked</p>
            <p className="text-[14px] leading-snug text-text-secondary">Hold a chat in your list, tap the three dots and choose Lock chat.</p>
          </div>
        ) : (
          <>
            {locked.map((c) => (
              <ConversationRow key={c.id} conversation={c} />
            ))}
            <p className="mx-auto mt-5 max-w-xs px-4 text-center text-[12.5px] leading-snug text-text-tertiary">
              These chats are hidden from your chat list and search, and their notifications show no name or message.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
