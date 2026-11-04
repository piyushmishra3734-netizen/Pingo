import { Button, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import {
  KINDS,
  MAX_LENGTH,
  STATUS_LABEL,
  dayLabel,
  loadMine,
  sendFeedback,
  type FeedbackItem,
  type FeedbackKind,
} from '../../features/feedback/feedback.js';
import { Group, SettingsPage } from '../../features/settings/controls.js';
import { useAppVersion } from '../../features/updates/useAppVersion.js';

/**
 * Wishes and feedback: what to build, what to fix, what you love.
 *
 * It lives in Settings, beside Help, because that is where a person goes when
 * something is not right or not there. Everything the person sends is theirs
 * to read back below the box, with the status the operator gave it, so a
 * message is never a bottle in the sea.
 *
 * What goes with a message: the words, the kind, the app version and whether
 * this is the Android app or the web. No chat content, no device ids. The note
 * under the button says so.
 */

const DRAFT_KEY = 'pingo.feedback.draft';

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* a private window: the draft just does not survive a reload */
  }
}

const STATUS_TONE: Record<FeedbackItem['status'], string> = {
  new: 'bg-hover text-text-secondary',
  seen: 'bg-hover text-text-secondary',
  planned: 'bg-[#2f7cf6]/15 text-[#2f7cf6]',
  done: 'bg-[#22b35e]/15 text-[#22b35e]',
  declined: 'bg-hover text-text-tertiary',
};

export function FeedbackScreen() {
  const app = useAppVersion();
  const [kind, setKind] = useState<FeedbackKind>('wish');
  const [text, setText] = useState(readDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<FeedbackItem[] | undefined>();

  useEffect(() => {
    let live = true;
    void loadMine()
      .then((rows) => {
        if (live) setMine(rows);
      })
      .catch(() => {
        if (live) setMine([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const hint = KINDS.find((k) => k.id === kind)?.hint ?? '';
  const trimmed = text.trim();
  const ready = trimmed.length >= 3 && !busy;

  const onText = (next: string) => {
    setText(next);
    setSent(false);
    setError(null);
    writeDraft(next);
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const row = await sendFeedback({
        kind,
        body: trimmed,
        appVersion: app.version,
        platform: app.native ? 'android' : 'web',
      });
      setMine((rows) => [row, ...(rows ?? [])]);
      setText('');
      writeDraft('');
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPage title="Wishes & feedback">
      <p className="mb-5 px-1 text-body text-text-secondary">
        Tell us what you want PINGO to do, what is broken, or what you love. A real person reads every message.
      </p>

      <Group title="What is it about?">
        <div className="flex flex-wrap gap-2 p-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              aria-pressed={kind === k.id}
              className={cn(
                'rounded-full px-3.5 py-2 text-[14px] transition-colors duration-instant ease-standard',
                kind === k.id ? 'bg-brand text-on-brand' : 'bg-sunken text-text-secondary hover:bg-hover hover:text-ink',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      </Group>

      <Group title="Your message" note="Sent with your app version and whether you are on Android or the web. Nothing from your chats.">
        <div className="p-2">
          <textarea
            value={text}
            onChange={(e) => onText(e.target.value.slice(0, MAX_LENGTH))}
            rows={6}
            maxLength={MAX_LENGTH}
            placeholder={hint}
            aria-label="Your message"
            className="block w-full resize-none rounded-md border border-line bg-page px-3 py-3 text-[16px] leading-snug text-ink outline-none placeholder:text-text-tertiary focus:border-brand"
          />
          <div className="mt-1.5 flex items-center justify-between px-1 text-caption text-text-tertiary">
            <span aria-live="polite" className={cn(error && 'text-[#ef4444]', sent && 'text-[#22b35e]')}>
              {error ?? (sent ? 'Sent. Thank you!' : '')}
            </span>
            <span>
              {text.length}/{MAX_LENGTH}
            </span>
          </div>
        </div>
      </Group>

      <div className="mb-8 px-1">
        <Button type="button" disabled={!ready} onClick={() => void submit()} className="w-full">
          {busy ? 'Sending...' : 'Send'}
        </Button>
      </div>

      {mine && mine.length > 0 && (
        <Group title="What you have sent">
          {mine.map((item) => (
            <div key={item.id} className="px-3 py-3">
              <div className="flex items-center gap-2 text-caption text-text-tertiary">
                <span>{KINDS.find((k) => k.id === item.kind)?.label ?? item.kind}</span>
                <span aria-hidden>·</span>
                <span>{dayLabel(item.created_at)}</span>
                <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[12px] font-medium', STATUS_TONE[item.status])}>
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-body text-ink">{item.body}</p>
            </div>
          ))}
        </Group>
      )}
    </SettingsPage>
  );
}
