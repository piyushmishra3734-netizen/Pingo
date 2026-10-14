/**
 * The PINGO AI voice call engine: OpenAI Realtime, speech to speech, over
 * WebRTC from the browser. No UI here; the call screen drives it through
 * `startRealtimeCall` or the `useRealtimeCall` hook.
 *
 * ## The flow
 *
 * 1. The microphone (echo cancellation, noise suppression, auto gain).
 * 2. `ai-realtime` mints a short-lived client secret for this person and this
 *    thread. The session it opens already carries PINGO AI's character, their
 *    settings and a few saved memories; the real API key never reaches here.
 * 3. A peer connection to OpenAI: the mic goes up, PINGO AI's voice comes down
 *    into an <audio> element, and the `oai-events` data channel carries the
 *    events (transcripts, who is speaking).
 * 4. `end()` closes everything and posts the transcript into the thread
 *    (`ai-realtime` action `save`), so the chat continues from the call.
 *
 * Turn-taking is the server's: its voice activity detection decides when they
 * stopped, and talking over PINGO AI cuts it off. Nothing here has to.
 *
 * ## Background
 *
 * A call keeps running when the page is hidden (another tab, the screen
 * dimmed): WebRTC audio is not paused by the browser. Level updates slow down
 * while hidden (timers are throttled) and the audio context is resumed when
 * the page is visible again, in case the OS suspended it.
 */

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import { CallTranscript, type CallActivity, type CallTurn, type RealtimeServerEvent } from './realtime-events.js';

export type { CallActivity, CallTurn } from './realtime-events.js';

/** OpenAI's WebRTC endpoint for the SDP offer, used when the server does not name one. */
export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
/** The longest call when the server does not say. Realtime audio is billed per second of audio, both ways. */
export const MAX_CALL_SECONDS = 15 * 60;
/** How often `onLevel` is called: about 20 times a second. */
const LEVEL_MS = 50;
/** How long a dropped connection may try to come back before the call fails. */
const RECONNECT_GRACE_MS = 8000;

export type RealtimeCallState = 'connecting' | 'connected' | 'ended' | 'error';

export type RealtimeCallErrorCode =
  | 'mic_denied'
  | 'no_mic'
  | 'mic_lost'
  | 'unsupported'
  | 'not_configured'
  | 'network'
  | 'server';

export interface RealtimeCallError {
  code: RealtimeCallErrorCode;
  /** Said to the person as is. */
  message: string;
}

/** Why a call reached `ended`. */
export type RealtimeEndReason = 'hangup' | 'time_limit';

export interface RealtimeLevels {
  /** Their microphone, 0..1 (0 while muted). */
  me: number;
  /** PINGO AI's voice, 0..1. */
  ai: number;
}

export interface StartRealtimeCallOptions {
  conversationId: string;
  /** One of OpenAI's voices; the server falls back to `marin` for anything else. */
  voice?: string;
  onState?: (state: RealtimeCallState, detail?: { error?: RealtimeCallError; reason?: RealtimeEndReason }) => void;
  /** A turn's text changed or it finished. Same `id` until `final`. Only turns with text. */
  onTranscript?: (turn: CallTurn) => void;
  onLevel?: (levels: RealtimeLevels) => void;
  /** listening | thinking | talking, plus whether their voice is being heard. */
  onActivity?: (activity: CallActivity, userSpeaking: boolean) => void;
  /** Post the transcript into the thread on end. Default true. */
  saveTranscript?: boolean;
  /** Fired once the save is done (or failed). */
  onSaved?: (result: { saved: number; error?: string }) => void;
}

export interface RealtimeCallController {
  readonly state: RealtimeCallState;
  readonly activity: CallActivity;
  readonly muted: boolean;
  readonly error: RealtimeCallError | undefined;
  /** The transcript so far (turns with text), oldest first. */
  turns(): CallTurn[];
  setMuted(muted: boolean): void;
  /**
   * Loudspeaker vs earpiece. A no-op on the web: a browser cannot choose the
   * output route (`setSinkId` picks a device, not the earpiece). Kept so a
   * native shell can implement it behind the same call.
   */
  setSpeaker(on: boolean): void;
  /** Hang up. Resolves after the transcript is saved. Safe to call twice. */
  end(): Promise<void>;
}

