import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MESSAGE_TOAST_DURATION_MS,
  MESSAGE_TOAST_EXIT_MS,
  MessageToast,
  type MessageToastData,
  type MessageToastMotion,
} from '../../features/notifications/MessageToast.js';

/**
 * Dev-only pressure test: Instagram-style slide + sequential queue.
 * Open at `/dev/toast-lab` in development.
 */

interface LiveToast extends MessageToastData {
  motion: MessageToastMotion;
}

interface ScriptedMessage {
  afterMs: number;
  conversationId: string;
  senderId: string;
  senderName: string;
  preview: string;
  groupTitle?: string;
}

const PEOPLE = {
  anaya: { id: 'u-anaya', name: 'Anaya Sharma' },
  kabir: { id: 'u-kabir', name: 'Kabir Mehta' },
  riya: { id: 'u-riya', name: 'Riya Kapoor' },
  alex: { id: 'u-alex', name: 'Alex Chen' },
  zara: { id: 'u-zara', name: 'Zara N.' },
} as const;

const SCRIPT: ScriptedMessage[] = [
  { afterMs: 800, conversationId: 'c-anaya', senderId: PEOPLE.anaya.id, senderName: PEOPLE.anaya.name, preview: 'Are you free for coffee after 4?' },
  { afterMs: 4200, conversationId: 'c-anaya', senderId: PEOPLE.anaya.id, senderName: PEOPLE.anaya.name, preview: 'That new place near the lake' },
  { afterMs: 3800, conversationId: 'c-kabir', senderId: PEOPLE.kabir.id, senderName: PEOPLE.kabir.name, preview: 'Sent the deck. Page 6 has the numbers.' },
  { afterMs: 7000, conversationId: 'c-riya', senderId: PEOPLE.riya.id, senderName: PEOPLE.riya.name, preview: 'Photo' },
  { afterMs: 3500, conversationId: 'c-riya', senderId: PEOPLE.riya.id, senderName: PEOPLE.riya.name, preview: 'look at this sky 😭' },
  { afterMs: 5000, conversationId: 'c-design', senderId: PEOPLE.alex.id, senderName: PEOPLE.alex.name, preview: 'Shipping the auth polish tonight', groupTitle: 'Design Team' },
  { afterMs: 1800, conversationId: 'c-design', senderId: PEOPLE.zara.id, senderName: PEOPLE.zara.name, preview: 'I can review in an hour', groupTitle: 'Design Team' },
  { afterMs: 2200, conversationId: 'c-design', senderId: PEOPLE.alex.id, senderName: PEOPLE.alex.name, preview: 'Perfect, leave notes on the PR', groupTitle: 'Design Team' },
  { afterMs: 4500, conversationId: 'c-kabir', senderId: PEOPLE.kabir.id, senderName: PEOPLE.kabir.name, preview: 'Can you jump on a 10 min call?' },
  { afterMs: 900, conversationId: 'c-anaya', senderId: PEOPLE.anaya.id, senderName: PEOPLE.anaya.name, preview: 'Also bring the charger if you can' },
  { afterMs: 6000, conversationId: 'c-anaya', senderId: PEOPLE.anaya.id, senderName: PEOPLE.anaya.name, preview: 'Home safe. Night 🌙' },
];

const FAKE_ROWS = [
  { name: 'Anaya Sharma', preview: 'Are you free for coffee after 4?', time: 'now', unread: 2 },
  { name: 'Design Team', preview: 'Alex: Shipping the auth polish…', time: '2m', unread: 3 },
  { name: 'Kabir Mehta', preview: 'Sent the deck. Page 6…', time: '5m', unread: 0 },
  { name: 'Riya Kapoor', preview: 'look at this sky 😭', time: '12m', unread: 1 },
  { name: 'Alex Chen', preview: 'You free tomorrow morning?', time: '1h', unread: 0 },
  { name: 'Zara N.', preview: 'Loved the motion on that sheet', time: '3h', unread: 0 },
];

