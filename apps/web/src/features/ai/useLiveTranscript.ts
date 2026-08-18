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

export interface LiveTranscriptOptions {
  /** A completed utterance. Fires the instant the provider says it ended. */
  onFinal: (text: string) => void;
  /** Live loudness for whatever is drawing, read rather than pushed. */
  onLevel?: (level: number) => void;
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
  onLevel,
  onSpeechEnd,
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
  const levelRef = useRef(onLevel);
  levelRef.current = onLevel;
  const endedRef = useRef(onSpeechEnd);
  endedRef.current = onSpeechEnd;

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
        if (message.event === 'transcript.partial' && text) setPartial(text);
        if (message.event === 'transcript.final') {
          setPartial('');
          if (text) finalRef.current(text);
        }

        /*
         * Speech ending is worth knowing a beat before the words settle: the
         * screen can stop saying "listening" while the last fragment lands,
         * which is the difference between feeling answered and feeling ignored.
         */
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

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);

        if (levelRef.current) {
          let peak = 0;
          for (let i = 0; i < input.length; i += 1) {
            const size = Math.abs(input[i]!);
            if (size > peak) peak = size;
          }
          levelRef.current(Math.min(1, peak * 2.2));
        }

        if (ws.readyState !== WebSocket.OPEN) return;
        const pcm = toPcm16(downsample(input, audio.sampleRate));
        ws.send(JSON.stringify({ event: 'audio_input', audio: toBase64(pcm) }));
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
