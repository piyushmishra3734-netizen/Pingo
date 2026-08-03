import { useCallback, useEffect, useRef, useState } from 'react';

import { speechAudioConstraints } from '../../lib/audio/capture.js';
import {
  concatFloat32,
  encodePcmToWavBlob,
  toPlayableVoiceBlob,
  VOICE_WAV_RATE,
} from '../../lib/audio/wav.js';

/**
 * Recording a voice note.
 *
 * ## Always upload WAV (receiver must hear it)
 *
 * MediaRecorder WebM/Opus is not playable on many Safari/iOS receivers.
 * While recording we capture raw PCM from the mic graph and encode a mono
 * WAV on stop. That is what gets sent — not a browser-specific container.
 *
 * ## The microphone is released the moment recording stops
 *
 * Every track is stopped on finish, on cancel and on unmount.
 */

/** Bars in a waveform. Enough to read a rhythm, few enough to stay legible. */
const WAVEFORM_BARS = 48;

/** Recording stops itself here. Past this it is a memo, not a message. */
const MAX_SECONDS = 300;

/**
 * How often the level meter may re-render, in milliseconds.
 *
 * Fast enough to look live, slow enough that drawing it is not competing with
 * capturing audio on the same thread.
 */
const METER_INTERVAL_MS = 120;

/** Below this a "recording" is a mis-tap, not a message. */
const MIN_SECONDS = 0.4;

export interface Recording {
  blob: Blob;
  seconds: number;
  /** Normalised 0-1, one per bar. */
  waveform: number[];
}

export interface VoiceRecorder {
  recording: boolean;
  /** Seconds elapsed, updated about ten times a second. */
  elapsed: number;
  /** Live input level, 0-1, so the UI can show the mic is hearing something. */
  level: number;
  error: string | undefined;
  start: () => Promise<void>;
  /** Stops and returns the take. Undefined if it was too short to mean anything. */
  stop: () => Promise<Recording | undefined>;
  /** Throws the take away and releases the microphone. */
  cancel: () => void;
}

export function useVoiceRecorder(): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string>();

  const stream = useRef<MediaStream | undefined>(undefined);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const processor = useRef<ScriptProcessorNode | undefined>(undefined);
  const pcmChunks = useRef<Float32Array[]>([]);
  const sampleRate = useRef(48_000);
  const recordingRef = useRef(false);
  const meter = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const teardown = useCallback(() => {
    recordingRef.current = false;
    if (timer.current) clearInterval(timer.current);
    if (meter.current) clearInterval(meter.current);
    timer.current = undefined;
    meter.current = undefined;

    try {
      processor.current?.disconnect();
    } catch {
      // already gone
    }
    processor.current = undefined;

    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;

    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = undefined;

    setRecording(false);
    setLevel(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setError(undefined);
    pcmChunks.current = [];
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: speechAudioConstraints({ hd: true }),
      });
      stream.current = media;

      const context = new AudioContext();
      // Some engines ignore the constructor rate; trust context.sampleRate.
      if (context.state === 'suspended') {
        await context.resume().catch(() => undefined);
      }
      audioContext.current = context;
      sampleRate.current = context.sampleRate || 48_000;

      const source = context.createMediaStreamSource(media);
      // ScriptProcessor is deprecated but universal — captures PCM on every device.
      const node = context.createScriptProcessor(4096, 1, 1);
      processor.current = node;
      /*
       * Copy the audio first, then think about the meter.
       *
       * `ScriptProcessor` runs on the main thread: whatever this callback does
       * is time the browser is not spending on the next buffer, and a buffer
       * that arrives late is silently dropped. The level meter used to call
       * `setLevel` on every callback — a React render roughly twelve times a
       * second, inside the audio path — so a busy moment in the app turned into
       * gaps in the recording.
       *
       * The meter is throttled to something an eye can follow. The PCM copy
       * stays first and unconditional, because dropping a buffer to draw a bar
       * is the wrong way round.
       */
      let lastMeter = 0;
      node.onaudioprocess = (event) => {
        if (!recordingRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        pcmChunks.current.push(new Float32Array(input));

        const now = event.timeStamp || Date.now();
        if (now - lastMeter < METER_INTERVAL_MS) return;
        lastMeter = now;

        let peak = 0;
        for (let i = 0; i < input.length; i += 1) {
          peak = Math.max(peak, Math.abs(input[i]!));
        }
        setLevel(peak);
      };

      // Must connect to destination or some browsers never fire onaudioprocess.
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(context.destination);

      startedAt.current = Date.now();
      recordingRef.current = true;
      setRecording(true);
      setElapsed(0);

      timer.current = setInterval(() => {
        const seconds = (Date.now() - startedAt.current) / 1000;
        setElapsed(seconds);
        if (seconds >= MAX_SECONDS) {
          // Caller will stop via UI max; also freeze capture.
          recordingRef.current = false;
        }
      }, 100);
    } catch (cause) {
      teardown();
      setError(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'PINGO needs microphone access to record.'
          : 'The microphone could not be started.',
      );
    }
  }, [teardown]);

  const stop = useCallback(async (): Promise<Recording | undefined> => {
    if (!recordingRef.current && pcmChunks.current.length === 0) {
      teardown();
      return undefined;
    }

    // Stop accepting more PCM first so the last callback cannot race.
    recordingRef.current = false;
    const seconds = (Date.now() - startedAt.current) / 1000;
    const rate = sampleRate.current;
    const chunks = pcmChunks.current;
    pcmChunks.current = [];

    teardown();

    if (seconds < MIN_SECONDS || chunks.length === 0) return undefined;

    const samples = concatFloat32(chunks);
    // Reject pure silence (broken mic path) so we never send a "working" empty note.
    let peak = 0;
    for (let i = 0; i < samples.length; i += 16) {
      peak = Math.max(peak, Math.abs(samples[i]!));
    }
    if (peak < 0.0008) {
      setError('No sound detected. Check the microphone and try again.');
      return undefined;
    }

    let blob = encodePcmToWavBlob(samples, rate, VOICE_WAV_RATE);
    // Safety net: if something went wrong with PCM, try Media-less empty guard.
    if (!blob.size || blob.type !== 'audio/wav') {
      blob = await toPlayableVoiceBlob(blob);
    }
    if (!blob.size) return undefined;

    const waveform = peaksFromSamples(samples);
    return { blob, seconds, waveform };
  }, [teardown]);

  return {
    recording,
    elapsed,
    level,
    error,
    start,
    stop,
    cancel: teardown,
  };
}

function peaksFromSamples(samples: Float32Array): number[] {
  const per = Math.floor(samples.length / WAVEFORM_BARS) || 1;
  const bars: number[] = [];
  let loudest = 0;

  for (let bar = 0; bar < WAVEFORM_BARS; bar += 1) {
    let peak = 0;
    const from = bar * per;
    for (let i = from; i < from + per && i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i]!));
    }
    bars.push(peak);
    loudest = Math.max(loudest, peak);
  }

  return loudest > 0 ? bars.map((value) => value / loudest) : bars.map(() => 0.2);
}