export function ToastFeelLab() {
  const [active, setActive] = useState<LiveToast | undefined>();
  const [running, setRunning] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<MessageToastData | undefined>(undefined);
  const unreadByConv = useRef(new Map<string, number>());
  const scriptIndex = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;

  const note = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 40));
  }, []);

  const showNext = useCallback((data: MessageToastData) => {
    const live: LiveToast = { ...data, motion: 'enter' };
    activeRef.current = live;
    setActive(live);
  }, []);

  const beginExit = useCallback(
    (id: string) => {
      const current = activeRef.current;
      if (!current || current.id !== id || current.motion === 'exit') return;
      const leaving: LiveToast = { ...current, motion: 'exit' };
      activeRef.current = leaving;
      setActive(leaving);

      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = undefined;
        if (activeRef.current?.id === id) {
          activeRef.current = undefined;
          setActive(undefined);
        }
        const next = pendingRef.current;
        pendingRef.current = undefined;
        if (next) {
          note(`next   after leave`);
          requestAnimationFrame(() => showNext(next));
        }
      }, MESSAGE_TOAST_EXIT_MS);
    },
    [note, showNext],
  );

  const present = useCallback(
    (data: MessageToastData, label: string) => {
      const current = activeRef.current;

      if (current && current.motion !== 'exit' && current.conversationId === data.conversationId) {
        note(`update ${label}`);
        const live: LiveToast = {
          ...current,
          ...data,
          id: current.id,
          unreadCount: Math.max(current.unreadCount + 1, data.unreadCount),
          motion: 'update',
        };
        activeRef.current = live;
        setActive(live);
        return;
      }

      if (current) {
        note(`queue  ${label}`);
        pendingRef.current = data;
        return;
      }

      note(`enter  ${label}`);
      showNext(data);
    },
    [note, showNext],
  );

  const pushMessage = useCallback(
    (item: ScriptedMessage) => {
      const count = (unreadByConv.current.get(item.conversationId) ?? 0) + 1;
      unreadByConv.current.set(item.conversationId, count);
      const firstName = item.senderName.split(' ')[0] ?? item.senderName;
      const title = item.groupTitle ? `${firstName} · ${item.groupTitle}` : item.senderName;
      const now = Date.now();
      present(
        {
          id: item.conversationId,
          conversationId: item.conversationId,
          title,
          preview: item.preview,
          createdAt: now,
          senderName: item.senderName,
          senderId: item.senderId,
          unreadCount: count,
          generation: now,
        },
        `${title}: ${item.preview}`,
      );
    },
    [present],
  );

  useEffect(() => {
    if (!running) return;
    const step = () => {
      const item = SCRIPT[scriptIndex.current];
      if (!item) {
        scriptIndex.current = 0;
        unreadByConv.current.clear();
        setCycle((c) => c + 1);
        note('—— cycle complete ——');
        timerRef.current = setTimeout(step, 4000);
        return;
      }
      timerRef.current = setTimeout(() => {
        pushMessage(item);
        scriptIndex.current += 1;
        step();
      }, item.afterMs);
    };
    step();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [running, pushMessage, note, cycle]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  return (
    <div className="relative h-full overflow-hidden bg-page text-ink">
      <div className="mx-auto flex h-full max-w-lg flex-col">
        <header className="glass-surface shrink-0 border-b border-line px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <p className="text-caption text-text-tertiary">PINGO · toast lab · slide + queue</p>
          <h1 className="text-h2 font-medium">Chats</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {FAKE_ROWS.map((row) => (
            <div
              key={row.name}
              className="flex items-center gap-3 border-b border-line/60 px-4 py-3"
            >
              <div className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-wash text-caption font-medium text-brand">
                {row.name
                  .split(' ')
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-body ${row.unread ? 'font-medium' : ''}`}>{row.name}</p>
                <p className="truncate text-caption text-text-secondary">{row.preview}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-line bg-surface/80 px-4 py-3 text-caption text-text-secondary">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-brand-gradient px-3 py-1.5 text-caption font-medium text-white"
              onClick={() => setRunning((r) => !r)}
            >
              {running ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-3 py-1.5"
              onClick={() => {
                setActive(undefined);
                activeRef.current = undefined;
                pendingRef.current = undefined;
                note('cleared');
              }}
            >
              Clear
            </button>
            <span className="text-text-tertiary">cycle {cycle + 1}</span>
          </div>
          <ol className="mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11px] text-text-tertiary">
            {log.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      </div>

      {active && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[280] flex justify-center px-3"
          style={{ top: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
          data-toast-lab-stack
        >
          <div className="w-full max-w-[26rem] md:max-w-[28rem]">
            <MessageToast
              key={active.id}
              toast={active}
              motion={active.motion}
              durationMs={MESSAGE_TOAST_DURATION_MS}
              onOpen={(id) => {
                note(`open ${id}`);
                beginExit(id);
              }}
              onDismiss={(id) => {
                note(`dismiss ${id}`);
                beginExit(id);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
