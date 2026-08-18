import { PlusIcon, SendIcon, cn } from '@pingo/ui';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useVoiceRecorder } from '../chat/useVoiceRecorder.js';
import { speakStreaming, type Speech } from '../chat/speak.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { VoiceWave } from './VoiceWave.js';

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

/**
 * Shrink a photo before it goes anywhere.
 *
 * A phone camera produces twelve megapixels and a vision model gains nothing
 * from eleven of them. The upload is the slowest part of the exchange by a
 * distance, so this is the difference between a wait and a hang.
 *
 * JPEG at 0.8 rather than PNG: these are photographs, and a lossless format for
 * a photograph is several megabytes spent on nothing.
 */
async function shrink(file: File, maxSide = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? '';
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

  /*
   * Typing, during a call.
   *
   * Every assistant people compare this to keeps a text field on the call
   * screen, and the reason is not convenience - it is that speech recognition
   * gets things wrong, and the repair for a misheard sentence has to be
   * something other than saying it louder. Hinglish is exactly where that
   * happens: "theek" comes back "diek" often enough to matter.
   *
   * It is also the answer to a room that is too loud, a phone in a pocket, and
   * anybody who simply does not want to talk out loud where they are.
   */
  const [typed, setTyped] = useState('');
  const picker = useRef<HTMLInputElement>(null);


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

  /**
   * Everything after the words exist: ask, speak, go back to listening.
   *
   * Shared by the microphone and the text field on purpose - a typed turn and a
   * spoken one must not be able to behave differently, and the only thing that
   * differs between them is where the sentence came from.
   */
  const answer = useCallback(
    async (said: string) => {
      if (!live.current) return;
      setHeard(said);
      const reply = await ask(said);
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

  /**
   * A picture, looked at and then talked about.
   *
   * The chat model cannot see, so the image is described first by one that can
   * and the description is what enters the conversation. That is stated to the
   * assistant rather than hidden - "yeh photo bheji hai: …" - because a model
   * told it is looking at a description answers more carefully than one that
   * believes it is looking at a photograph.
   */
  const share = useCallback(
    async (file: File) => {
      if (!live.current) return;
      setPhase('thinking');
      setHeard('photo dekh raha hoon…');
      try {
        const image = await shrink(file);
        const response = await authed('vision', { image });
        const seen = response?.ok
          ? ((await response.json()) as { text?: string }).text?.trim()
          : undefined;
        if (!live.current) return;
        if (!seen) {
          setPhase('error');
          window.setTimeout(() => live.current && setPhase('listening'), 1600);
          return;
        }
        await answer(`Maine ek photo bheji hai. Usme yeh dikh raha hai: ${seen}`);
      } catch {
        if (live.current) setPhase('listening');
      }
    },
    // `answer` is the shared turn path; see its note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answer],
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

      await answer(transcript);
    },
    [answer],
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

  /*
   * One meter for both halves of the conversation.
   *
   * While listening it is the microphone; while speaking it is the audio on its
   * way to the speakers. The wave does not know or care which - it asks for a
   * number every frame - and that is what makes the same line read as "I am
   * hearing you" and "I am saying this" without ever changing shape.
   */
  /*
   * Stable for the life of the call, and that is the whole point.
   *
   * `recorder.level` is React state, so it changes many times a second while
   * somebody is talking. A callback listing it as a dependency is a *new
   * function* on every one of those changes, which tore down and restarted the
   * canvas animation loop each time - and that is exactly why the line stuttered
   * while the user spoke and was perfectly smooth while PINGO did. The speaking
   * half read from a ref and never re-created anything.
   *
   * The latest values are mirrored into refs and read inside, so the identity
   * never changes and the loop starts once.
   */
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const micLevel = useRef(0);
  micLevel.current = recorder.level;

  const level = useCallback(
    () => (phaseRef.current === 'speaking' ? (speech.current?.level() ?? 0) : micLevel.current),
    [],
  );

  /*
   * Likewise: whether the line should move at all is read per frame rather than
   * passed as a prop, so a phase change does not restart the loop either.
   */
  const active = useCallback(
    () => phaseRef.current === 'listening' || phaseRef.current === 'speaking',
    [],
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[#050b1a] px-6">
      {/*
        The halo behind everything.

        A single wide arc of light rising from below the fold. It is not
        decoration for its own sake: it puts the card on a stage, and it is the
        thing that stops a dark screen from reading as an error state.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-1/2 h-[110vh] rounded-[50%]"
        style={{
          background:
            'radial-gradient(closest-side, rgba(64,120,255,0.55), rgba(64,120,255,0.12) 60%, transparent 75%)',
          filter: 'blur(28px)',
        }}
      />

      <div
        className={cn(
          'relative flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl p-6',
          // Frosted, so the halo shows through it rather than being hidden by it.
          'border border-white/10 bg-white/[0.06] backdrop-blur-xl',
        )}
      >
        {/*
          What was heard, at the top, where the eye lands first.

          Shown because misheard Hinglish is the most likely thing to go wrong,
          and somebody who can see it can rephrase instead of wondering why the
          answer made no sense. The last thing PINGO said sits under it in a
          quieter weight - present, but not competing with the live text.
        */}
        <div className="min-h-[3.5rem] w-full text-center">
          <p className="text-body text-white/90">
            {heard || (phase === 'listening' ? 'Bolo…' : ' ')}
          </p>
          {said && phase === 'speaking' && (
            <p className="text-caption mt-1 line-clamp-2 text-white/45">{said}</p>
          )}
        </div>

        {/* The line itself. Everything above and below is context for it. */}
        <div className="h-28 w-full">
          <VoiceWave level={level} active={active} />
        </div>

        <p className="text-caption text-white/40">
          {phase === 'thinking' ? 'soch raha hoon…' : WHAT[phase]}
        </p>

        {recorder.error && <p className="text-caption text-red-300">{recorder.error}</p>}
      </div>

      {/*
        Typing, on the call screen.

        Recognition gets Hinglish wrong often enough that saying it again louder
        is not a repair, and this is the way out of that loop. It is also the
        answer to a loud room and to anybody who does not want to speak out loud
        where they are.

        Sending stops the microphone for that turn: two sources of truth about
        what was just said is how PINGO ends up answering the wrong one.
      */}
      <form
        className="relative mt-6 flex w-full max-w-sm items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const words = typed.trim();
          if (!words || phase === 'thinking' || phase === 'speaking') return;
          setTyped('');
          recorder.cancel();
          setPhase('thinking');
          void answer(words);
        }}
      >
        <input
          ref={picker}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so choosing the same photo twice still fires.
            event.target.value = '';
            if (file) void share(file);
          }}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={phase === 'thinking' || phase === 'speaking'}
          aria-label="Send a photo to look at"
          className={cn(
            'focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full',
            'border border-white/10 bg-white/[0.06] text-white',
            'transition-transform duration-instant active:scale-95 disabled:opacity-30',
          )}
        >
          <PlusIcon size={18} />
        </button>
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Ya likh do…"
          aria-label="Type instead of speaking"
          className={cn(
            'focus-ring text-body min-w-0 flex-1 rounded-full px-4 py-2.5',
            'border border-white/10 bg-white/[0.06] text-white placeholder:text-white/35',
          )}
        />
        <button
          type="submit"
          disabled={!typed.trim() || phase === 'thinking' || phase === 'speaking'}
          aria-label="Send"
          className={cn(
            'focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full',
            'bg-white/15 text-white transition-transform duration-instant',
            'active:scale-95 disabled:opacity-30',
          )}
        >
          <SendIcon size={18} />
        </button>
      </form>

      <button
        type="button"
        onClick={onEnd}
        className={cn(
          'relative mt-6 rounded-full bg-red-500/90 px-8 py-3 text-white',
          'transition-transform duration-instant active:scale-95',
          'focus-ring',
        )}
      >
        End call
      </button>

      <span className="sr-only" aria-live="polite">{`PINGO is ${WHAT[phase]}`}</span>
      <span className="sr-only">{conversationId}</span>
    </div>
  );
}
