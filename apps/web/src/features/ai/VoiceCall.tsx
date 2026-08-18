import { PingoDot, cn } from '@pingo/ui';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useVoiceRecorder } from '../chat/useVoiceRecorder.js';
import { speakStreaming, type Speech } from '../chat/speak.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Talking to PINGO out loud.
 *
 * ## Turn-taking, not a live stream
 *
 * A genuinely full-duplex agent needs a socket, a server holding audio state,
 * and a GPU on the other end - NVIDIA's own blueprint for this wants 72 GB of
 * VRAM and WebRTC. What is here instead is the shape of a phone call built out
 * of the pieces PINGO already has: listen until they stop, transcribe, answer,
 * speak, listen again.
 *
 * The difference a person notices is that they cannot interrupt mid-sentence.
 * The difference they do not notice is everything else, and this runs on a
 * serverless function.
 *
 * ## Silence is the turn signal
 *
 * Nobody wants to press a button to stop talking, so the end of a turn is
 * decided by the microphone going quiet for a moment. The threshold is
 * deliberately forgiving: cutting somebody off mid-thought is far worse than
 * waiting an extra beat, because the first loses what they were saying and the
 * second is just a pause.
 */

/** Below this the microphone is hearing room tone, not speech. */
const QUIET_LEVEL = 0.06;

/** Quiet for this long ends the turn. A comma is shorter; a thought is not. */
const QUIET_MS = 1100;

/** Nothing said for this long at all - probably nobody there. */
const NOTHING_SAID_MS = 12_000;

/** What the call is doing, which is also what the screen says. */
type Phase = 'listening' | 'thinking' | 'speaking' | 'error';

const WHAT: Record<Phase, string> = {
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  error: 'that did not work',
};

