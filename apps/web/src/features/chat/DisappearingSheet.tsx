import { useChat, type Conversation } from '@pingo/core';
import { CheckIcon, cn } from '@pingo/ui';
import { useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import type { MessageKey } from '../i18n/catalog.js';
import { useT } from '../i18n/useT.js';

/**
 * How long a message in this conversation lives.
 *
 * ## Four choices, not a duration picker
 *
 * Off, a day, a week, three months. A field that accepts any number of minutes
 * reads as precision and is really just a decision nobody wants to make; these
 * are the four answers people actually have, and they are WhatsApp's for the
 * same reason.
 *
 * ## Anybody may change it, and everybody is told
 *
 * Not admin-only even in a group - a timer is a decision about what is kept,
 * and the person who most needs one is rarely the one holding the badge. The
 * server posts a system notice naming who changed it and to what, which is what
 * keeps "anybody" from meaning "quietly".
 *
 * ## Never retroactive
 *
 * The line under the options says so, because it is the thing people get wrong
 * about this feature: turning it on does not clear what is already there, and
 * turning it off does not bring anything back.
 */

const CHOICES: Array<{ seconds: number | undefined; key: MessageKey }> = [
  { seconds: undefined, key: 'disappearing.off' },
  { seconds: 86_400, key: 'disappearing.day' },
  { seconds: 604_800, key: 'disappearing.week' },
  { seconds: 7_776_000, key: 'disappearing.ninetyDays' },
];

export interface DisappearingSheetProps {
  conversation: Conversation;
  onClose: () => void;
}

export function DisappearingSheet({ conversation, onClose }: DisappearingSheetProps) {
  const t = useT();
  const { service } = useChat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const current = conversation.disappearSeconds;

  const choose = async (seconds: number | undefined) => {
    if (busy) return;
    if (seconds === current) {
      onClose();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await service.setDisappearing(conversation.id, seconds);
      onClose();
    } catch {
      setError(t('disappearing.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={t('disappearing.title')}
      description={t('disappearing.blurb')}
      onClose={onClose}
    >
      <ul className="flex flex-col gap-0.5">
        {CHOICES.map((choice) => {
          const chosen = choice.seconds === current;
          return (
            <li key={choice.key}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void choose(choice.seconds)}
                className={cn(
                  'focus-ring flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left',
                  'transition-colors duration-instant hover:bg-hover disabled:opacity-60',
                )}
              >
                <span className="min-w-0 flex-1 text-body text-ink">{t(choice.key)}</span>
                {chosen && <CheckIcon size={18} className="shrink-0 text-brand" />}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 px-3 text-caption text-text-tertiary">
        {t('disappearing.notRetroactive')}
      </p>

      {error && <p className="mt-2 px-3 text-caption text-danger">{error}</p>}
    </Sheet>
  );
}