type Grant = {
  clientSecret: string;
  expiresAt?: number;
  model?: string;
  voice?: string;
  maxSeconds?: number;
  callsUrl?: string;
};

class CallFailure extends Error {
  constructor(readonly info: RealtimeCallError) {
    super(info.message);
  }
}

const fail = (code: RealtimeCallErrorCode, message: string) => new CallFailure({ code, message });

export function startRealtimeCall(options: StartRealtimeCallOptions): RealtimeCallController {
  const transcript = new CallTranscript();
  const callId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;

  let state: RealtimeCallState = 'connecting';
  let error: RealtimeCallError | undefined;
  let muted = false;
  let stopped = false;
  let endPromise: Promise<void> | null = null;

  let mic: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let ctx: AudioContext | null = null;
  let micAnalyser: AnalyserNode | null = null;
  let aiAnalyser: AnalyserNode | null = null;
  let levelTimer: ReturnType<typeof setInterval> | null = null;
  let limitTimer: ReturnType<typeof setTimeout> | null = null;
  let dropTimer: ReturnType<typeof setTimeout> | null = null;
  let retryPlay: (() => void) | null = null;
  const smooth = { me: 0, ai: 0 };

  const setState = (next: RealtimeCallState, detail?: { error?: RealtimeCallError; reason?: RealtimeEndReason }) => {
    if (state === next) return;
    state = next;
    options.onState?.(next, detail);
  };

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    void ctx?.resume().catch(() => undefined);
    void audioEl?.play().catch(() => undefined);
  };

  const onMicEnded = () => {
    if (!stopped) void shutdown(fail('mic_lost', 'The microphone stopped. Check it and call again.'));
  };

  function handleEvent(raw: string) {
    let ev: RealtimeServerEvent;
    try {
      ev = JSON.parse(raw) as RealtimeServerEvent;
    } catch {
      return;
    }
    if (!ev || typeof ev.type !== 'string') return;
    const applied = transcript.apply(ev);
    for (const t of applied.changed) if (t.text.trim()) options.onTranscript?.({ ...t });
    if (applied.activity) options.onActivity?.(transcript.activity, transcript.userSpeaking);
    // The server's own complaints (a cancelled response, a bad event) do not end the call.
    if (applied.error) console.warn('[pingo-call] server:', applied.error);
  }

  function level(analyser: AnalyserNode | null, buf: Float32Array<ArrayBuffer> | null): number {
    if (!analyser || !buf) return 0;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
    const rms = Math.sqrt(sum / buf.length);
    // Speech sits around 0.02 to 0.2 RMS; map that onto most of 0..1.
    return Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-8) + 55) / 45));
  }

  function startLevels() {
    if (!options.onLevel || !ctx) return;
    const micBuf = micAnalyser ? new Float32Array(micAnalyser.fftSize) : null;
    const aiBuf = aiAnalyser ? new Float32Array(aiAnalyser.fftSize) : null;
    levelTimer = setInterval(() => {
      const me = muted ? 0 : level(micAnalyser, micBuf);
      const ai = level(aiAnalyser, aiBuf);
      // Quick to rise, slower to fall, so the character pulses rather than flickers.
      smooth.me = me > smooth.me ? me : smooth.me * 0.75 + me * 0.25;
      smooth.ai = ai > smooth.ai ? ai : smooth.ai * 0.75 + ai * 0.25;
      options.onLevel?.({ me: round(smooth.me), ai: round(smooth.ai) });
    }, LEVEL_MS);
  }

  function analyse(stream: MediaStream): AnalyserNode | null {
    if (!ctx) return null;
    try {
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.3;
      // Not connected onward: measured, never played through the context.
      ctx.createMediaStreamSource(stream).connect(node);
      return node;
    } catch {
      return null;
    }
  }

  async function connect() {
    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw fail('unsupported', 'Voice calls are not supported in this browser.');
    }

    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (cause) {
      const name = (cause as { name?: string })?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw fail('mic_denied', 'Microphone access is blocked. Allow it for PINGO and try again.');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw fail('no_mic', 'No microphone was found.');
      throw fail('no_mic', 'The microphone could not be opened. Is another app using it?');
    }
    if (stopped) return;
    const track = mic.getAudioTracks()[0];
    if (!track) throw fail('no_mic', 'No microphone was found.');
    track.addEventListener('ended', onMicEnded);

    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        ctx = new Ctor();
        void ctx.resume().catch(() => undefined);
        micAnalyser = analyse(mic);
      }
    } catch {
      ctx = null; // Levels are a nicety; the call works without them.
    }

    const grant = await fetchGrant(options.conversationId, options.voice);
    if (stopped) return;

    pc = new RTCPeerConnection();
    pc.addTrack(track, mic);

    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', '');
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    pc.ontrack = (e) => {
      const remote = e.streams[0] ?? new MediaStream([e.track]);
      if (!audioEl) return;
      audioEl.srcObject = remote;
      audioEl.play().catch(() => {
        // Autoplay refused: the next tap anywhere starts the voice.
        retryPlay = () => {
          void audioEl?.play().catch(() => undefined);
          if (retryPlay) document.removeEventListener('pointerdown', retryPlay);
          retryPlay = null;
        };
        document.addEventListener('pointerdown', retryPlay, { once: true });
      });
      if (ctx && !aiAnalyser) aiAnalyser = analyse(remote);
      if (!levelTimer) startLevels();
    };

    pc.onconnectionstatechange = () => {
      if (!pc || stopped) return;
      const s = pc.connectionState;
      if (s === 'failed') void shutdown(fail('network', 'The connection dropped. Check your internet and call again.'));
      else if (s === 'disconnected') {
        // Often a network switch that recovers on its own; give it a moment.
        if (!dropTimer) {
          dropTimer = setTimeout(() => {
            dropTimer = null;
            if (pc?.connectionState !== 'connected') void shutdown(fail('network', 'The connection dropped. Check your internet and call again.'));
          }, RECONNECT_GRACE_MS);
        }
      } else if (s === 'connected' && dropTimer) {
        clearTimeout(dropTimer);
        dropTimer = null;
      }
    };

    dc = pc.createDataChannel('oai-events');
    dc.onmessage = (e) => handleEvent(typeof e.data === 'string' ? e.data : '');
    dc.onopen = () => {
      if (stopped) return;
      setState('connected');
      options.onActivity?.(transcript.activity, transcript.userSpeaking);
      // PINGO AI speaks first, as told in its instructions: a call that opens in silence feels broken.
      send({ type: 'response.create' });
      const seconds = grant.maxSeconds && grant.maxSeconds > 0 ? grant.maxSeconds : MAX_CALL_SECONDS;
      limitTimer = setTimeout(() => void shutdown(undefined, 'time_limit'), seconds * 1000);
    };
    dc.onclose = () => {
      if (!stopped && state === 'connected') void shutdown(fail('server', 'The call was ended by the voice service.'));
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (stopped) return;

    let answer: Response;
    try {
      answer = await fetch(grant.callsUrl || REALTIME_CALLS_URL, {
        method: 'POST',
        body: offer.sdp ?? '',
        headers: { Authorization: `Bearer ${grant.clientSecret}`, 'Content-Type': 'application/sdp' },
      });
    } catch {
      throw fail('network', 'Could not reach the voice service. Check your internet and try again.');
    }
    if (!answer.ok) {
      console.warn('[pingo-call] SDP answer', answer.status);
      throw fail('server', 'The voice service did not pick up. Try again in a moment.');
    }
    const sdp = await answer.text();
    if (stopped) return;
    await pc.setRemoteDescription({ type: 'answer', sdp });
    document.addEventListener('visibilitychange', onVisible);
  }

  function send(event: Record<string, unknown>) {
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event));
  }

  function release() {
    if (levelTimer) clearInterval(levelTimer);
    if (limitTimer) clearTimeout(limitTimer);
    if (dropTimer) clearTimeout(dropTimer);
    levelTimer = limitTimer = dropTimer = null;
    document.removeEventListener('visibilitychange', onVisible);
    if (retryPlay) document.removeEventListener('pointerdown', retryPlay);
    retryPlay = null;
    try {
      dc?.close();
    } catch {
      /* already closed */
    }
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
    if (mic) {
      for (const t of mic.getTracks()) {
        t.removeEventListener('ended', onMicEnded);
        t.stop();
      }
    }
    if (audioEl) {
      audioEl.pause();
      audioEl.srcObject = null;
      audioEl.remove();
    }
    void ctx?.close().catch(() => undefined);
    dc = null;
    pc = null;
    mic = null;
    audioEl = null;
    ctx = null;
    micAnalyser = aiAnalyser = null;
    options.onLevel?.({ me: 0, ai: 0 });
  }

  async function shutdown(failure?: CallFailure, reason: RealtimeEndReason = 'hangup'): Promise<void> {
    if (endPromise) return endPromise;
    stopped = true;
    endPromise = (async () => {
      release();
      for (const t of transcript.finish()) if (t.text.trim()) options.onTranscript?.({ ...t });
      if (failure) {
        error = failure.info;
        setState('error', { error: failure.info });
      } else {
        setState('ended', { reason });
      }
      if (options.saveTranscript === false) return;
      const turns = transcript.visible().map((t) => ({ role: t.role, text: t.text }));
      // Sent even with nothing said: the save is also where the server gives back unused call time.
      const result = await saveTurns(options.conversationId, turns, callId);
      options.onSaved?.(result);
    })();
    return endPromise;
  }

  void connect().catch((cause) => {
    const failure = cause instanceof CallFailure ? cause : fail('server', 'Could not start the call. Try again in a moment.');
    if (!(cause instanceof CallFailure)) console.error('[pingo-call]', cause);
    void shutdown(failure);
  });

  return {
    get state() {
      return state;
    },
    get activity() {
      return transcript.activity;
    },
    get muted() {
      return muted;
    },
    get error() {
      return error;
    },
    turns: () => transcript.visible().map((t) => ({ ...t })),
    setMuted(next: boolean) {
      muted = next;
      for (const t of mic?.getAudioTracks() ?? []) t.enabled = !next;
    },
    setSpeaker() {
      /* No-op on the web; see the interface. */
    },
    end: () => shutdown(),
  };
}

