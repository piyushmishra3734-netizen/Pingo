import { useChat, type CallChatMessage } from '@pingo/core';
import { Avatar, CloseIcon, SendIcon, cn } from '@pingo/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useT } from '../i18n/useT.js';
import { CALL_CHAT_MAX_LENGTH, countUnread, trimCallChat } from './call-chat-rules.js';

/**
 * The chat that belongs to a call rather than to a conversation.
 *
 * ## Why a call needs its own
 *
 * The moment somebody shares a screen the call stops being symmetrical. One
 * person is presenting and everybody else is watching, and what the watchers
 * need is a way to say "go back one" without talking over them. Every
 * conferencing tool has this and it is always chat, because a typed line is the
 * one thing that can interrupt without interrupting.
 *
 * ## Why it is not written to the thread
 *
 * These are not messages. "can you scroll up", "yes", "there" are the audible
 * half of a conversation that already happened out loud - putting them in the
 * thread would leave a transcript of a meeting sitting in the middle of a
 * chat, permanently, with read receipts and disappearing timers applied to it.
 * It lives for the call and goes when the call goes, which is what the people
 * typing it expect. See `CallChatMessage`.
 *
 * ## The look is the app's
 *
 * Same bubbles, same glass, same brand gradient on your own lines. Somebody who
 * has used PINGO for five minutes already knows how to read this panel, and a
 * second visual language for the same act of typing to somebody would be a
 * thing to learn for no reason.
 */
export function CallChatPanel({
  messages,
  onSend,
  onClose,
  selfId,
  /** Docked beside the stage on a wide screen; a sheet on a phone. */
  docked = false,
}: {
  messages: CallChatMessage[];
  onSend: (body: string) => Promise<void>;
  onClose: () => void;
  selfId: string | undefined;
  docked?: boolean;
}) {
  const t = useT();

  return (
    <section
      aria-label={t('call.chatTitle')}
      className={cn(
        'z-20 flex flex-col overflow-hidden',
        /*
          Solid, like the call controls and for the same reason: this panel
          spends its life over a moving picture, and a translucent one takes its
          colour from whatever is behind it - so the text sat on a background
          that changed every time the shared screen scrolled.
        */
        'border-line bg-surface shadow-2xl',
        docked
          ? 'absolute inset-y-0 right-0 w-80 border-l'
          : [
              'absolute inset-x-0 bottom-0 max-h-[65vh] rounded-t-2xl border-t',
              'animate-slide-up',
            ],
      )}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-body font-semibold text-ink">{t('call.chatTitle')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('call.chatClose')}
          className="focus-ring grid size-8 place-items-center rounded-full text-text-secondary"
        >
          <CloseIcon size={18} />
        </button>
      </header>

      <CallChatLog messages={messages} selfId={selfId} />
      <CallChatComposer onSend={onSend} />
    </section>
  );
}

/**
 * The lines, oldest at the top.
 *
 * Pinned to the bottom with a layout effect rather than an effect: the scroll
 * has to be set in the same frame the line is painted, or the panel visibly
 * jumps from the old position to the new one every time somebody types.
 */
