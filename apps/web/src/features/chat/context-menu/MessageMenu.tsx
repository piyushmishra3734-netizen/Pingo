import { useChat, type Message } from '@pingo/core';
import { useCallback, useState } from 'react';

import { MessageActions } from './MessageActions.js';
import { MessageContextMenu } from './MessageContextMenu.js';
import { MoreSheet } from './MoreSheet.js';
import { ReactionBar } from './ReactionBar.js';
import { useMessageMenu } from './useMenuTriggers.js';

/**
 * The whole context menu, assembled.
 *
 * One component, four ways in — docs/13 § 4.5. It owns the two things that
 * cross the pieces: which level is showing, and whether a reaction is in
 * flight, because both the bar and the pills need to know.
 *
 * ## Why the reaction call lives here rather than in the bar
 *
 * The bar and the pills both toggle, and the in-flight guard has to cover both
 * or a user can tap the bar and a pill in the same instant. One owner, one
 * guard.
 */

export interface MessageMenuProps {
  message: Message;
  mine: boolean;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  /** The bubble, rendered again inside the menu so it can be lifted. */
  children: React.ReactNode;
  /** The same bubble in the thread — hidden while the menu holds a copy. */
  render: (
    handlers: ReturnType<typeof useMessageMenu>['handlers'] & { hidden: boolean },
  ) => React.ReactNode;
}

export function MessageMenu({
  message,
  mine,
  onReply,
  onForward,
  children,
  render,
}: MessageMenuProps) {
  const { service, currentUser } = useChat();

  const [level, setLevel] = useState<'actions' | 'more'>('actions');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const react = useCallback(
    async (emoji: string) => {
      // One guard for both surfaces; repeated taps cannot stack up.
      if (busy) return;
      setBusy(true);
      setError(undefined);
      try {
        await service.toggleReaction(message.id, emoji);
        // Light, and only once it landed — a haptic on tap would confirm
        // something that had not happened yet.
        navigator.vibrate?.(4);
      } catch {
        // The service has already rolled its cache back, so the pills return to
        // the previous state on their own; this only says why.
        setError('Reaction failed');
        window.setTimeout(() => setError(undefined), 2200);
      } finally {
        setBusy(false);
      }
    },
    [busy, service, message.id],
  );

  const menu = useMessageMenu((emoji) => void react(emoji));

  const level2 = useLevel2(message, service, (why) => {
    setError(why);
    window.setTimeout(() => setError(undefined), 2200);
  });

  const close = useCallback(() => {
    menu.close();
    // Reset so the next open starts at Level 1 rather than wherever it ended.
    setLevel('actions');
  }, [menu]);

  const myReaction = currentUser
    ? message.reactions.find((r) => r.userIds.includes(currentUser.id))?.emoji
    : undefined;

  return (
    <>
      {render({ ...menu.handlers, hidden: Boolean(menu.open) })}

      {error && (
        <p role="alert" className="mt-1 text-caption text-danger">
          {error}
        </p>
      )}

      {menu.open && (
        <MessageContextMenu
          anchor={menu.open.anchor}
          touch={menu.open.touch}
          onDismiss={close}
          reactions={
            level === 'actions' ? (
              <ReactionBar
                {...(myReaction ? { mine: myReaction } : {})}
                onReact={(emoji) => {
                  void react(emoji);
                  close();
                }}
                onOpenPicker={() => setLevel('more')}
              />
            ) : null
          }
          actions={
            level === 'actions' ? (
              <MessageActions
                message={message}
                onReply={onReply}
                onForward={onForward}
                onMore={() => setLevel('more')}
                onDone={close}
              />
            ) : (
              <MoreSheet
                message={message}
                mine={mine}
                onBack={() => setLevel('actions')}
                onDone={close}
                actions={level2}
              />
            )
          }
        >
          {children}
        </MessageContextMenu>
      )}
    </>
  );
}

/**
 * Level 2's handlers.
 *
 * Split by where the work happens, because that is the only distinction that
 * matters here: the server owns anything with a rule attached — the edit
 * window, who may delete for everyone — and the platform owns the rest.
 *
 * Nothing is optimistic. These are deliberate, one-off actions, and a star that
 * appears and then un-appears is worse than one that takes a moment.
 */
function useLevel2(
  message: Message,
  service: ReturnType<typeof useChat>['service'],
  onFail: (why: string) => void,
) {
  const guard = (what: string, run: () => Promise<unknown>) => () => {
    void run().catch(() => onFail(`${what} failed`));
  };

  return {
    pin: guard('Pin', () => service.togglePin(message.id)),
    star: guard('Star', () => service.toggleStar(message.id)),
    // An hour is the only interval worth offering without a picker; anything
    // else is a date field, and that is a screen rather than a menu row.
    remind: guard('Reminder', () =>
      service.remindAboutMessage(message.id, Date.now() + 60 * 60 * 1000),
    ),

    edit: () => {
      const next = window.prompt('Edit message', message.body);
      if (next === null || next.trim() === message.body.trim()) return;
      void service.editMessage(message.id, next.trim()).catch(() => onFail('Edit failed'));
    },

    deleteForMe: guard('Delete', () => service.deleteMessage(message.id, false)),
    deleteForEveryone: guard('Delete', () => service.deleteMessage(message.id, true)),

    /*
     * Share and Save hand off to the platform. Both fall back to the clipboard
     * rather than failing, because a device without a share sheet still has
     * somewhere to put text.
     */
    forward: () => undefined,
    share: () => {
      const text = message.body;
      if (navigator.share) void navigator.share({ text }).catch(() => undefined);
      else void navigator.clipboard.writeText(text).catch(() => onFail('Share failed'));
    },
    save: () => {
      const url = message.sticker?.url;
      if (!url) return;
      const link = document.createElement('a');
      link.href = url;
      link.download = `pingo-${message.id}.png`;
      link.click();
    },

    info: () => {
      const sent = new Date(message.createdAt).toLocaleString();
      const edited = message.editedAt
        ? `
Edited ${new Date(message.editedAt).toLocaleString()}`
        : '';
      window.alert(`Sent ${sent}${edited}
Status: ${message.status}`);
    },

    jumpToOriginal: () => {
      if (!message.replyToId) return;
      const target = document.getElementById(`message-${message.replyToId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    report: guard('Report', () => service.reportMessage(message.id)),

    /*
     * Translate has no provider wired, so it opens the platform's own rather
     * than pretending. Speak is the Web Speech API, which every browser has.
     */
    translate: () => {
      window.open(
        `https://translate.google.com/?sl=auto&tl=${navigator.language.slice(0, 2)}&text=${encodeURIComponent(message.body)}&op=translate`,
        '_blank',
        'noopener',
      );
    },
    speak: () => {
      const utterance = new SpeechSynthesisUtterance(message.body);
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    },
  };
}