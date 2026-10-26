import { useChat, type Conversation } from '@pingo/core';
import { useEffect, useRef, type ReactNode } from 'react';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { startPrivateChat, usePrivateEnabled, usePrivateSession } from '../../lib/private/service.js';
import { PINGO_AI_USER_ID } from '../ai/ai-mentions.js';
import { useIsBlocked } from '../safety/blocks.js';
import { PrivateChatView } from './PrivateChatView.js';

/** How far up, how sideways and how quickly a swipe from the typing area counts. */
const UP = 70;
const SIDE = 60;
const WITHIN_MS = 800;
/** The typing area: the strip along the bottom of the thread a swipe has to begin in. */
const STRIP = 130;

/**
 * Wraps a one to one thread. Adds the swipe up from the typing area that starts a
 * private chat, and draws the private chat over the thread while one is on.
 *
 * The thread inside is not edited or aware of any of this. When the feature is
 * off, or the chat is not a plain one to one chat, this renders its children and
 * nothing else.
 */
export function PrivateChatGate({ conversation, children }: { conversation: Conversation; children: ReactNode }) {
  const { currentUser } = useChat();
  const confirm = useConfirm();
  const enabled = usePrivateEnabled();
  const session = usePrivateSession(conversation.id);
  const peerId = conversation.participantIds.find((id) => id !== currentUser?.id);
  const blocked = useIsBlocked(peerId);
  const eligible = enabled && conversation.kind === 'direct' && Boolean(peerId) && peerId !== PINGO_AI_USER_ID && !blocked;
  const box = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !eligible || session) return;
    let from: { x: number; y: number; t: number } | undefined;

    const down = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      from = y > r.bottom - STRIP ? { x, y, t: Date.now() } : undefined;
    };
    const up = (x: number, y: number) => {
      const s = from;
      from = undefined;
      if (!s || busy.current) return;
      if (s.y - y < UP || Math.abs(x - s.x) > SIDE || Date.now() - s.t > WITHIN_MS) return;
      busy.current = true;
      void (async () => {
        try {
          const yes = await confirm({
            title: 'Start a private chat?',
            description: `Messages here are end-to-end encrypted and deleted for both of you when it ends. ${conversation.title} will be told.`,
            confirmLabel: 'Start',
            tone: 'normal',
          });
          if (yes) await startPrivateChat(conversation.id);
        } catch (e) {
          await confirm({ title: 'Could not start it', description: e instanceof Error ? e.message : 'Try again.', confirmLabel: 'OK', tone: 'normal' });
        } finally {
          busy.current = false;
        }
      })();
    };

    const ts = (e: TouchEvent) => down(e.touches[0]!.clientX, e.touches[0]!.clientY);
    const te = (e: TouchEvent) => up(e.changedTouches[0]!.clientX, e.changedTouches[0]!.clientY);
    const md = (e: MouseEvent) => down(e.clientX, e.clientY);
    const mu = (e: MouseEvent) => up(e.clientX, e.clientY);
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchend', te, { passive: true });
    el.addEventListener('mousedown', md);
    el.addEventListener('mouseup', mu);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchend', te);
      el.removeEventListener('mousedown', md);
      el.removeEventListener('mouseup', mu);
    };
  }, [eligible, session, confirm, conversation.id, conversation.title]);

  if (!enabled) return <>{children}</>;
  return (
    <div ref={box} className="relative h-full min-h-0">
      {/* While a private chat is on the normal thread is not mounted at all: no composer, no AI, no mentions, no read receipts. */}
      {session ? <PrivateChatView conversation={conversation} session={session} /> : children}
    </div>
  );
}
