import { useCallback, useEffect, useRef, useState } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Transcribing while somebody is still talking.
 *
 * ## What this replaces
 *
 * A recorder that captured a whole turn, waited for the microphone to go quiet
 * for a second, uploaded the file and then waited again for a transcript. The
 * wait was the utterance, plus the silence timer, plus the transcription -
 * before the model had even been asked.
 *
 * Here the audio goes up as it is captured. Partial transcripts come back mid
 * sentence, and the moment the speaker stops the text is already finished, so
 * the only thing left to wait for is the answer itself.
 *
 * ## The end of a turn is decided by the provider
 *
 * Sarvam runs voice activity detection on the stream. That is a better judge
 * than an amplitude threshold on this side, which cannot tell a pause for
 * breath from the end of a thought - the old one waited 1100 ms to be sure, and
 * that 1100 ms was pure latency on every single turn.
 *
 * ## linear16 at 16 kHz, by hand
 *
 * `MediaRecorder` produces webm/opus, which this endpoint does not take. So the
 * microphone is read through Web Audio, downsampled, converted to signed
 * 16-bit, and sent as base64. It is the least glamorous code here and the part
 * most likely to be wrong in a way that sounds like noise.
 */

/** What Sarvam expects, and what the audio is resampled to. */
const TARGET_RATE = 16_000;

/** Bigger buffers mean fewer frames and more delay. This is about 85 ms. */
const FRAME_SIZE = 4096;

/**
 * How long a pause has to be before the turn counts as over.
 *
 * Sarvam's default is 500 ms and it is paid on every turn as pure latency -
 * dead air between somebody finishing and PINGO starting. 300 is the shortest
 * that does not cut people off mid-breath, and it comes off the front of every
 * single answer.
 */
export const SILENCE_MS = 300;

export interface LiveTranscript {
  /** Text so far for the utterance in progress. Cleared when it completes. */
  partial: string;
  /** True while the socket is open and audio is flowing. */
  listening: boolean;
  /** Set when the microphone or the socket could not be started. */
  error: string | undefined;
  start: () => Promise<void>;
  stop: () => void;
}

/** Float samples to signed 16-bit, which is what `linear16` means. */
function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    // Clamped, because a sample above 1 wraps to a loud click rather than
    // clipping quietly.
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out.buffer;
}

/** Bytes to base64, in chunks so a long frame cannot blow the argument limit. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Drop the sample rate to 16 kHz by picking the nearest sample.
 *
 * Cruder than a filtered resample and inaudible to a speech model, which is
 * looking at the shape of a vowel rather than the top octave. The alternative
 * is an `OfflineAudioContext` per frame, which is a great deal of machinery to
 * remove frequencies nobody was going to transcribe.
 */
function downsample(input: Float32Array, from: number): Float32Array {
  if (from <= TARGET_RATE) return input;
  const ratio = from / TARGET_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i += 1) out[i] = input[Math.floor(i * ratio)]!;
  return out;
}

/**
 * Below this a frame is room tone, and sending it is paying to transcribe a
 * quiet room.
 *
 * Deliberately low. Getting this wrong upward clips the first syllable of every
 * sentence, which is far worse than a few wasted frames - so it is set to catch
 * genuine silence and nothing else.
 */
const NOISE_FLOOR = 0.012;

/**
 * How long to keep sending after the last loud frame.
 *
 * The detector decides a turn has ended by *hearing* the silence after it, so
 * the silence has to be sent. Gating it away is what made PINGO sit on
 * "listening" when somebody paused mid-sentence: it received no audio at all,
 * which is not the same thing as receiving quiet, so it never called the turn.
 *
 * Comfortably longer than the 300 ms window, so the end of a turn is always
 * decided by the provider hearing a real pause rather than by this running out.
 */
const TRAIL_MS = 1200;

/**
 * Frames of audio kept from just before speech starts.
 *
 * A voice-activity detector needs a lead-in: handed audio that begins exactly
 * at the first vowel, it clips the consonant in front of it. Half a second of
 * pre-roll is held back and flushed the moment something is heard, so gating on
 * silence costs nothing at the start of a sentence.
 */