async function fetchGrant(conversationId: string, voice?: string): Promise<Grant> {
  const { data, error } = await getSupabaseClient().functions.invoke('ai-realtime', {
    body: { conversationId, ...(voice ? { voice } : {}) },
  });
  if (error) {
    const status = (error as { context?: Response }).context?.status;
    if (status === 503) throw fail('not_configured', 'Voice calls with PINGO AI are not set up yet.');
    if (status === 402) throw fail('server', 'Your 2 free call minutes for today are used up. They come back at midnight.');
    if (status === 401) throw fail('server', 'Sign in again to call PINGO AI.');
    if (status === undefined) throw fail('network', 'Could not reach PINGO. Check your internet and try again.');
    throw fail('server', 'Could not start the call. Try again in a moment.');
  }
  const grant = data as Partial<Grant> | null;
  if (!grant?.clientSecret) throw fail('server', 'Could not start the call. Try again in a moment.');
  return grant as Grant;
}

async function saveTurns(
  conversationId: string,
  turns: { role: 'user' | 'assistant'; text: string }[],
  callId?: string,
): Promise<{ saved: number; error?: string }> {
  try {
    const { data, error } = await getSupabaseClient().functions.invoke('ai-realtime', {
      body: { conversationId, action: 'save', turns, ...(callId ? { callId } : {}) },
    });
    if (error) return { saved: 0, error: 'The call transcript could not be saved.' };
    const out = data as { saved?: number; error?: string } | null;
    return { saved: out?.saved ?? 0, ...(out?.error ? { error: out.error } : {}) };
  } catch {
    return { saved: 0, error: 'The call transcript could not be saved.' };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
