import { useCallback, useEffect, useRef, useState } from 'react';

import { speechAudioConstraints } from '../../lib/audio/capture.js';
import { PCM_WORKLET_SOURCE } from '../../lib/audio/pcm-worklet.js';
import {
  concatFloat32,
  encodePcmToWavBlob,
  normalisePeak,
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
  /**
   * The five-minute ceiling was reached.
   *
   * Capture and the microphone have stopped; the take is still there and can
   * still be sent. The bar says so rather than pretending to still be listening.
   */
  capped: boolean;
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
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string>();

  const stream = useRef<MediaStream | undefined>(undefined);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const processor = useRef<ScriptProcessorNode | undefined>(undefined);
  const workletNode = useRef<AudioWorkletNode | undefined>(undefined);
  const pcmChunks = useRef<Float32Array[]>([]);
  const sampleRate = useRef(48_000);
  const recordingRef = useRef(false);
  const meter = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  /**
   * Which attempt is the current one.
   *
   * `start` awaits three things — the permission prompt, the context resuming,
   * the worklet module loading — and any of them can still be in flight when
   * the take is cancelled, the hold is released, or the screen is left. Every
   * one of those resolutions used to carry on setting up a microphone nobody
   * was waiting for: the stream was assigned after teardown had already run, so
   * the device stayed live with the browser's recording indicator on until the
   * tab was closed. The counter is bumped by teardown; a resolution that finds
   * itself out of date releases what it was handed and stops.
   */
  const attempt = useRef(0);

  /**
   * Let go of the microphone and the audio graph, keeping the take.
   *
   * Separate from `teardown` because the five-minute ceiling needs exactly
   * this: stop listening, release the device — the browser's recording
   * indicator is a promise to the person in the room — but leave the recorded
   * audio and the composer's bar alone so it can still be sent.
   */
  const releaseInput = useCallback(() => {
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

    try {
      // Closing the port first stops any block already in flight from landing
      // in the next recording's chunks.
      if (workletNode.current) workletNode.current.port.onmessage = null;
      workletNode.current?.disconnect();
    } catch {
      // already gone
    }
    workletNode.current = undefined;

    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;

    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = undefined;

    setLevel(0);
  }, []);

  const teardown = useCallback(() => {
    // Anything still being awaited inside `start` belongs to a take that is
    // over. See `attempt`.
    attempt.current += 1;
    releaseInput();
    setRecording(false);
    setCapped(false);
  }, [releaseInput]);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    /*
     * Never open a second microphone on top of the first.
     *
     * `stream.current` is assigned unconditionally, so a second start would
     * overwrite the first stream without stopping it — a device left open with
     * nothing holding a reference to close it.
     */
    if (recordingRef.current || stream.current) return;

    setError(undefined);
    pcmChunks.current = [];
    const mine = (attempt.current += 1);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        /*
         * Auto-gain off, deliberately.
         *
         * AGC rides the level while recording: it pulls down after a loud
         * passage and creeps back through the next quiet one, so a single note
         * changes volume partway through and nothing downstream can undo it.
         * `normalisePeak` at encode time gives the consistent loudness AGC was
         * there for, with one constant gain across the whole take, so the loud
         * parts stay loud relative to the quiet ones.
         *
         * Echo cancellation and noise suppression stay on — neither of them
         * moves the level around the way AGC does.
         */
        audio: speechAudioConstraints({ hd: true, autoGainControl: false }),
      });
      if (mine !== attempt.current) {
        // Cancelled while the permission prompt was up. Give the microphone
        // straight back rather than holding a device nobody is recording with.
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;

      const context = new AudioContext();
      // Some engines ignore the constructor rate; trust context.sampleRate.
      if (context.state === 'suspended') {
        await context.resume().catch(() => undefined);
      }
      if (mine !== attempt.current) {
        media.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => undefined);
        return;
      }
      audioContext.current = context;
      sampleRate.current = context.sampleRate || 48_000;

      const source = context.createMediaStreamSource(media);

      /*
       * Capture on the audio thread when the browser has one.
       *
       * `ScriptProcessor` runs on the main thread, so anything else the app is
       * doing — a render, an IndexedDB write, a backup — delays the callback,
       * and a buffer that arrives late is silently dropped. That is heard as a
       * gap or a smear in the note, and it happens exactly when the phone is
       * busiest. An `AudioWorklet` runs on the audio rendering thread and is not
       * affected by any of it.
       *
       * The old path is kept as a fallback rather than removed: it works
       * everywhere, and a browser without worklets should still be able to send
       * a voice note.
       */
      let usedWorklet = false;
      if (typeof AudioWorkletNode !== 'undefined' && context.audioWorklet) {
        try {
          const url = URL.createObjectURL(
            new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' }),
          );
          try {
            await context.audioWorklet.addModule(url);
          } finally {
            URL.revokeObjectURL(url);
          }

          if (mine !== attempt.current) return;

          const worklet = new AudioWorkletNode(context, 'pingo-pcm', {
            numberOfInputs: 1,
            numberOfOutputs: 0,
            channelCount: 1,
          });
          workletNode.current = worklet;

          let lastMeter = 0;
          worklet.port.onmessage = (event: MessageEvent<{ pcm: Float32Array; peak: number }>) => {
            if (!recordingRef.current) return;
            if (event.data.pcm.length > 0) pcmChunks.current.push(event.data.pcm);

            const now = Date.now();
            if (now - lastMeter < METER_INTERVAL_MS) return;
            lastMeter = now;
            setLevel(event.data.peak);
          };

          source.connect(worklet);
          usedWorklet = true;
        } catch {
          // Fall through to ScriptProcessor below.
          workletNode.current = undefined;
        }
      }

      if (!usedWorklet) {
        const node = context.createScriptProcessor(4096, 1, 1);
        processor.current = node;

        /*
         * The fallback, and the reason the meter is throttled here.
         *
         * This callback runs on the main thread, so whatever it does is time
         * the browser is not spending on the next buffer. The meter used to
         * call `setLevel` on every one — a React render twelve times a second,
         * inside the audio path. The PCM copy stays first and unconditional,
         * because dropping a buffer to draw a bar is the wrong way round.
         */
        let lastMeter = 0;
        node.onaudioprocess = (event) => {
          if (!recordingRef.current) return;
          const input = event.inputBuffer.getChannelData(0);
          pcmChunks.current.push(new Float32Array(input));

          const now = Date.now();
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
      }

      startedAt.current = Date.now();
      recordingRef.current = true;
      setRecording(true);
      setCapped(false);
      setElapsed(0);

      timer.current = setInterval(() => {
        const seconds = (Date.now() - startedAt.current) / 1000;

        if (seconds >= MAX_SECONDS) {
          /*
           * The ceiling, and it has to actually stop things.
           *
           * This used to set `recordingRef` false and leave everything else
           * running: the microphone stayed open — with the browser's recording
           * indicator lit — the timer kept climbing past five minutes, the bar
           * still said "Recording", and none of it was being captured. The take
           * is kept: capture and the microphone stop, the clock freezes at the
           * ceiling, and send still works on what was recorded.
           */
          setElapsed(MAX_SECONDS);
          setCapped(true);
          recordingRef.current = false;

          if (timer.current) clearInterval(timer.current);
          if (meter.current) clearInterval(meter.current);
          timer.current = undefined;
          meter.current = undefined;
          setLevel(0);

          releaseInput();
          return;
        }

        setElapsed(seconds);
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

    /*
     * Ask the worklet for the part-filled block before anything is torn down.
     *
     * Without this the last block never arrives — a note always lost up to
     * 85ms off its end, which is exactly where the last word is. Raced against
     * a short timeout because a recording must not be lost if the audio thread
     * is wedged: a note missing its final syllable beats no note at all.
     */
    const node = workletNode.current;
    if (node) {
      await new Promise<void>((resolve) => {
        const settle = setTimeout(resolve, 80);
        /*
         * Waits for the flush, not for the next message.
         *
         * A full 4096-frame block can already be in flight when the request
         * goes out - at 48 kHz one lands every 85 ms, so on a note of any
         * length it usually is. Resolving on whichever message arrived first
         * meant `stop()` carried on, reset `pcmChunks`, and the real tail
         * pushed into the new array and was thrown away with it.
         *
         * The worklet marks its reply, so the marker is what to wait for. Any
         * ordinary block arriving in the meantime is still kept - it is audio
         * that was recorded, and dropping it would trade one lost tail for a
         * lost middle.
         */
        node.port.onmessage = (
          event: MessageEvent<{ pcm: Float32Array; flush?: boolean }>,
        ) => {
          if (event.data.pcm.length > 0) pcmChunks.current.push(event.data.pcm);
          if (!event.data.flush) return;
          clearTimeout(settle);
          resolve();
        };
        try {
          node.port.postMessage({ flush: true });
        } catch {
          clearTimeout(settle);
          resolve();
        }
      });
    }

    // Stop accepting more PCM first so the last callback cannot race.
    recordingRef.current = false;
    const rate = sampleRate.current;
    const chunks = pcmChunks.current;
    pcmChunks.current = [];

    teardown();

    if (chunks.length === 0) return undefined;

    const samples = concatFloat32(chunks);

    /*
     * The length of the audio, not the length of the interaction.
     *
     * This was the wall clock — `Date.now()` at stop minus at start — and the
     * two disagree whenever anything went wrong: a buffer dropped on the
     * ScriptProcessor path, a tab backgrounded mid-take, or the five-minute
     * ceiling reached with the timer still running. The number goes straight
     * into the attachment, so the receiver's player would show a length the
     * file does not have and run its progress bar against it.
     */
    const seconds = samples.length / rate;
    if (seconds < MIN_SECONDS) return undefined;

    // Reject pure silence (broken mic path) so we never send a "working" empty note.
    let peak = 0;
    for (let i = 0; i < samples.length; i += 16) {
      peak = Math.max(peak, Math.abs(samples[i]!));
    }
    if (peak < 0.0008) {
      setError('No sound detected. Check the microphone and try again.');
      return undefined;
    }

    let blob = encodePcmToWavBlob(normalisePeak(samples), rate, VOICE_WAV_RATE);
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
    capped,
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
