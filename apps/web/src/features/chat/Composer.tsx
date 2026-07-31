import type { Sticker } from '@pingo/core';
import { IconButton, MicIcon, SendIcon, SmileIcon, cn } from '@pingo/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AttachMenu } from './AttachMenu.js';
import { EmojiPicker } from '../emoji/EmojiPicker.js';
import { useVoiceRecorder, type Recording } from './useVoiceRecorder.js';
import { VoiceRecorderBar } from './VoiceRecorderBar.js';
import { StickerPicker } from '../stickers/StickerPicker.js';

/**
 * The message composer.
 *
 * A `textarea` that grows with its content up to a cap, then scrolls. A
 * single-line input would silently hide the middle of a long message while the
 * user is still writing it.
 *
 * The send control swaps to a microphone when the field is empty, so the primary
 * action is always the one that makes sense - and the button never sits there
 * disabled, which is a dead-end the user has to reason about.
 *
 * Enter sends; Shift+Enter makes a newline. On touch, Enter always inserts a
 * newline instead, because there is no visible Shift key to discover.
 */

export interface ComposerProps {
  /**
   * The attach menu's six actions. Supplied together or not at all - a menu
   * with holes in it is the placeholder problem by another route.
   */
  attach?: {
    gallery: () => void;
    camera: () => void;
    document: () => void;
    location: () => void;
    contact: () => void;
    event: () => void;
  };
  onSend: (body: string) => void | Promise<void>;
  /** Absent means the surface cannot take voice notes, and the mic is hidden. */
  onSendVoice?: (recording: Recording) => void | Promise<void>;
  /** Absent means the surface cannot take stickers, and the button is hidden. */
  onSendSticker?: (sticker: Sticker) => void | Promise<void>;
  placeholder?: string;
  /** Called as the field fills and empties, so the other side sees the dots. */
  onTyping?: (typing: boolean) => void | Promise<void>;
  /** Announced to screen readers, e.g. "Message Anaya Sharma". */
  ariaLabel?: string;
  className?: string;
}

/** Growth cap, in px. Roughly six lines before the field starts to scroll. */
const MAX_HEIGHT = 140;

/**
 * How long the microphone must be held before it counts as hold-to-record.
 *
 * Shorter than a long press, because this is not a hidden gesture being
 * discovered - the button is already the record button, and the only question
 * is whether the finger stayed. Long enough that a firm tap is still a tap.
 */
const HOLD_MS = 220;

