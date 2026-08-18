import { ChevronLeftIcon, EditIcon, PhoneIcon, PlusIcon, SendIcon, cn } from '@pingo/ui';

import { useCallback, useEffect, useRef, useState } from 'react';

import { openSpeech, type Speech } from '../chat/speak.js';
import { isEcho } from './echo.js';
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

/**
 * The line PINGO opens with, before anybody has said anything.
 *
 * A call that opens in silence puts the work on the person who just started it:
 * they hold a phone to their face and wait to find out whether the thing is
 * listening. Every assistant worth the name speaks first, and the first line is
 * doing one job - proving the microphone, the model and the voice are all
 * already up - so it is short and it invites an answer.
 *
 * Not a model call. It is the same three sentences forever, and asking a 120B
 * model to improvise a greeting would put four seconds of thinking in front of
 * a call that is meant to feel instant. Straight to the voice.
 *
 * Three of them because a fixed greeting on the twentieth call is a recording,
 * and a stranger's app that says exactly the same words every time is the
 * clearest possible signal that nobody is home.
 */
const HELLOS = [
  'Haan bolo, kya chal raha hai dimaag mein?',
  'Bolo bhai, kya scene hai?',
  'Sun raha hoon. Bolo kya baat hai?',
];

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
  ask: (
    text: string,
    onStage?: (stage: string) => void,
    onSentence?: (sentence: string) => void,
  ) => Promise<string | undefined>;
}


