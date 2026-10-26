import { useChat } from '@pingo/core';
import { useEffect, useState } from 'react';

import { onPrivateNotice, refreshPrivateEnabled, startPrivateService, type PrivateNotice } from '../../lib/private/service.js';
import { demoOn } from '../../screens/dev/demo-services.js';

/**
 * Mounted once above every screen. When the feature is on for this person it
 * starts the private-chat service (find a session already running, answer one
 * somebody starts with me) and shows the one line that tells them about it.
 * Off, it does nothing at all.
 */
export function PrivateHost() {
  const { currentUser, conversations } = useChat();
  const userId = currentUser?.id;
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    if (!userId || demoOn()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void refreshPrivateEnabled(userId).then((on) => {
      if (on && !cancelled) stop = startPrivateService(userId);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [userId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onPrivateNotice((n: PrivateNotice) => {
      if (n.kind === 'started' && n.byMe) return;
      const who = conversations.find((c) => c.id === n.conversationId)?.title ?? 'Someone';
      setNotice(n.kind === 'started' ? `${who} started a private chat` : n.byMe ? 'Private chat ended' : `Private chat with ${who} ended`);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(undefined), 4000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [conversations]);

  if (!notice) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[300] flex justify-center px-4"
    >
      <div className="rounded-full bg-[#111113]/95 px-4 py-2 text-[14px] font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur">
        🔒 {notice}
      </div>
    </div>
  );
}