const PREROLL_FRAMES = 6;

export interface LiveTranscriptOptions {
  /** A completed utterance. Fires the instant the provider says it ended. */
  onFinal: (text: string) => void;
  /**
   * The utterance so far, as it is being said.
   *
   * Enough to stop on. Waiting for the settled sentence before reacting to an
   * interruption means talking over somebody for another half second after they
   * started, which is exactly the thing being interrupted about.
   */
  onPartial?: (text: string) => void;
  /** Live loudness for whatever is drawing, read rather than pushed. */
  onLevel?: (level: number) => void;
  /**
   * Whether audio should be going up at all right now.
   *
   * Read per frame rather than passed as state. The socket used to stream from
   * the moment the call screen opened and never stop - through PINGO thinking,
   * PINGO talking, and every silence in between - at about 700 frames a minute.
   * A few conversations came to 210 provider requests.
   *
   * Nothing about the connection changes; it stays open so the next turn does
   * not pay for a handshake. Only the audio stops.
   */
  shouldSend?: () => boolean;
  /**
   * The provider heard somebody start talking.
   *
   * This is what makes interrupting possible: while PINGO is speaking the
   * microphone is still open, and the first sign of a voice is the signal to
   * stop. Without it an assistant talks over the person trying to correct it,
   * which is the thing that makes one feel like a recording rather than a
   * conversation.
   */
  onSpeechStart?: () => void;
  /**
   * The provider heard the utterance end.
   *
   * Fires slightly before the final text, so the screen can change state while
   * the last word is still settling rather than after it.
   */
  onSpeechEnd?: () => void;
}

