import { PlusIcon, SendIcon, cn } from '@pingo/ui';

import { useCallback, useEffect, useRef, useState } from 'react';

import { speakStreaming, type Speech } from '../chat/speak.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { useLiveTranscript } from './useLiveTranscript.js';
import { VoiceWave } from './VoiceWave.js';

/**
 * Talking to PINGO out loud.
 *
 * ## Transcribing under the talking, not after it
 *
 * The first version recorded a whole turn, waited for the microphone to go
 * quiet for a second, uploaded the file and waited again for a transcript. The
 * wait was the utterance, plus the silence timer, plus the transcription - all
 * before the model had been asked anything.
 *
 * Now the audio streams as it is captured. Partial transcripts come back
 * mid-sentence, the provider's own voice-activity detection decides where the
 * turn ended, and by the time somebody stops talking the text is finished. The
 * only thing left to wait for is the answer.
 *
 * It is also billed per minute of audio rather than per request, which is the
 * opposite of the batch path where every turn was its own charge.
 *
 * ## Turn-taking, still
 *
 * PINGO cannot be interrupted mid-sentence. A genuinely full-duplex agent needs
 * a server holding audio state and a GPU on the other end; NVIDIA's own
 * blueprint for it wants 72 GB of VRAM. The screen says so plainly rather than
 * letting somebody discover it by talking over an answer.
 */

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

/** One piece of the reply, spoken by the server. Undefined falls back. */
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
 * JPEG rather than PNG: these are photographs, and a lossless format for a
 * photograph is several megabytes spent on nothing.
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
   * Sends the turn and resolves with what PINGO said.
   *
   * Passed in rather than reached for: the thread owns the conversation and
   * this screen owns the microphone. Keeping it that way means a spoken turn
   * takes exactly the path a typed one does - same model routing, same memory,
   * same filters - and is still in the thread afterwards to scroll back through.
   */
  ask: (text: string) => Promise<string | undefined>;
}

export function VoiceCall({ conversationId, onEnd, ask }: VoiceCallProps) {
  const [phase, setPhase] = useState<Phase>('listening');
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');
  const [typed, setTyped] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  const speech = useRef<Speech | undefined>(undefined);
  const live = useRef(true);

  /*
   * Read per frame by the canvas, never passed as a prop.
   *
   * A prop would be a React render per sample and would restart the animation
   * loop each time - which is precisely why the line used to judder while the
   * user spoke and stayed smooth while PINGO did.
   */
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const micLevel = useRef(0);

  const level = useCallback(
    () => (phaseRef.current === 'speaking' ? (speech.current?.level() ?? 0) : micLevel.current),
    [],
  );
  const active = useCallback(
    () => phaseRef.current === 'listening' || phaseRef.current === 'speaking',
    [],
  );

  /**
   * Everything after the words exist: ask, speak, back to listening.
   *
   * Shared by the microphone, the text field and a shared photo on purpose - a
   * turn must not behave differently depending on where its sentence came from.
   */
  const answer = useCallback(
    async (words: string) => {
      if (!live.current) return;
      setHeard(words);
      setPhase('thinking');
      const reply = await ask(words);
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
   * A completed utterance, the moment the provider says it ended.
   *
   * Nothing is uploaded or transcribed here - both already happened while the
   * sentence was being said. This is only the handover.
   */
  const transcript = useLiveTranscript({
    onFinal: (text) => {
      /*
       * A turn that lands while PINGO is talking is somebody talking over it.
       * Dropped rather than queued: answering a question from thirty seconds
       * ago is worse than missing it.
       */
      if (phaseRef.current !== 'listening') return;
      void answer(text);
    },
    onLevel: (value) => {
      micLevel.current = value;
    },
  });

  /*
   * Everything stops when the screen goes.
   *
   * A call that keeps talking after it is closed is the worst bug this feature
   * could have, so the flag is checked at every await and the teardown is
   * unconditional. The microphone is released by the hook's own cleanup.
   */
  useEffect(
    () => () => {
      live.current = false;
      speech.current?.stop();
    },
    [],
  );

  /*
   * One socket for the call, opened with the screen.
   *
   * Opening it per turn would put a handshake and an authentication round trip
   * in front of every sentence, which is most of what this change removed.
   */
  useEffect(() => {
    void transcript.start();
    return transcript.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A picture, looked at and then talked about.
   *
   * The chat model cannot see, so the image is described first by one that can
   * and the description is what enters the conversation. That is stated to the
   * assistant rather than hidden, because a model told it is reading a
   * description answers more carefully than one that believes it is looking at
   * a photograph.
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
    [answer],
  );

  /*
   * What the person is saying, as they say it.
   *
   * The live partial while listening, the settled sentence afterwards - so the
   * screen is never blank during the part of a call where somebody most wants
   * to know they are being heard.
   */
  const showing = phase === 'listening' ? transcript.partial || heard || 'Bolo…' : heard || ' ';

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[#050b1a] px-6">
      {/*
        The halo behind everything. Not decoration for its own sake: it puts the
        card on a stage, and it is what stops a dark screen reading as an error.
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
          // Frosted, so the halo shows through rather than being hidden by it.
          'border border-white/10 bg-white/[0.06] backdrop-blur-xl',
        )}
      >
        <div className="min-h-[3.5rem] w-full text-center">
          <p className="text-body text-white/90">{showing}</p>
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

        {transcript.error && <p className="text-caption text-red-300">{transcript.error}</p>}
      </div>

      <form
        className="relative mt-6 flex w-full max-w-sm items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const words = typed.trim();
          if (!words || phase === 'thinking' || phase === 'speaking') return;
          setTyped('');
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
          'focus-ring relative mt-6 rounded-full bg-red-500/90 px-8 py-3 text-white',
          'transition-transform duration-instant active:scale-95',
        )}
      >
        End call
      </button>

      <span className="sr-only" aria-live="polite">{`PINGO is ${WHAT[phase]}`}</span>
      <span className="sr-only">{conversationId}</span>
    </div>
  );
}