export function Composer({
  attach,
  onSend,
  onSendVoice,
  onSendSticker,
  onTyping,
  placeholder = 'Type a message...',
  ariaLabel = 'Message',
  className,
}: ComposerProps) {
  const [value, setValue] = useState('');
  /** Why the last send was refused. Cleared the moment another is attempted. */
  const [error, setError] = useState<string | undefined>();
  /**
   * One panel, two tabs.
   *
   * Emoji and stickers used to be separate buttons opening separate panels,
   * which meant two icons to learn and two things that could each be the open
   * one. They are two drawers of the same cupboard, so they share a panel and
   * emoji is the default - it is what the button is reached for nine times out
   * of ten.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Bumped per send, purely to restart the send button's animation. */
  const [sent, setSent] = useState(0);
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim().length > 0;

  const recorder = useVoiceRecorder();

  /** Set while a press is being treated as hold-to-record. */
  const heldRef = useRef(false);
  const holdTimer = useRef<number | undefined>(undefined);

  /** Ends the take and sends it, if there is enough of one to send. */
  const sendRecording = () => {
    void recorder.stop().then((take) => {
      // Under the floor, or empty. Dropped rather than sent as a fraction of a
      // second the other person has to open to find nothing in.
      if (take) void onSendVoice?.(take);
    });
  };

  /** A short, self-clearing line for things the composer cannot do yet. */
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Autosize before paint, so the field never renders at the wrong height first.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    if (!hasText) return;

    /*
     * Cleared optimistically, and put back if the send is refused.
     *
     * Optimistic because a composer that waits for the network before emptying
     * feels broken on a slow connection, and that is the common case by a wide
     * margin. But the old version cleared and never looked again, so a refused
     * send took the text with it and said nothing at all - the message was
     * simply gone, and the only way to notice was to reread the thread.
     *
     * End-to-end encryption made that failure reachable rather than
     * theoretical: a chat that is already encrypted refuses to send when no
     * key for a participant is available, precisely so it never falls back to
     * plaintext. Refusing loudly is the entire point, so it has to be said out
     * loud.
     */
    const sent = value;
    setValue('');
    setError(undefined);
    // Keep focus so a conversation can be held entirely from the keyboard.
    textareaRef.current?.focus();

    void (async () => {
      try {
        await onSend(sent);
      } catch (cause) {
        // Only restores if nothing else has been typed since. Overwriting what
        // someone is in the middle of writing would be a worse bug than the
        // one being reported.
        setValue((current) => (current.length === 0 ? sent : current));
        setError(
          cause instanceof Error ? cause.message : 'That message could not be sent.',
        );
      }
    })();
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {(notice ?? recorder.error) && (
        <p role="status" className="px-1 text-caption text-text-tertiary">
          {recorder.error ?? notice}
        </p>
      )}
      {pickerOpen && (
        <div
          className={cn(
            'overflow-hidden rounded-xl border border-line bg-surface shadow-lg',
            // Anchored to the composer, so it grows from its bottom edge.
            'origin-bottom animate-panel-in',
          )}
        >
          <PickerTabs tab={tab} onTab={setTab} showStickers={Boolean(onSendSticker)} />

          {tab === 'emoji' ? (
            <EmojiPicker
              onSelect={(emoji) => {
                // Appended rather than sent: an emoji is part of a message,
                // where a sticker is the whole of one.
                setValue((current) => current + emoji);
                textareaRef.current?.focus();
              }}
              onClose={() => setPickerOpen(false)}
            />
          ) : (
            <StickerPicker
              onSelect={(sticker) => {
                void onSendSticker?.(sticker);
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      )}

      {error && (
        /*
         * Above the composer, beside the text it is about, and dismissible.
         *
         * Not a toast: a toast disappears while somebody is still reading it,
         * and this one has to survive long enough to be understood and acted
         * on. It is `alert` so a screen reader announces it - a silent failure
         * is worse for someone who cannot see the box refill itself.
         */
        <div
          role="alert"
          className="mb-2 flex items-start gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
        >
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(undefined)}
            aria-label="Dismiss"
            className="shrink-0 rounded-full px-1 leading-none opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
      {recorder.recording ? (
        <VoiceRecorderBar
          recorder={recorder}
          onSend={sendRecording}
        />
      ) : (
      <>
      {attach && (
        <AttachMenu
          onGallery={attach.gallery}
          onCamera={attach.camera}
          onDocument={attach.document}
          onLocation={attach.location}
          onContact={attach.contact}
          onEvent={attach.event}
        />
      )}

      <div
        className={cn(
          'flex min-w-0 flex-1 items-end gap-2 bg-sunken',
          'rounded-xl border border-transparent px-3 py-2',
          'transition-[background-color,border-color,box-shadow] duration-instant ease-standard',
          'focus-within:bg-surface focus-within:border-line-strong focus-within:shadow-sm',
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            /*
              Reported on every keystroke; the service throttles. Stopping is
              sent the moment the field empties, because a late "still typing"
              is harmless and a late "stopped" leaves the dots up.
            */
            void onTyping?.(event.target.value.length > 0);
          }}
          onKeyDown={(event) => {
            const touch = window.matchMedia('(pointer: coarse)').matches;
            if (event.key === 'Enter' && !event.shiftKey && !touch) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={cn(
            'min-w-0 flex-1 resize-none bg-transparent outline-none',
            'py-1.5 text-body text-ink placeholder:text-text-tertiary',
            'scrollbar-none',
          )}
        />

        {/*
          One button for emoji *and* stickers. They are two drawers of the same
          cupboard - both "insert something that is not typed" - and giving each
          its own icon meant two things to learn and two panels that could each
          be the open one. Emoji leads because it is what the button is reached
          for nine times in ten.
        */}
        <IconButton
          label="Emoji and stickers"
          size="sm"
          variant="ghost"
          className={cn('mb-0.5', pickerOpen && 'text-brand')}
          onClick={() => setPickerOpen((was) => !was)}
        >
          <SmileIcon size={20} />
        </IconButton>
      </div>

      </>
      )}

      {!recorder.recording && (hasText ? (
        <IconButton
          label="Send message"
          variant="gradient"
          size="lg"
          onClick={() => {
            setSent((n) => n + 1);
            submit();
          }}
          /*
            The most repeated action in the product, and it acknowledged nothing.

            `key` on the count is what makes the animation replay: re-running a
            CSS animation needs a new element, and without it the second message
            of a burst - the case where you most want to know it went - would
            animate once and then sit still for the rest of the conversation.
          */
          key={sent}
          className="mb-0.5 glass-press motion-safe:animate-send-pop"
        >
          {/* Nudged to sit optically centred inside the circle. */}
          <SendIcon size={21} className="-translate-x-px translate-y-px" />
        </IconButton>
      ) : onSendVoice ? (
        /*
         * Both gestures, because both are things people already do.
         *
         * Hold and release sends, which is the phone habit. A quick tap starts
         * recording and leaves it running, which is the only version that works
         * with a mouse, and the only one usable by someone who cannot hold a
         * press steady. Neither is a mode the user has to choose in advance  - 
         * the button works out which one happened.
         */
        <IconButton
          label="Record voice message"
          variant="filled"
          size="lg"
          className="mb-0.5"
          onPointerDown={(event) => {
            // Secondary buttons and the context menu are not this gesture.
            if (event.button !== 0) return;
            heldRef.current = false;
            holdTimer.current = window.setTimeout(() => {
              heldRef.current = true;
              void recorder.start();
            }, HOLD_MS);
          }}
          onPointerUp={() => {
            if (holdTimer.current) window.clearTimeout(holdTimer.current);
            holdTimer.current = undefined;

            // Released after the hold took: that is the whole recording.
            if (heldRef.current) {
              heldRef.current = false;
              sendRecording();
              return;
            }

            // Released before it took: a tap, so recording stays running and
            // the bar's own send button ends it.
            void recorder.start();
          }}
          onPointerCancel={() => {
            if (holdTimer.current) window.clearTimeout(holdTimer.current);
            holdTimer.current = undefined;
            // The gesture was taken away - a notification, a system sheet. The
            // take is dropped rather than sent half-finished.
            if (heldRef.current) {
              heldRef.current = false;
              recorder.cancel();
            }
          }}
        >
          <MicIcon size={22} />
        </IconButton>
      ) : (
        /*
         * No handler means this surface does not take voice notes - the
         * styleguide, for one. Saying so beats a button that looks available
         * and does nothing, which is what this was before recording existed.
         */
        <IconButton
          label="Voice messages aren't available here"
          variant="ghost"
          className="mb-0.5 text-text-tertiary"
          onClick={() => setNotice("Voice messages aren't available here.")}
        >
          <MicIcon size={20} />
        </IconButton>
      ))}
      </div>
    </div>
  );
}

/**
 * The two tabs above the picker.
 *
 * A segmented strip rather than a row of icons, because the tabs are a choice
 * between two whole surfaces and the current one has to be obvious without
 * looking at what is underneath. Absent entirely when the surface takes no
 * stickers - one tab is not a choice.
 */
function PickerTabs({
  tab,
  onTab,
  showStickers,
}: {
  tab: 'emoji' | 'stickers';
  onTab: (next: 'emoji' | 'stickers') => void;
  showStickers: boolean;
}) {
  if (!showStickers) return null;

  const tabs = [
    { id: 'emoji' as const, label: 'Emoji' },
    { id: 'stickers' as const, label: 'Stickers' },
  ];

  return (
    <div role="tablist" aria-label="Emoji and stickers" className="flex gap-1 border-b border-line p-1.5">
      {tabs.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          onClick={() => onTab(entry.id)}
          className={cn(
            'focus-ring flex-1 rounded-lg px-3 py-1.5 text-caption font-medium',
            'transition-colors duration-instant',
            tab === entry.id
              ? 'bg-selected text-brand'
              : 'text-text-secondary hover:bg-hover hover:text-ink',
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
