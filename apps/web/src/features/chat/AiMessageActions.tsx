import { CheckIcon, ChatIcon, MuteIcon, SpeakerIcon, SwapIcon, cn } from '@pingo/ui';

import { useEffect, useRef, useState } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';
import { speakStreaming, type Speech } from './speak.js';

/**
 * One sentence of speech from the server, or nothing.
 *
 * Undefined means "the server will not read this one" - Devanagari, a provider
 * refusal, no session - and the caller falls back to the device's own voices.
 * It is deliberately not an error: the fallback is a route, not a failure.
 */
async function fetchSentence(text: string): Promise<Blob | undefined> {
  try {
    const client = getSupabaseClient();
    const {
      data: { session },
    } = await client.auth.getSession();
    const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!session?.access_token || !base || !anon) return undefined;

    const response = await fetch(`${base}/functions/v1/tts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: anon,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) return undefined;
    if (!(response.headers.get('Content-Type') ?? '').startsWith('audio/')) return undefined;
    return await response.blob();
  } catch {
    return undefined;
  }
}

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
   * The reading in progress, if any.
   *
   * A ref rather than state: nothing renders from it, and putting it in state
   * would re-run the effect below every time a sentence started.
   */
  const reading = useRef<Speech | undefined>(undefined);

  /*
   * Leaving the thread stops the voice.
   *
   * Without this, scrolling away or opening another chat left it talking about
   * a message no longer on screen - which is the kind of thing people close the
   * app over.
   */
  useEffect(() => () => reading.current?.stop(), []);

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

  /**
   * Start reading, or stop if it is already reading.
   *
   * The whole reply is handed over at once and split inside - the pipeline
   * decides where the sentences are, because that is also where it decides
   * what to fetch next, and splitting in two places would let them disagree.
   */
  const speak = () => {
    if (reading.current) {
      reading.current.stop();
      reading.current = undefined;
      setSpeaking(false);
      return;
    }

    const started = speakStreaming(text, fetchSentence);
    reading.current = started;
    setSpeaking(true);

    void started.done.then(() => {
      // Only if this reading is still the current one: pressing stop and
      // starting again resolves the old promise afterwards, and it must not
      // switch off the new one.
      if (reading.current === started) {
        reading.current = undefined;
        setSpeaking(false);
      }
    });
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
