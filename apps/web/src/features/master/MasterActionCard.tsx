import { useChat } from '@pingo/core';
import { cn } from '@pingo/ui';
import { BellOff, BellRing, CalendarClock, Check, MessageSquareShare, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppLanguage } from '../i18n/useT.js';
import { usePreferences } from '../settings/SettingsContext.js';
import { applySetting, describeSetting } from './applySetting.js';
import { approve, cancel, decline, loadAction, sayError, whenLabel, type MasterAction } from './master.js';

/**
 * The card under PINGO AI's reply when it proposed something: what it will do,
 * to whom, when, and what it costs, with Approve and Not now.
 *
 * Approving is this button and nothing else. It is a call from the person's own
 * session to the database, so no sentence anyone writes in a chat can press it.
 * What runs is the row that was approved, not a fresh request from the model.
 */

/** "Unmuted for 2 hours, then muted again", in the words the person would use. */
function describeMute(mode: 'mute' | 'unmute' | undefined, minutes = 0): string {
  const span = minutes % 1440 === 0 && minutes >= 1440 ? `${minutes / 1440} day${minutes === 1440 ? '' : 's'}` : minutes % 60 === 0 && minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (mode === 'unmute') return minutes > 0 ? `Unmuted for ${span}, then muted again` : 'Unmuted';
  return minutes > 0 ? `Muted for ${span}` : 'Muted until you unmute it';
}

export function MasterActionCard({ id }: { id: string }) {
  const [action, setAction] = useState<MasterAction | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [undo, setUndo] = useState<() => void>();
  const { conversations } = useChat();
  const settings = usePreferences();
  const { setLanguage } = useAppLanguage();
  // The latest settings, for an approval that lands a moment after the click.
  const api = useRef({ ...settings, setLanguage });
  api.current = { ...settings, setLanguage };

  useEffect(() => {
    let live = true;
    void loadAction(id).then((row) => live && setAction(row));
    return () => {
      live = false;
    };
  }, [id]);

  const decide = useCallback(
    async (go: () => Promise<MasterAction | void>) => {
      setBusy(true);
      setError(undefined);
      try {
        const next = await go();
        if (next) {
          setAction(next);
          // A setting is changed here, by the app, the moment it is approved.
          if (next.kind === 'set_setting' && next.status === 'done' && next.params.key && next.params.value) {
            setUndo(() => applySetting(api.current, next.params.key!, next.params.value!));
          }
        } else {
          setAction(await loadAction(id));
        }
      } catch (e) {
        setError(sayError(e instanceof Error ? e.message : undefined));
        setAction(await loadAction(id));
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  if (action === undefined) return <div className="mt-2 h-24 w-[min(20rem,80vw)] animate-pulse rounded-2xl bg-hover" aria-hidden />;
  if (action === null) return null;

  const isMessage = action.kind === 'send_message';
  const isMute = action.kind === 'mute_chat';
  const chat = isMessage || isMute ? conversations.find((c) => c.id === action.params.conversation_id) : undefined;
  const title = isMute
    ? `${action.params.mode === 'unmute' ? 'Unmute' : 'Mute'} ${chat ? chat.title : 'a chat'}`
    : isMessage
      ? `Message ${chat ? chat.title : 'a chat'}`
      : 'Change a setting';
  const Icon = isMute
    ? action.params.mode === 'unmute'
      ? BellRing
      : BellOff
    : isMessage
      ? action.run_at
        ? CalendarClock
        : MessageSquareShare
      : SlidersHorizontal;
  const pending = action.status === 'pending' && new Date(action.expires_at) > new Date();

  const state =
    action.status === 'done'
      ? { text: isMessage ? 'Sent' : 'Done', tone: 'text-brand' }
      : action.status === 'scheduled'
        ? { text: `Scheduled for ${whenLabel(action.run_at)}`, tone: 'text-brand' }
        : action.status === 'pending' && !pending
          ? { text: 'Expired. Ask again.', tone: 'text-text-tertiary' }
          : action.status === 'pending'
            ? undefined
            : {
                text: action.status === 'failed' ? (action.result ?? 'Could not be done') : action.status === 'declined' ? 'Not now' : action.status === 'cancelled' ? 'Cancelled' : 'Expired. Ask again.',
                tone: action.status === 'failed' ? 'text-danger' : 'text-text-tertiary',
              };

  return (
    <div className="mt-2 flex w-[min(20rem,80vw)] flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5 text-ink shadow-sm motion-safe:animate-panel-in">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/12 text-brand">
          <Icon size={16} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14.5px] font-semibold">{title}</span>
          <span className="text-caption text-text-secondary">
            {isMessage ? `Sends ${whenLabel(action.run_at)}` : 'Applies right away'} · {action.credits} credits
          </span>
        </span>
      </div>

      <p className="whitespace-pre-wrap break-words rounded-xl bg-hover px-3 py-2 text-[14.5px] leading-snug">
        {isMute ? describeMute(action.params.mode, action.params.minutes) : isMessage ? action.params.text : describeSetting(action.params.key, action.params.value)}
      </p>

      {pending && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide(async () => void (await decline(id)))}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border border-line text-[14px] text-ink transition-colors duration-instant ease-standard hover:bg-hover focus-ring disabled:opacity-50"
          >
            <X size={15} aria-hidden /> Not now
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide(() => approve(id))}
            className="flex h-10 flex-[1.4] items-center justify-center gap-1.5 rounded-full bg-brand text-[14px] font-medium text-white transition-opacity duration-instant ease-standard active:opacity-80 focus-ring disabled:opacity-60"
          >
            <Check size={15} aria-hidden /> {busy ? 'Working…' : 'Approve'}
          </button>
        </div>
      )}

      {state && (
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-caption font-medium', state.tone)}>{state.text}</span>
          {action.status === 'scheduled' && (
            <button type="button" disabled={busy} onClick={() => void decide(async () => void (await cancel(id)))} className="rounded-full px-2.5 py-1 text-caption font-medium text-danger hover:bg-hover focus-ring">
              Cancel
            </button>
          )}
          {undo && action.status === 'done' && (
            <button
              type="button"
              onClick={() => {
                undo();
                setUndo(undefined);
              }}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-caption font-medium text-brand hover:bg-hover focus-ring"
            >
              <Undo2 size={13} aria-hidden /> Undo
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
