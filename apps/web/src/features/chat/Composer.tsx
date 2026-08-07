import type { Sticker } from '@pingo/core';
import { IconButton, MicIcon, SendIcon, SmileIcon, cn } from '@pingo/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { receiveKeyboardImages } from '../native/keyboard-image.js';
import { receiveSharedText } from '../native/shared-content.js';
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
  /**
   * Called as the microphone opens and closes, so the other side can say so.
   *
   * Separate from `onTyping` because the receiver shows a different sentence,
   * and because cancelling a take must clear the indicator without also
   * claiming the user stopped typing something they never started.
   */
  onRecording?: (recording: boolean) => void | Promise<void>;
  /**
   * Images pasted or inserted from the keyboard.
   *
   * This is how a GIF or sticker chosen in Gboard or the iOS keyboard actually
   * arrives: not as a file pick, but as a paste carrying image data. Without a
   * handler the browser tries to insert it as text, finds none, and the tap
   * appears to do nothing at all — which is exactly how it looked.
   */
  onPasteFiles?: (files: File[]) => void;
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
  onRecording,
  onPasteFiles,
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
   * emoji is the default, it is what the button is reached for nine times out
   * of ten.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Bumped per send, purely to restart the send button's animation. */
  const [sent, setSent] = useState(0);
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasText = value.trim().length > 0;

  /*
   * Images inserted by the keyboard without a paste.
   *
   * Some keyboards commit a GIF straight into the field as an `insertFrom*`
   * input event carrying a `dataTransfer`, and never fire a paste at all. That
   * has to be a *native* listener: React's `onBeforeInput` is synthetic, built
   * on the legacy `textInput` event, and does not carry `dataTransfer` — so a
   * handler written the React way looks correct and receives nothing.
   *
   * Guarded against the case where a keyboard fires both. The paste handler
   * already prevented the default, but a second delivery would send the same
   * GIF twice, and the same file object arriving twice in one tick is the only
   * signal available to tell them apart.
   */
  const lastInsert = useRef(0);
  const takeImages = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return false;

    const now = Date.now();
    if (now - lastInsert.current < 400) return true;
    lastInsert.current = now;

    onPasteFiles?.(images);
    return true;
  };

  /*
   * The Android keyboard cannot reach the page on its own - see
   * keyboard-image.ts. It arrives here as a File and joins the paste path,
   * because a GIF from Gboard and a pasted screenshot are the same event as
   * far as the composer is concerned.
   */
  useEffect(() => {
    if (!onPasteFiles) return;
    return receiveKeyboardImages((file) => {
      takeImages([file]);
    });
  }, [onPasteFiles]);

  /*
   * Text shared into PINGO from another app - a link, a quote, an address.
   *
   * Appended rather than replacing, because somebody may already be typing
   * when they switch away to share something, and throwing away what they had
   * written is not a trade worth making for a tidier implementation.
   */
  useEffect(
    () =>
      receiveSharedText((text) => {
        setValue((current) => (current ? `${current}\n${text}` : text));
        textareaRef.current?.focus();
      }),
    [],
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !onPasteFiles) return;

    const handler = (event: Event) => {
      const input = event as InputEvent;
      const transfer = input.dataTransfer;
      if (!transfer) return;

      const files = [...transfer.files];
      const fallback =
        files.length > 0
          ? files
          : [...transfer.items]
              .filter((item) => item.kind === 'file')
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null);

      if (takeImages(fallback)) event.preventDefault();
    };

    el.addEventListener('beforeinput', handler);
    return () => el.removeEventListener('beforeinput', handler);
  });

  const recorder = useVoiceRecorder();

  /*
   * Mirror the recorder state onto the wire from one effect.
   *
   * Announcing at each call site would mean remembering it at start, at send,
   * at cancel and at unmount, and the one that gets forgotten leaves the other
   * person watching "recording" for ever. The effect cannot forget.
   */
  /*
   * At the five-minute ceiling the microphone is genuinely released, so the
   * other person stops seeing "recording" even though the bar is still up
   * waiting to send. The indicator describes the microphone, not the composer.
   */
  const listening = recorder.recording && !recorder.capped;

  /*
   * The callback in a ref, so only `listening` can re-run the effect.
   *
   * `onRecording` is an inline arrow at the call site, so it is a new function
   * on every render - and with it in the dependency list this effect ran on
   * every render too, broadcasting `recording: false` continuously. That was
   * harmless-looking and was not: the receiver deleted the sender's activity on
   * any `false`, whatever kind it named, so a stream of "not recording" wiped
   * the *typing* indicator over and over. Typing appeared for an instant and
   * vanished, and it started the day the recording indicator was added.
   *
   * The other half of that fix is in `presence.ts`, where a stop now only
   * clears the kind it actually refers to.
   */
  const onRecordingRef = useRef(onRecording);
  onRecordingRef.current = onRecording;

  useEffect(() => {
    void onRecordingRef.current?.(listening);
    if (!listening) return;

    /*
     * Recording repeats itself; typing does not have to.
     *
     * Typing re-broadcasts on every keystroke, so the receiver's four-second
     * expiry keeps being pushed back for as long as somebody is writing.
     * Recording was announced exactly once, which left it fragile in two ways:
     * it expired four seconds into a voice note that was still being made, and
     * any stray stop wiped it with nothing following to put it back.
     *
     * A heartbeat inside the expiry window fixes both. It is the same shape as
     * a keystroke - a continuous state saying so continuously - and the
     * throttle in `setTyping` is what stops it becoming traffic.
     */
    const beat = window.setInterval(() => {
      void onRecordingRef.current?.(true);
    }, 2_000);

    return () => {
      window.clearInterval(beat);
      void onRecordingRef.current?.(false);
    };
  }, [listening]);

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
      /*
       * One pill, with everything inside it.
       *
       * Attach, the field, emoji and send used to be three separate objects
       * sitting in a row with gaps between them - so the thing you use most in
       * the product read as scattered parts rather than as one control. They
       * are one control: you are writing a message, and everything here is a
       * way of putting something into it or sending it.
       *
       * Glass rather than a flat sunken rectangle, so the composer is the same
       * material as the header and the dock instead of the one surface that
       * opted out.
       */
      <div
        className={cn(
          'glass-surface flex min-w-0 flex-1 items-end gap-1 rounded-xl px-1.5 py-1.5',
          'transition-[box-shadow] duration-instant ease-standard',
          'focus-within:shadow-sm',
        )}
      >
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

      <div className="flex min-w-0 flex-1 items-end gap-1 px-1">
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
          onPaste={(event) => {
            if (!onPasteFiles) return;

            /*
             * `files` first, `items` as the fallback.
             *
             * A keyboard GIF arrives as a file on Chrome and Android; some
             * builds of Safari expose it only through `items`, and reading the
             * wrong one is the difference between the feature working and the
             * button appearing dead. Both are checked, and duplicates cannot
             * happen because only one of them is used.
             */
            const fromFiles = [...event.clipboardData.files];
            const candidates =
              fromFiles.length > 0
                ? fromFiles
                : [...event.clipboardData.items]
                    .filter((item) => item.kind === 'file')
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => file !== null);

            /*
             * `takeImages` returns whether this was an image, and does the
             * de-duplication shared with the `beforeinput` listener. The default
             * is prevented only then: pasting text stays an ordinary paste,
             * because intercepting that would break the common case to serve
             * the rare one.
             */
            if (takeImages(candidates)) event.preventDefault();
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

      {/*
        Send, or the microphone, in the same place.

        One slot that changes what it offers: until there is something to send
        it is a voice note, and the moment a character is typed it becomes
        Send. Two buttons side by side would mean the primary action moves
        depending on whether you have started writing.
      */}
      {hasText ? (
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
            // The gesture was taken away, a notification, a system sheet. The
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
         * No handler means this surface does not take voice notes, the
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
      )}
      </div>
      )}
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
 * stickers, one tab is not a choice.
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
