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
                actions={stubbed(message)}
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
 * Level 2 actions that have no service behind them yet.
 *
 * Named honestly rather than dressed up: pin, star and the rest need schema
 * that does not exist. They log and close instead of silently doing nothing,
 * so a tap during testing is distinguishable from a broken handler.
 *
 * This is the one place in the menu that is not finished, and it is marked so
 * that it cannot be mistaken for finished.
 */
function stubbed(message: Message) {
  const note = (what: string) => () =>
    console.info(`[pingo] ${what} is not implemented yet`, message.id);

  return {
    pin: note('Pin'),
    star: note('Star'),
    remind: note('Remind me'),
    edit: note('Edit'),
    deleteForMe: note('Delete for me'),
    deleteForEveryone: note('Delete for everyone'),
    forward: note('Forward from More'),
    share: note('Share'),
    save: note('Save'),
    info: note('Info'),
    jumpToOriginal: note('Jump to original'),
    report: note('Report'),
    translate: note('Translate'),
    speak: note('Speak'),
  };
}
