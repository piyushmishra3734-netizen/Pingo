import { useChat, type Message } from '@pingo/core';
import { useCallback, useState } from 'react';

import { EditMessageSheet } from './EditMessageSheet.js';
import { MessageActions } from './MessageActions.js';
import { MessageInfoSheet } from './MessageInfoSheet.js';
import { MessageContextMenu } from './MessageContextMenu.js';
import { MoreSheet } from './MoreSheet.js';
import { ReactionBar } from './ReactionBar.js';
import { useMessageMenu } from './useMenuTriggers.js';

import { useConfirm } from '../../../components/ConfirmProvider.js';

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
  /** The in-app editor, which replaced `window.prompt`. */
  const [editing, setEditing] = useState(false);
  /** The in-app info sheet, which replaced `window.alert`. */
  const [info, setInfo] = useState(false);

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

  const menu = useMessageMenu();

  /**
   * Set when a tap-opened bar has been asked for more.
   *
   * Without this the `➕` on a reactions-only bar leads nowhere, and a tap
   * would be a dead end for anyone who realises mid-gesture that they wanted an
   * action after all — which would teach people to hold every time and undo the
   * point of the cheap gesture.
   */
  const [promoted, setPromoted] = useState(false);

  /*
   * A tap asked for reactions only. The actions are not hidden from it so much
   * as never requested — holding is what asks for them, and offering them
   * anyway would make the two gestures identical.
   */
  const reactionsOnly = menu.open?.mode === 'reactions' && !promoted;

  const level2 = useLevel2(
    message,
    service,
    (why) => {
      setError(why);
      window.setTimeout(() => setError(undefined), 2200);
    },
    // Opening the editor is the menu's job, not Level 2's — Level 2 only knows
    // which row was pressed. Info is the same shape, for the same reason.
    () => setEditing(true),
    () => setInfo(true),
  );

  const close = useCallback(() => {
    menu.close();
    // Reset so the next open starts at Level 1 rather than wherever it ended.
    setLevel('actions');
    setPromoted(false);
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
                onOpenPicker={() => {
                  // From a tap, `➕` reveals the actions the tap did not ask
                  // for; from a hold they are already there, so it goes on to
                  // Level 2.
                  if (reactionsOnly) setPromoted(true);
                  else setLevel('more');
                }}
              />
            ) : null
          }
          actions={
            reactionsOnly ? null : level === 'actions' ? (
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

      {editing && (
        <EditMessageSheet
          body={message.body}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            setEditing(false);
            void service
              .editMessage(message.id, next)
              .catch(() => {
                setError('Edit failed');
                window.setTimeout(() => setError(undefined), 2200);
              });
          }}
        />
      )}

      {info && <MessageInfoSheet message={message} onClose={() => setInfo(false)} />}
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
  onEdit: () => void,
  onInfo: () => void,
) {
  const confirm = useConfirm();

  const guard = (what: string, run: () => Promise<unknown>) => () => {
    void run().catch(() => onFail(`${what} failed`));
  };

  /**
   * Deleting a message, with the question in front of it.
   *
   * The two are genuinely different acts and the dialog says which one is
   * about to happen: for me leaves the message where everybody else can still
   * read it, and for everyone reaches into somebody else's thread. Offering
   * them as two rows in a menu made them look like the same button twice.
   */
  const confirmDelete = (forEveryone: boolean) => () => {
    void (async () => {
      const go = await confirm({
        title: forEveryone ? 'Delete for everyone?' : 'Delete for you?',
        description: forEveryone
          ? 'It goes from this chat for both of you. They will see that a message was deleted.'
          : 'It goes from your side only. The other person still has their copy.',
        confirmLabel: 'Delete',
      });
      if (!go) return;
      await service.deleteMessage(message.id, forEveryone).catch(() => onFail('Delete failed'));
    })();
  };

  return {
    edit: onEdit,
    pin: guard('Pin', () => service.togglePin(message.id)),
    star: guard('Star', () => service.toggleStar(message.id)),
    // An hour is the only interval worth offering without a picker; anything
    // else is a date field, and that is a screen rather than a menu row.
    remind: guard('Reminder', () =>
      service.remindAboutMessage(message.id, Date.now() + 60 * 60 * 1000),
    ),


    deleteForMe: confirmDelete(false),
    deleteForEveryone: confirmDelete(true),

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

    /*
     * Was a `window.alert`. It could say when the message was sent and what its
     * status was, and could not say the thing anybody opens info for: who has
     * read it. It also blocked the page, so nothing could arrive in the chat
     * while you read about what already had.
     */
    info: onInfo,

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