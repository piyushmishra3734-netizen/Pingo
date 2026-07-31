import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Recording a voice note.
 *
 * ## The microphone is released the moment recording stops
 *
 * Every track is stopped on finish, on cancel and on unmount. A `MediaStream`
 * left open keeps the browser's recording indicator lit and, on a phone, keeps
 * the microphone claimed against other apps - the kind of thing a user reads as
 * "this app is listening to me", and they would be right.
 *
 * ## Peaks are taken here, once
 *
 * The waveform is computed from the finished recording rather than at playback,
 * because drawing bars at playback means fetching and decoding every note in a
 * thread. Done here it happens once, on audio already in memory, on the device
 * that has a reason to be busy.
 */

/** Bars in a waveform. Enough to read a rhythm, few enough to stay legible. */
const WAVEFORM_BARS = 48;

/** Recording stops itself here. Past this it is a memo, not a message. */
const MAX_SECONDS = 300;

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

/** Below this a "recording" is a mis-tap, not a message. */
const MIN_SECONDS = 0.4;

export function useVoiceRecorder(): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string>();

  const stream = useRef<MediaStream | undefined>(undefined);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const meter = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  /** Releases everything. Safe to call twice; called on every exit path. */
  const teardown = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    if (meter.current) clearInterval(meter.current);
    timer.current = undefined;
    meter.current = undefined;

    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = undefined;

    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = undefined;

    recorder.current = undefined;
    setRecording(false);
    setLevel(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setError(undefined);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        // Voice, not music: the browser's own cleanup is better than anything
        // worth writing here, and it is free.
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );

      const mediaRecorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      mediaRecorder.start();
      recorder.current = mediaRecorder;
      startedAt.current = Date.now();

      setRecording(true);
      setElapsed(0);

      timer.current = setInterval(() => {
        const seconds = (Date.now() - startedAt.current) / 1000;
        setElapsed(seconds);
        // Stops itself rather than recording until the tab is closed.
        if (seconds >= MAX_SECONDS) mediaRecorder.stop();
      }, 100);

      /*
       * A live level, so the button can show the microphone is hearing
       * something. Without it a silent recording looks identical to a broken
       * one, and the user finds out only after sending.
       */
      const context = new AudioContext();
      audioContext.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(media).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      meter.current = setInterval(() => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        setLevel(peak);
      }, 80);
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
    const mediaRecorder = recorder.current;
    if (!mediaRecorder) return undefined;

    const seconds = (Date.now() - startedAt.current) / 1000;

    const blob = await new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () =>
        resolve(new Blob(chunks.current, { type: mediaRecorder.mimeType }));
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      else resolve(new Blob(chunks.current, { type: mediaRecorder.mimeType }));
    });

    teardown();

    if (seconds < MIN_SECONDS || blob.size === 0) return undefined;
    return { blob, seconds, waveform: await peaks(blob) };
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

/**
 * Reduces a recording to one amplitude per bar.
 *
 * Peak rather than average within each slice: averaging a waveform of speech
 * flattens it towards silence, because most samples in any window are close to
 * zero. Peaks are what make the bars look like the sound.
 */
async function peaks(blob: Blob): Promise<number[]> {
  try {
    const context = new AudioContext();
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = audio.getChannelData(0);
    void context.close();

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

    // Normalised against the loudest bar, so a quiet recording still reads as a
    // waveform rather than a flat line.
    return loudest > 0 ? bars.map((value) => value / loudest) : bars;
  } catch {
    /*
     * Decoding can fail on a codec the browser will happily record but not read
     * back. A flat waveform is a cosmetic loss; refusing to send the note over
     * it would not be.
     */
    return Array.from({ length: WAVEFORM_BARS }, () => 0.35);
  }
}