async function authed(path: string, payload: unknown): Promise<Response | undefined> {
  const client = getSupabaseClient();
  const {
    data: { session },
  } = await client.auth.getSession();
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!session?.access_token || !base || !anon) return undefined;

  return fetch(`${base}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

/** One sentence of the reply, spoken by the server. Undefined falls back. */
async function fetchSentence(text: string): Promise<Blob | undefined> {
  try {
    const response = await authed('tts', { text });
    if (!response?.ok) return undefined;
    if (!(response.headers.get('Content-Type') ?? '').startsWith('audio/')) return undefined;
    return await response.blob();
  } catch {
    return undefined;
  }
}

export interface VoiceCallProps {
  conversationId: string;
  /** Hangs up and closes the screen. */
  onEnd: () => void;
  /**
   * Sends the transcribed turn and resolves with what PINGO said.
   *
   * Passed in rather than reached for: the thread owns the conversation and
   * this screen owns the microphone, and keeping it that way means a spoken
   * turn goes through exactly the same path as a typed one - same model
   * routing, same memory, same filters, and it lands in the thread afterwards.
   */
  ask: (text: string) => Promise<string | undefined>;
}

export function VoiceCall({ conversationId, onEnd, ask }: VoiceCallProps) {
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>('listening');
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');

  const speech = useRef<Speech | undefined>(undefined);
  const live = useRef(true);
  const quietSince = useRef<number | undefined>(undefined);
  const spokeAt = useRef(Date.now());

  /*
   * Everything stops when the screen goes, including the microphone.
   *
   * A call that keeps listening after it is closed is the single worst bug this
   * feature could have, so the flag is checked at every await and the teardown
   * is unconditional.
   */
  useEffect(
    () => () => {
      live.current = false;
      speech.current?.stop();
      recorder.cancel();
    },
    // `recorder` is stable for the life of the hook; listing it would tear the
    // call down on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** One turn: hear it, ask, speak the answer, and go back to listening. */
  const takeTurn = useCallback(
    async (clip: Blob) => {
      if (!live.current) return;
      setPhase('thinking');

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(clip);
      });
      if (!live.current) return;

      const heardResponse = await authed('stt', { audio: base64 });
      const transcript = heardResponse?.ok
        ? ((await heardResponse.json()) as { text?: string }).text?.trim()
        : undefined;
      if (!live.current) return;

      /*
       * Nothing recognisable. Not an error - a cough, a door, somebody
       * clearing their throat - so it goes straight back to listening rather
       * than announcing a failure nobody caused.
       */
      if (!transcript) {
        setPhase('listening');
        return;
      }

      setHeard(transcript);
      const reply = await ask(transcript);
      if (!live.current) return;

      if (!reply) {
        setPhase('error');
        window.setTimeout(() => live.current && setPhase('listening'), 1600);
        return;
      }

      setSaid(reply);
      setPhase('speaking');
      const started = speakStreaming(reply, fetchSentence);
      speech.current = started;
      await started.done;
      speech.current = undefined;
      if (live.current) setPhase('listening');
    },
    [ask],
  );

  /*
   * The microphone runs for the whole call and the turn is cut out of it.
   *
   * Starting and stopping capture per turn drops the first syllable every time -
   * `getUserMedia` takes a moment to hand over the stream, and people begin
   * talking as soon as the screen says listening.
   */
  useEffect(() => {
    if (phase !== 'listening') return;
    let cancelled = false;

    void (async () => {
      if (!recorder.recording) await recorder.start();
      if (cancelled) return;
      quietSince.current = undefined;
      spokeAt.current = Date.now();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /*
   * Watching the level for the end of a turn.
   *
   * `quietSince` is only armed once something has actually been said, so the
   * silence before somebody starts speaking does not end a turn that never
   * began.
   */
  useEffect(() => {
    if (phase !== 'listening' || !recorder.recording) return;

    const loud = recorder.level > QUIET_LEVEL;
    if (loud) {
      quietSince.current = undefined;
      spokeAt.current = Date.now();
      return;
    }

    if (spokeAt.current && Date.now() - spokeAt.current > NOTHING_SAID_MS) return;
    if (quietSince.current === undefined) quietSince.current = Date.now();
    if (Date.now() - quietSince.current < QUIET_MS) return;

    quietSince.current = undefined;
    void (async () => {
      const take = await recorder.stop();
      if (take?.blob) await takeTurn(take.blob);
      else if (live.current) setPhase('listening');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.level, recorder.recording, phase]);

  return (
    <div className="bg-surface fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 px-8">
      {/*
        The mark breathes with the microphone while listening and pulses while
        it is PINGO's turn, so the state is legible from across a room - which
        is where a phone on speaker usually is.
      */}
      <div
        className={cn(
          'grid h-32 w-32 place-items-center rounded-full',
          'bg-brand/10 transition-transform duration-instant',
          phase === 'speaking' && 'animate-dot-pulse',
        )}
        style={
          phase === 'listening'
            ? { transform: `scale(${1 + Math.min(recorder.level, 0.4)})` }
            : undefined
        }
      >
        <PingoDot state={phase === 'listening' ? 'idle' : 'typing'} size={28} />
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-body text-text-secondary">PINGO is {WHAT[phase]}…</p>
        {/*
          The last thing heard, shown because misheard Hinglish is the most
          likely thing to go wrong and somebody who can see it can rephrase
          rather than wonder why the answer made no sense.
        */}
        {heard && (
          <p className="text-caption text-text-tertiary max-w-sm line-clamp-2">“{heard}”</p>
        )}
        {phase === 'speaking' && said && (
          <p className="text-caption text-text-secondary max-w-sm line-clamp-3">{said}</p>
        )}
        {recorder.error && <p className="text-caption text-danger">{recorder.error}</p>}
      </div>

      <button
        type="button"
        onClick={onEnd}
        className={cn(
          'focus-ring rounded-full bg-danger px-8 py-3 text-white',
          'transition-transform duration-instant active:scale-95',
        )}
      >
        End call
      </button>

      <p className="text-caption text-text-tertiary max-w-xs text-center">
        {/* Said once, plainly, rather than discovered by being cut off. */}
        Speak, then pause — PINGO answers when you stop. It cannot be interrupted
        mid-sentence yet.
      </p>

      <span className="sr-only" aria-live="polite">
        {`PINGO is ${WHAT[phase]}`}
      </span>
      <span className="sr-only">{conversationId}</span>
    </div>
  );
}