export function VoiceCall({ conversationId, onEnd, ask }: VoiceCallProps) {
  const [phase, setPhase] = useState<Phase>('speaking');
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');
  const [typed, setTyped] = useState('');
  /*
   * Typing, which is the fallback and looks like one.
   *
   * Closed by default: a text field open on a voice call is the screen saying
   * it does not expect the voice half to work.
   */
  const [keyboard, setKeyboard] = useState(false);
  /*
   * What the assistant is actually doing, streamed from the function.
   *
   * The screen used to say "thinking" for everything between the question and
   * the voice, which covers reading the thread, two possible model calls and
   * the reply being shaped. On a call that is the longest silence of the whole
   * exchange, and a single word for all of it tells somebody nothing about
   * whether to keep waiting.
   */
  const [stage, setStage] = useState<string>();
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

  /*
   * What PINGO is currently saying, for telling an interruption from an echo.
   *
   * A speaker plays into the microphone. Browser echo cancellation removes most
   * of it and not all - on a phone held at arm's length, almost none - so the
   * detector hears a voice, calls it speech, and PINGO stops itself mid-sentence
   * while nobody has said a word. That is the reported bug: it sits paused
   * waiting for a person who is not talking.
   *
   * The only reliable difference between an echo and an interruption is *what
   * the words are*. An echo transcribes as PINGO's own sentence.
   */
  const saying = useRef('');

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
      setStage(undefined);
      setSaid('');
      saying.current = '';

      /*
       * Speaking starts on the first sentence, not on the finished answer.
       *
       * The model streams, so a sentence exists long before the reply does.
       * Handing it straight to the voice means the two overlap - the rest is
       * still being written while the first line is already being said, which
       * is the whole difference between an answer that arrives and one that
       * begins.
       */
      const queue = openSpeech(fetchSentence);
      speech.current = queue.speech;

      /*
       * A turn that throws must still end.
       *
       * Without this, a failed send - a dropped connection, a function that
       * five-hundreds - rejects out of here and the screen keeps saying
       * "thinking" for as long as somebody is willing to hold the phone. There
       * is no way back from that except closing the call, which is how a
       * hiccup becomes a broken feature.
       */
      let reply: string | undefined;
      try {
        reply = await ask(words, setStage, (sentence) => {
          if (!live.current) return;
          if (phaseRef.current !== 'speaking') setPhase('speaking');
          setSaid((before) => (before ? `${before} ${sentence}` : sentence));
          saying.current = `${saying.current} ${sentence}`.trim();
          queue.push(sentence);
        });
      } catch {
        queue.end();
        if (live.current) {
          setPhase('error');
          window.setTimeout(() => live.current && setPhase('listening'), 1600);
        }
        return;
      }

      if (!live.current) {
        queue.end();
        return;
      }

      /*
       * Nothing was streamed - an older deploy, a fallback, a turn that failed.
       * The finished reply is spoken instead, which is what used to happen for
       * every turn.
       */
      if (!queue.started && reply) {
        setSaid(reply);
        setPhase('speaking');
        queue.push(reply);
      }

      queue.end();

      if (!reply && !queue.started) {
        setPhase('error');
        window.setTimeout(() => live.current && setPhase('listening'), 1600);
        return;
      }

      await queue.speech.done;
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
       * Arriving mid-answer means one of two things, and they are opposites.
       *
       * Either somebody talked over PINGO - which is a real turn and should be
       * taken - or the microphone heard PINGO itself and transcribed it back.
       * Echo is filtered out; anything left is a person, and a person who
       * interrupted has been waiting since they started.
       */
      if (phaseRef.current === 'speaking') {
        if (isEcho(text, saying.current)) return;
        speech.current?.stop();
        speech.current = undefined;
      } else if (phaseRef.current !== 'listening') {
        return;
      }
      void answer(text);
    },
    /*
     * The live partial is enough to stop on, and stopping fast is the whole
     * point - waiting for the settled sentence means talking over somebody for
     * another half second after they started.
     */
    onPartial: (text) => {
      if (phaseRef.current !== 'speaking') return;
      if (text.trim().length < 6) return;
      if (isEcho(text, saying.current)) return;
      speech.current?.stop();
      speech.current = undefined;
      setPhase('listening');
    },
    onLevel: (value) => {
      micLevel.current = value;
    },
    /*
     * Only while it is the person's turn.
     *
     * The socket stays open either way - a handshake per turn would be latency
     * where all of this is about removing it - but audio stops going up while
     * PINGO is thinking or talking. It used to stream from the moment the screen
     * opened until it closed, at about 700 frames a minute.
     */
    /*
     * Listening, and also while speaking - which is what allows an interruption
     * to be heard at all. Not while thinking: there is nothing to interrupt yet
     * and it is the one stretch with no sound to talk over.
     */
    shouldSend: () => phaseRef.current === 'listening' || phaseRef.current === 'speaking',
    /*
     * Somebody has started talking over the answer. Stop it.
     *
     * Cutting PINGO off mid-word is exactly right here: they are interrupting
     * because they have heard enough, and finishing the sentence anyway is what
     * makes an assistant feel like it is reading from a script.
     */
    /*
     * Not acted on by itself.
     *
     * Voice activity during playback is far more often the speaker than a
     * person - stopping on it alone is how PINGO ended up interrupting itself
     * on every single answer. The decision waits for words, below.
     */
    onSpeechStart: () => {},
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

  /*
   * PINGO speaks first.
   *
   * Straight into the same queue a real answer uses, so it is interrupted the
   * same way, drawn by the same wave and filtered out of the microphone by the
   * same echo test - `saying` is set for exactly that reason. It is the one
   * turn in the call with no question in front of it.
   */
  useEffect(() => {
    const hello = HELLOS[Math.floor(Math.random() * HELLOS.length)]!;
    setSaid(hello);
    saying.current = hello;

    const queue = openSpeech(fetchSentence);
    speech.current = queue.speech;
    queue.push(hello);
    queue.end();

    void queue.speech.done.then(() => {
      if (speech.current === queue.speech) speech.current = undefined;
      if (live.current && phaseRef.current === 'speaking') setPhase('listening');
    });
    // Once, with the screen. Everything it touches is a ref or a setter.
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
   * The one line of text the screen is about, and whose line it is.
   *
   * Two columns of transcript - yours on one side, PINGO's on the other - is
   * how a debugging view looks. A call has exactly one speaker at a time, so
   * the screen shows exactly one thing: the partial while somebody is talking,
   * the answer while PINGO is, and what was heard while it thinks about it.
   */
  const speakingNow = phase === 'speaking' || (phase === 'thinking' && !heard);
  const line = speakingNow
    ? said
    : phase === 'listening'
      ? transcript.partial || heard
      : heard;

  /** Who the words on screen belong to, which is the only label needed. */
  const whose = speakingNow ? 'PINGO' : 'You';

  return (
    <div
      className={cn(
        /*
         * Above the dock, which sits at 200.
         *
         * At the old `z-50` the navigation bar and the chats list floated over
         * the call - three quiet grey glyphs and a list of other conversations
         * drawn on top of a screen whose whole job is that you are talking to
         * somebody. A call is modal by nature; this is the number that says so.
         */
        'fixed inset-0 z-400 flex flex-col overflow-hidden bg-[#07080d] text-white',
        /*
         * Rising from the bottom edge, because that is the edge it was summoned
         * from. The gesture is a hold at the bottom of the screen and the
         * answer to it travels the same axis - which is the whole reason both
         * phones animate their assistant this way rather than fading it in.
         */
        'motion-safe:animate-call-in',
      )}
    >
      {/*
        Light, in three layers, none of it decoration.

        A single flat radial gradient is what the first version had, and a flat
        gradient behind a moving line reads as a screenshot with an animation
        pasted on. These drift at different speeds and different sizes, so the
        background is never quite the same twice - the same trick a lava lamp
        plays, and the reason a dark screen can feel awake rather than off.

        Brightened while PINGO is speaking and dimmed while it thinks, so the
        room itself carries the state and the caption underneath is confirming
        something the eye already knows.
      */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 transition-opacity duration-slow ease-liquid',
          phase === 'speaking' ? 'opacity-100' : phase === 'thinking' ? 'opacity-55' : 'opacity-80',
        )}
      >
        <div
          className="absolute -top-1/4 left-1/2 h-[80vh] w-[120vw] -translate-x-1/2 rounded-[50%] blur-[80px] motion-safe:animate-aurora-drift"
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in srgb, var(--gradient-from, #7c5cff) 78%, transparent), transparent 70%)',
          }}
        />
        {/*
          The second one sits behind the wave rather than at the bottom edge.

          Down there it was light leaking in from off-screen, which is only ever
          background. Here the line is *in* it - the pool of colour is centred on
          the one thing that moves, so the light reads as coming off the voice
          rather than off the wallpaper.
        */}
        <div
          className="absolute top-[38%] left-1/2 h-[55vh] w-[105vw] -translate-x-1/2 rounded-[50%] blur-[90px] motion-safe:animate-aurora-drift-slow"
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in srgb, var(--gradient-to, #3a8dff) 70%, transparent), transparent 72%)',
          }}
        />
        {/* A vignette, so the controls at the edges keep their contrast. */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_45%,transparent_42%,rgba(3,4,8,0.72)_100%)]" />
      </div>

      {/*
        The header does two jobs and no more: say whose call this is, and give
        the way out. Anything else up here competes with the only thing that
        matters, which is in the middle of the screen.
      */}
      <header className="relative z-10 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onEnd}
          aria-label="Close the call"
          className={cn(
            'focus-ring grid size-10 place-items-center rounded-full',
            'bg-white/[0.07] text-white/80 backdrop-blur-md',
            'transition-transform duration-instant active:scale-95',
          )}
        >
          <ChevronLeftIcon size={20} />
        </button>

        <div className="flex items-center gap-2">
          {/*
            A live dot, and it is not always green.

            It pulses only while the microphone is actually open. During
            thinking it is still - which is the honest picture, because nothing
            is being heard then, and a permanently blinking "live" light is the
            kind of detail that makes people distrust everything next to it.
          */}
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              phase === 'listening'
                ? 'bg-emerald-400 motion-safe:animate-dot-pulse'
                : phase === 'error'
                  ? 'bg-red-400'
                  : 'bg-white/35',
            )}
          />
          <span className="text-caption font-medium tracking-wide text-white/70">PINGO</span>
        </div>

        {/* Balances the close button so the name sits truly centred. */}
        <span aria-hidden className="size-10" />
      </header>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        {/*
          Whose voice it is, above the words.

          Small, uppercase, low contrast - a label rather than content. Without
          it, a reply and a transcript of your own sentence look identical, and
          on a call that is the one ambiguity that makes people repeat
          themselves.
        */}
        <p
          className={cn(
            'text-caption mb-3 font-medium tracking-[0.18em] uppercase',
            'transition-colors duration-base',
            speakingNow ? 'text-white/45' : 'text-white/30',
          )}
        >
          {line ? whose : ''}
        </p>

        {/*
          The words. Sized to be read at arm's length, which is where a phone is
          during a call, and clamped so a long answer cannot push the wave off
          the screen.
        */}
        <p
          className={cn(
            'min-h-[4.5rem] max-w-md text-center text-balance',
            'text-xl leading-snug font-light',
            'transition-opacity duration-base ease-liquid',
            line ? 'text-white/95 opacity-100' : 'text-white/40 opacity-100',
            'line-clamp-3',
          )}
        >
          {line || (phase === 'listening' ? 'Bolo, main sun raha hoon…' : '')}
        </p>

        {/* The line itself. Everything above and below is context for it. */}
        <div className="mt-6 h-32 w-full max-w-md">
          <VoiceWave level={level} active={active} />
        </div>

        {/*
          What it is doing, in its own words.

          The function reports its stage - reading the thread, asking the big
          model, shaping the reply - and this is where it lands. It is the
          longest silence in the exchange and the only place the screen can say
          why.
        */}
        <p
          className="text-caption mt-4 h-5 text-white/40"
          aria-live="polite"
        >
          {phase === 'thinking' ? (stage ?? 'soch raha hoon…') : WHAT[phase]}
        </p>

        {transcript.error && (
          <p className="text-caption mt-2 max-w-xs text-center text-red-300">{transcript.error}</p>
        )}
      </main>

      <footer className="relative z-10 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/*
          Typing is a fallback, so it lives behind a key rather than in front of
          it. A text field sitting open on a voice call says the voice part is
          not trusted - and it takes the space the answer should have.
        */}
        {keyboard && (
          <form
            className="motion-safe:animate-panel-in mx-auto mb-4 flex w-full max-w-md items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const words = typed.trim();
              if (!words || phase === 'thinking' || phase === 'speaking') return;
              setTyped('');
              setKeyboard(false);
              void answer(words);
            }}
          >
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Ya likh do…"
              aria-label="Type instead of speaking"
              autoFocus
              className={cn(
                'focus-ring text-body min-w-0 flex-1 rounded-full px-4 py-2.5',
                'border border-white/10 bg-white/[0.07] text-white placeholder:text-white/35',
                'backdrop-blur-md',
              )}
            />
            <button
              type="submit"
              disabled={!typed.trim() || phase === 'thinking' || phase === 'speaking'}
              aria-label="Send"
              className={cn(
                'focus-ring grid size-11 shrink-0 place-items-center rounded-full',
                'bg-white/15 text-white transition-transform duration-instant',
                'active:scale-95 disabled:opacity-30',
              )}
            >
              <SendIcon size={18} />
            </button>
          </form>
        )}

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

        {/*
          Three controls, and the one that ends the call is the only one with a
          colour.

          The old screen had a red pill that said "End call" in words, which is
          the largest and loudest thing on a screen whose subject is a moving
          line. Every phone in the world draws this as a round red key between
          two quiet ones; there is no reason to be the exception, and being the
          exception here reads as a prototype.
        */}
        <div className="mx-auto flex w-full max-w-xs items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={phase === 'thinking' || phase === 'speaking'}
            aria-label="Send a photo to look at"
            className={cn(
              'focus-ring grid size-14 place-items-center rounded-full',
              'border border-white/10 bg-white/[0.07] text-white/85 backdrop-blur-md',
              'transition-transform duration-instant active:scale-95 disabled:opacity-25',
            )}
          >
            <PlusIcon size={22} />
          </button>

          <button
            type="button"
            onClick={onEnd}
            aria-label="End call"
            className={cn(
              'focus-ring grid size-16 place-items-center rounded-full',
              'bg-red-500 text-white',
              // Lit along the top and dropping a red shadow: a key with a
              // surface, matching the camera key in the dock.
              'shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_10px_28px_-10px_rgb(239_68_68/0.9)]',
              'transition-transform duration-instant active:scale-95',
            )}
          >
            {/* A handset turned over is "hang up" everywhere, in every app. */}
            <PhoneIcon size={24} className="rotate-[135deg]" />
          </button>

          <button
            type="button"
            onClick={() => setKeyboard((open) => !open)}
            aria-label={keyboard ? 'Hide the keyboard' : 'Type instead of speaking'}
            aria-pressed={keyboard}
            className={cn(
              'focus-ring grid size-14 place-items-center rounded-full',
              'border border-white/10 backdrop-blur-md',
              'transition-transform duration-instant active:scale-95',
              keyboard ? 'bg-white/20 text-white' : 'bg-white/[0.07] text-white/85',
            )}
          >
            <EditIcon size={20} />
          </button>
        </div>
      </footer>

      <span className="sr-only" aria-live="polite">{`PINGO is ${WHAT[phase]}`}</span>
      <span className="sr-only">{conversationId}</span>
    </div>
  );
}