export function useLiveTranscript({
  onFinal,
  onPartial,
  onLevel,
  onSpeechEnd,
  onSpeechStart,
  shouldSend,
}: LiveTranscriptOptions): LiveTranscript {
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();

  const socket = useRef<WebSocket | undefined>(undefined);
  const context = useRef<AudioContext | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const node = useRef<ScriptProcessorNode | undefined>(undefined);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  const partialRef = useRef(onPartial);
  partialRef.current = onPartial;
  const levelRef = useRef(onLevel);
  levelRef.current = onLevel;
  const endedRef = useRef(onSpeechEnd);
  endedRef.current = onSpeechEnd;
  const sendingRef = useRef(shouldSend);
  sendingRef.current = shouldSend;
  const startedRef = useRef(onSpeechStart);
  startedRef.current = onSpeechStart;

  const stop = useCallback(() => {
    setListening(false);
    setPartial('');
    try { socket.current?.send(JSON.stringify({ event: 'end' })); } catch { /* closing */ }
    try { socket.current?.close(); } catch { /* closing */ }
    socket.current = undefined;
    node.current?.disconnect();
    node.current = undefined;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;
    void context.current?.close().catch(() => undefined);
    context.current = undefined;
  }, []);

  // Leaving the screen must release the microphone. Nothing worse than a call
  // that keeps listening after it is closed.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError(undefined);
    try {
      /*
       * The microphone first, because it is the thing that can be refused. A
       * socket opened before the permission dialog is a socket billed while
       * somebody reads a prompt.
       */
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser will not give PINGO the microphone. Try Chrome, over https.');
        return;
      }
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = media;

      const client = getSupabaseClient();
      const {
        data: { session },
      } = await client.auth.getSession();
      const base = import.meta.env.VITE_SUPABASE_URL?.replace(/^http/, 'ws').replace(/\/$/, '');
      if (!session?.access_token || !base) {
        setError('Not signed in.');
        stop();
        return;
      }

      const ws = new WebSocket(
        `${base}/functions/v1/stt-stream?jwt=${encodeURIComponent(session.access_token)}` +
          `&silence_duration_ms=${SILENCE_MS}`,
      );
      socket.current = ws;

      ws.onmessage = (frame) => {
        /*
         * `event` and a top-level `text`, which is not what the first version
         * read.
         *
         * It looked for `type` and `data.text` - a shape from the documentation
         * page rather than the wire - so nothing ever matched and transcription
         * silently did nothing at all. Confirmed against the live socket:
         *
         *   {"event":"transcript.final","utterance_idx":0,"text":"Haan bhai, …"}
         */
        let message: { event?: string; text?: string };
        try {
          message = JSON.parse(String(frame.data));
        } catch {
          return;
        }

        const text = message.text?.trim();
        if (message.event === 'transcript.partial' && text) {
          setPartial(text);
          partialRef.current?.(text);
        }
        if (message.event === 'transcript.final') {
          setPartial('');
          if (text) finalRef.current(text);
        }

        /*
         * Speech ending is worth knowing a beat before the words settle: the
         * screen can stop saying "listening" while the last fragment lands,
         * which is the difference between feeling answered and feeling ignored.
         */
        if (message.event === 'vad.speech_start') startedRef.current?.();
        if (message.event === 'vad.speech_end') endedRef.current?.();
      };
      ws.onerror = () => setError('The transcriber dropped out.');

      const audio = new AudioContext();
      context.current = audio;
      const source = audio.createMediaStreamSource(media);

      /*
       * `ScriptProcessorNode` is deprecated and is still the only thing that
       * works everywhere this ships. An `AudioWorklet` needs a separate module
       * file served with the right type, and the Android WebView has been
       * inconsistent about it. Deprecated and working beats modern and silent.
       */
      const processor = audio.createScriptProcessor(FRAME_SIZE, 1, 1);
      node.current = processor;

      /*
       * A rolling lead-in, so gating on silence never eats the first consonant.
       *
       * Frames below the floor are held here instead of sent. When speech does
       * start, this goes up in front of it - which is what a VAD needs to hear
       * the attack of a word rather than its middle.
       */
      const preroll: string[] = [];

      /*
       * When something was last actually said.
       *
       * While this is recent, every frame goes up including the quiet ones -
       * that quiet is the evidence the turn is over. Only once nobody has
       * spoken for a while does the gate close again and stop paying to
       * transcribe an empty room.
       */
      let lastVoice = 0;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);

        let peak = 0;
        for (let i = 0; i < input.length; i += 1) {
          const size = Math.abs(input[i]!);
          if (size > peak) peak = size;
        }
        levelRef.current?.(Math.min(1, peak * 2.2));

        if (ws.readyState !== WebSocket.OPEN) return;

        /*
         * Not our turn. The socket stays open - a handshake per turn would be
         * latency where this whole change is about removing it - but nothing
         * goes up while PINGO is thinking or talking.
         */
        if (sendingRef.current && !sendingRef.current()) {
          preroll.length = 0;
          return;
        }

        const encoded = toBase64(toPcm16(downsample(input, audio.sampleRate)));

        if (peak < NOISE_FLOOR) {
          /*
           * Quiet, and it matters which kind.
           *
           * Inside a turn it is the pause the detector is waiting for, so it
           * goes up. Outside one it is an empty room, so it is held in the
           * lead-in and nothing is sent.
           */
          if (Date.now() - lastVoice < TRAIL_MS) {
            ws.send(JSON.stringify({ event: 'audio_input', audio: encoded }));
            return;
          }
          preroll.push(encoded);
          if (preroll.length > PREROLL_FRAMES) preroll.shift();
          return;
        }

        lastVoice = Date.now();

        for (const held of preroll.splice(0)) {
          ws.send(JSON.stringify({ event: 'audio_input', audio: held }));
        }
        ws.send(JSON.stringify({ event: 'audio_input', audio: encoded }));
      };

      source.connect(processor);
      /*
       * Connected to the destination with no gain of its own. A
       * `ScriptProcessorNode` that reaches nothing is not pulled by the graph
       * and simply stops firing - it does not error, it goes quiet, which is a
       * long afternoon if you do not know it.
       */
      const mute = audio.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(audio.destination);

      setListening(true);
    } catch (cause) {
      stop();
      setError(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'PINGO needs the microphone. Allow it and press call again.'
          : cause instanceof DOMException && cause.name === 'NotFoundError'
            ? 'No microphone found on this device.'
            : 'The microphone could not be started.',
      );
    }
  }, [stop]);

  return { partial, listening, error, start, stop };
}
