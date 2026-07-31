import type { Message } from '@pingo/core';
import { ChevronLeftIcon, cn } from '@pingo/ui';
import { useMemo } from 'react';

/**
 * Level 2: the categorised sheet behind `More`.
 *
 * docs/13 § 1.2 - the category headers never move and never hide, which is what
 * lets a returning thumb find Star without reading. What sits *inside* a
 * category may come and go freely, because the header above it is the landmark.
 *
 * ## Hiding versus disabling
 *
 * docs/13 § 3: hide what was never yours, explain what expired.
 *
 * Delete-for-everyone on someone else's message is hidden - you never had it,
 * so you will not look for it. Nothing here expires any more: editing and
 * deleting your own message have no time limit, because what protects a reader
 * is knowing the message changed, and both changes are marked. `disabledReason`
 * stays because the *rule* still holds for whatever expires next.
 *
 * ## Contextual AI
 *
 * § 4 - no header, no fixed position, present only when the message earns it.
 * That is what keeps it invisible rather than merely optional: four permanent
 * extra rows would be the AI tab again, scattered.
 */

interface Item {
  label: string;
  /** Present means the row is shown but cannot be used, and says why. */
  disabledReason?: string;
  onSelect: () => void;
}

interface Category {
  icon: string;
  title: string;
  items: Item[];
}

export interface MoreSheetProps {
  message: Message;
  /** Whether the viewer wrote it - decides what was ever theirs to do. */
  mine: boolean;
  onBack: () => void;
  onDone: () => void;
  actions: {
    pin: () => void;
    star: () => void;
    remind: () => void;
    edit: () => void;
    deleteForMe: () => void;
    deleteForEveryone: () => void;
    forward: () => void;
    share: () => void;
    save: () => void;
    info: () => void;
    jumpToOriginal: () => void;
    report: () => void;
    translate: () => void;
    speak: () => void;
  };
}

export function MoreSheet({ message, mine, onBack, onDone, actions }: MoreSheetProps) {
  const categories = useMemo<Category[]>(() => {
    const hasMedia = Boolean(message.ping ?? message.sticker);

    const run = (fn: () => void) => () => {
      fn();
      onDone();
    };

    const edit: Item[] = [];
    if (mine) {
      /*
       * No time limit. The window was removed because the thing that protects a
       * reader is knowing a message changed, not the change becoming impossible
       * - and every edit is marked, every delete leaves a tombstone.
       */
      edit.push({ label: 'Edit', onSelect: run(actions.edit) });
    }
    edit.push({ label: 'Delete for me', onSelect: run(actions.deleteForMe) });
    if (mine) {
      edit.push({ label: 'Delete for everyone', onSelect: run(actions.deleteForEveryone) });
    }

    const share: Item[] = [
      { label: 'Forward', onSelect: run(actions.forward) },
      { label: 'Share', onSelect: run(actions.share) },
    ];
    // Nothing to save on a text message, and it was never yours to expect.
    if (hasMedia) share.push({ label: 'Save', onSelect: run(actions.save) });

    const about: Item[] = [{ label: 'Info', onSelect: run(actions.info) }];
    if (message.replyToId) {
      about.push({ label: 'Jump to original', onSelect: run(actions.jumpToOriginal) });
    }
    if (!mine) about.push({ label: 'Report', onSelect: run(actions.report) });

    return [
      {
        icon: '⭐',
        title: 'Organise',
        items: [
          { label: 'Pin', onSelect: run(actions.pin) },
          { label: 'Star', onSelect: run(actions.star) },
          { label: 'Remind me', onSelect: run(actions.remind) },
        ],
      },
      { icon: '✏️', title: 'Edit', items: edit },
      { icon: '📤', title: 'Share', items: share },
      { icon: '🔍', title: 'About', items: about },
    ];
  }, [message, mine, actions, onDone]);

  /*
   * The AI group sits above the fixed categories, has no header, and is absent
   * when nothing applies. § 4 - Translate only on text that is not the reader's
   * language, Speak only where there is something to read aloud.
   */
  const ai = useMemo<Item[]>(() => {
    const items: Item[] = [];
    const text = message.body.trim();
    if (!text) return items;

    if (isForeign(text)) items.push({ label: 'Translate', onSelect: actions.translate });
    items.push({ label: 'Speak message', onSelect: actions.speak });
    return items;
  }, [message.body, actions]);

  return (
    <div
      role="menu"
      aria-label="More actions"
      className="bg-surface border border-line max-h-[60vh] w-60 overflow-y-auto rounded-xl py-1 shadow-lg"
    >
      <button
        type="button"
        onClick={onBack}
        className={cn(
          'focus-ring flex w-full items-center gap-2 px-3 py-2.5',
          'text-caption text-text-secondary hover:bg-hover',
        )}
      >
        <ChevronLeftIcon size={15} />
        Back
      </button>

      {ai.length > 0 && (
        <Group items={ai} />
      )}

      {categories.map((category) => (
        <div key={category.title}>
          <p className="px-3 pt-2 pb-1 text-caption font-medium text-text-tertiary">
            <span aria-hidden className="mr-1.5">
              {category.icon}
            </span>
            {category.title}
          </p>
          <Group items={category.items} />
        </div>
      ))}
    </div>
  );
}

function Group({ items }: { items: Item[] }) {
  return (
    <>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={Boolean(item.disabledReason)}
          onClick={item.onSelect}
          className={cn(
            'focus-ring flex w-full items-baseline gap-2 px-3 py-2 text-left',
            'text-body text-ink transition-colors duration-instant',
            'hover:bg-hover active:bg-pressed',
            item.disabledReason && 'cursor-default text-text-tertiary hover:bg-transparent',
          )}
        >
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.disabledReason && (
            <span className="shrink-0 text-caption text-text-tertiary">
              {item.disabledReason}
            </span>
          )}
        </button>
      ))}
    </>
  );
}

/**
 * A rough guess at "not the reader's language".
 *
 * Deliberately crude: if the text carries script the reader's locale does not
 * use, offering a translation is obviously useful. Anything subtler needs real
 * language detection, and guessing wrong here shows a Translate row on a
 * message that plainly does not need one, which is the noise § 4 exists to
 * prevent.
 */
function isForeign(text: string): boolean {
  const locale = navigator.language.slice(0, 2);
  const nonLatin = /[؀-ۿऀ-ॿ一-鿿぀-ヿ가-힯]/.test(
    text,
  );
  const latinReader = !['ar', 'hi', 'zh', 'ja', 'ko'].includes(locale);
  return nonLatin === latinReader;
}
