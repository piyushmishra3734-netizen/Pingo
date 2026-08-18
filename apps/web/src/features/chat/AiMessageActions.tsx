import { CheckIcon, ChatIcon, MuteIcon, SpeakerIcon, SwapIcon, cn } from '@pingo/ui';

import { useEffect, useState } from 'react';

/**
 * What you can do with an answer, under the answer.
 *
 * ## Why not the long-press menu, which already has these
 *
 * Because nobody finds it. Copy and Speak have existed in the context menu the
 * whole time; the request for them came anyway, which is the only evidence
 * needed that a menu you have to know about is not a feature. Every assistant
 * people compare this to puts the same two actions in the open, under the
 * message, and that is where the hand already is.
 *
 * ## Why it is quiet
 *
 * A row of controls under every reply competes with the reply. So: no labels,
 * no borders, no fill - marks at the weight of a timestamp, in the colour of
 * secondary text, and they only take colour under the finger or the pointer.
 * The eye reads the answer, finds the actions when it goes looking, and is not
 * asked to skip past them on the way in.
 *
 * Present at rest rather than on hover, because half the people using this are
 * on a phone where there is no hover and a control that only appears on one is
 * a control that does not exist.
 *
 * ## Speaking is a toggle
 *
 * Starting speech is easy to do by accident and long to sit through, so the
 * same button stops it. `speechSynthesis` is global - one utterance at a time
 * across the whole page - so a second message speaking cancels the first, and
 * this listens for that rather than believing its own state.
 */

export interface AiMessageActionsProps {
  /** What Copy puts on the clipboard and Speak reads out. */
  text: string;
  /** Quote this message in the composer. */
  onReply: () => void;
  /** Ask again. Omitted where asking again makes no sense. */
  onRegenerate?: () => void;
  className?: string;
}

export function AiMessageActions({
  text,
  onReply,
  onRegenerate,
  className,
}: AiMessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // The clipboard confirmation lives here rather than in a toast: the thing it
  // confirms is on screen, and a toast would point somewhere else.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /*
   * Speech is one queue for the whole page, so this button can stop being true
   * without ever being pressed - another message speaking cancels this one.
   * Polling is the only signal the API offers; a quarter of a second is far
   * below noticing and costs nothing.
   */
  useEffect(() => {
    if (!speaking) return;
    const timer = window.setInterval(() => {
      if (!window.speechSynthesis?.speaking) setSpeaking(false);
    }, 250);
    return () => window.clearInterval(timer);
  }, [speaking]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      navigator.vibrate?.(4);
      setCopied(true);
    } catch {
      // Refused clipboard permission. Saying nothing is better than saying
      // "Copied" about something that is not on the clipboard.
      setCopied(false);
    }
  };

  const speak = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (synth.speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(utterance);
    setSpeaking(true);
  };

  return (
    <div
      className={cn('flex items-center gap-0.5 pt-1 pl-1', className)}
      // Not a toolbar: these are four unrelated actions, not a set to arrow
      // between, and announcing a toolbar promises navigation that is not here.
      role="group"
      aria-label="Message actions"
    >
      <ActionButton
        label={copied ? 'Copied' : 'Copy'}
        active={copied}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon size={14} /> : <CopyMark />}
      </ActionButton>

      {/* Absent rather than disabled where the browser has no speech: a dead
          control is a question the interface cannot answer. */}
      {typeof window !== 'undefined' && 'speechSynthesis' in window && (
        <ActionButton label={speaking ? 'Stop' : 'Read aloud'} active={speaking} onClick={speak}>
          {speaking ? <MuteIcon size={14} /> : <SpeakerIcon size={14} />}
        </ActionButton>
      )}

      <ActionButton label="Reply" onClick={onReply}>
        <ChatIcon size={14} />
      </ActionButton>

      {onRegenerate && (
        <ActionButton label="Try again" onClick={onRegenerate}>
          <SwapIcon size={14} />
        </ActionButton>
      )}
    </div>
  );
}

/**
 * Two overlapping sheets. There is no copy glyph in the icon set and this is
 * smaller than adding one to it.
 */
function CopyMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 15.5A2.5 2.5 0 0 1 4 13.5v-7A2.5 2.5 0 0 1 6.5 4h7a2.5 2.5 0 0 1 2 1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * One mark, one meaning, and a name only a screen reader hears.
 *
 * The touch target is 32px while the mark is 14, which is the whole reason the
 * padding is there - a control the size of its own glyph is a control people
 * miss and press twice.
 */
function ActionButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'focus-ring grid h-8 w-8 place-items-center rounded-lg',
        'transition-colors duration-instant',
        active ? 'text-brand' : 'text-text-tertiary hover:text-text-secondary hover:bg-hover',
        'active:scale-95 motion-reduce:active:scale-100',
      )}
    >
      {children}
    </button>
  );
}