function CallChatLog({
  messages,
  selfId,
}: {
  messages: CallChatMessage[];
  selfId: string | undefined;
}) {
  const t = useT();
  const { users } = useChat();
  const end = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <p className="text-center text-caption text-text-tertiary">{t('call.chatEmpty')}</p>
      </div>
    );
  }

  return (
    <ol className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
      {messages.map((message, index) => {
        const mine = message.userId === selfId;
        const person = users.find((user) => user.id === message.userId);
        // The name goes on the first line of a run, the way the thread does it -
        // repeating it under every line of a three-line answer is noise.
        const runStart = index === 0 || messages[index - 1]?.userId !== message.userId;

        return (
          <li
            key={message.id}
            className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}
          >
            {!mine && (
              <span className={cn('shrink-0', !runStart && 'invisible')}>
                <Avatar
                  name={person?.name ?? t('call.someone')}
                  id={message.userId}
                  src={person?.avatarUrl}
                  size="xs"
                />
              </span>
            )}

            <div className={cn('max-w-[78%]', mine && 'items-end')}>
              {!mine && runStart && (
                <span className="mb-0.5 block truncate px-1 text-caption font-medium text-text-secondary">
                  {person?.name ?? t('call.someone')}
                </span>
              )}
              <p
                className={cn(
                  'px-3 py-2 text-body break-words',
                  mine
                    ? 'rounded-2xl rounded-br-sm bg-brand text-white'
                    : 'rounded-2xl rounded-bl-sm bg-sunken text-ink',
                )}
              >
                {message.body}
              </p>
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}

/**
 * One line in, one line out.
 *
 * Enter sends and Shift+Enter does nothing special, because there is no
 * multi-line case worth having here - a call chat line is "slide 4" or "can't
 * hear you". The field clears optimistically: the service echoes every line
 * back through the same event stream the remote ones arrive on, so a failed
 * send is visible as a line that never appears rather than as text stuck in a
 * box.
 */
function CallChatComposer({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const t = useT();
  const [draft, setDraft] = useState('');

  const send = () => {
    const body = trimCallChat(draft);
    if (!body) return;
    setDraft('');
    void onSend(body);
  };

  return (
    <form
      className="flex shrink-0 items-end gap-2 border-t border-line px-3 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={t('call.chatPlaceholder')}
        aria-label={t('call.chatPlaceholder')}
        /*
         * `maxLength` matches the service's own ceiling. Truncating silently
         * after the fact would let somebody watch half a sentence arrive.
         */
        maxLength={CALL_CHAT_MAX_LENGTH}
        className={cn(
          'focus-ring min-w-0 flex-1 rounded-full bg-sunken px-4 py-2',
          'text-body text-ink placeholder:text-text-tertiary',
        )}
      />
      <button
        type="submit"
        disabled={!draft.trim()}
        aria-label={t('call.chatSend')}
        className={cn(
          'focus-ring grid size-9 shrink-0 place-items-center rounded-full',
          'bg-brand text-white transition-opacity duration-instant',
          'disabled:opacity-40',
        )}
      >
        <SendIcon size={18} />
      </button>
    </form>
  );
}

/**
 * How many lines have arrived since the panel was last looked at.
 *
 * Counted from a mark rather than from a flag per message, because the only
 * question the badge answers is "is there something I have not seen" and the
 * mark is one number. Your own lines never count - you were there when you
 * typed them.
 */
export function useCallChatUnread(
  messages: CallChatMessage[],
  open: boolean,
  selfId: string | undefined,
): number {
  const [seen, setSeen] = useState(0);

  useEffect(() => {
    if (open) setSeen(messages.length);
  }, [open, messages.length]);

  if (open) return 0;
  return countUnread(messages, seen, selfId);
}

/**
 * The chat, in a window that floats above whatever the sharer is looking at.
 *
 * ## The problem this solves
 *
 * Somebody sharing their screen is, by definition, looking at something else -
 * a slide deck, an editor, another tab. PINGO is behind it. So the one moment
 * the call chat matters most is the one moment its panel cannot be seen, and
 * "go back a slide" sits unread in a window nobody is looking at.
 *
 * Document Picture-in-Picture is the browser's answer: a real always-on-top
 * window, rendered by this document, that survives tab switches. Chrome and
 * Edge have it; nothing else does yet, and where it is missing the docked panel
 * is still there and still correct - so this is an upgrade, never a dependency.
 *
 * ## Styles have to be carried across
 *
 * A PiP window is a fresh document with no stylesheet. Every rule this app has
 * is copied into it once on open; without that the panel arrives as unstyled
 * black text on white, which looks like a bug rather than a plain window.
 */
export function useChatWindow(open: boolean): DocumentFragment | undefined {
  const [host, setHost] = useState<DocumentFragment>();

  useEffect(() => {
    if (!open) return;

    const pip = (
      globalThis as unknown as {
        documentPictureInPicture?: {
          requestWindow: (options: {
            width: number;
            height: number;
          }) => Promise<Window & typeof globalThis>;
        };
      }
    ).documentPictureInPicture;
    if (!pip) return;

    let win: Window | undefined;
    let cancelled = false;

    void pip
      .requestWindow({ width: 380, height: 520 })
      .then((opened) => {
        if (cancelled) {
          opened.close();
          return;
        }
        win = opened;

        for (const sheet of Array.from(document.styleSheets)) {
          try {
            const css = Array.from(sheet.cssRules)
              .map((rule) => rule.cssText)
              .join('');
            const style = opened.document.createElement('style');
            style.textContent = css;
            opened.document.head.append(style);
          } catch {
            // A cross-origin sheet cannot be read. Nothing in this app is one,
            // and an extension's stylesheet is not ours to copy anyway.
          }
        }

        const mount = opened.document.createElement('div');
        mount.style.height = '100%';
        opened.document.body.append(mount);
        // Rendered into the real element; the fragment is only the handle React
        // needs, and the caller portals into it.
        setHost(mount as unknown as DocumentFragment);
      })
      .catch(() => {
        // Refused, or no user gesture. The docked panel is still there.
      });

    return () => {
      cancelled = true;
      setHost(undefined);
      win?.close();
    };
  }, [open]);

  return host;
}
