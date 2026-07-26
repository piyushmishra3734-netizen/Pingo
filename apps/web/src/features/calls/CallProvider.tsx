import { useAuth, type Call, type CallKind, type CallService } from '@pingo/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { usePreferences } from '../settings/SettingsContext.js';
import { startRinging, type Ringer } from './audio/ringtone.js';

/**
 * Call state, and the one audio element the whole app shares.
 *
 * ## Why the `<audio>` lives here
 *
 * Remote audio has to be attached to a media element to play, and that element
 * must outlive whatever screen started the call — otherwise navigating away
 * mid-call cuts the audio. One element at the root, never unmounted, is the
 * simplest thing that cannot break that way.
 *
 * It is hidden, not absent: an element with no controls still plays.
 */

interface CallContextValue {
  call: Call | undefined;
  startCall: (peerUserId: string, peerName: string, kind?: CallKind) => Promise<void>;
  answer: () => Promise<void>;
  decline: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
  /**
   * Video only, and both are video-only on purpose.
   *
   * Remote *audio* never comes through here — it stays on the root `<audio>`
   * element below, which outlives every screen. Attaching the same stream to a
   * second unmuted element would play the peer twice.
   */
  localStream: MediaStream | undefined;
  remoteStream: MediaStream | undefined;
  /** Non-fatal problem worth showing, e.g. a refused microphone. */
  error: string | undefined;
  dismissError: () => void;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

export function CallProvider({
  children,
  service,
}: {
  children: ReactNode;
  service: CallService;
}) {
  const { signedIn } = useAuth();
  const { preferences } = usePreferences();

  const [call, setCall] = useState<Call | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [localStream, setLocalStream] = useState<MediaStream | undefined>();
  const [remoteStream, setRemoteStream] = useState<MediaStream | undefined>();
  const audioRef = useRef<HTMLAudioElement>(null);

  // The Calls settings screen drives the media, so its toggles are not decorative.
  const { noiseCancellation: noiseSuppression, hdVideo, cameraOnByDefault } = preferences.calls;

  useEffect(() => {
    /*
     * Signing out closes the channel; nothing else does.
     *
     * In particular the cleanup below only drops the listener — it must not
     * disconnect. StrictMode runs mount → cleanup → mount in development, and a
     * disconnect in that cleanup tears down the channel the second mount is in
     * the middle of opening, leaving a signed-in user with no way to be called.
     */
    if (!signedIn) {
      service.disconnect();
      return;
    }

    void service.connect().catch(() => {
      setError('Could not connect to the call service.');
    });

    const unsubscribe = service.subscribe((event) => {
      switch (event.type) {
        case 'call:incoming':
        case 'call:updated':
          setCall(event.call);
          break;

        case 'call:ended':
          setCall(undefined);
          setLocalStream(undefined);
          setRemoteStream(undefined);
          if (audioRef.current) audioRef.current.srcObject = null;
          break;

        case 'call:remote-stream':
          setRemoteStream(event.stream);
          if (audioRef.current) {
            audioRef.current.srcObject = event.stream;
            // Autoplay can be refused until the user has interacted; answering
            // a call is an interaction, so this normally succeeds.
            void audioRef.current.play().catch(() => {
              setError('Tap anywhere to enable audio.');
            });
          }
          break;

        case 'call:local-stream':
          setLocalStream(event.stream);
          break;
      }
    });

    return unsubscribe;
  }, [service, signedIn]);

  const startCall = useCallback(
    async (peerUserId: string, peerName: string, kind: CallKind = 'voice') => {
      setError(undefined);
      try {
        const started = await service.call(peerUserId, {
          kind,
          noiseSuppression,
          hdVideo,
          // Only meaningful on a video call, and only as a starting position —
          // the user can turn the camera on the moment they are connected.
          cameraOff: kind === 'video' && !cameraOnByDefault,
        });
        setCall({ ...started, peer: { ...started.peer, name: peerName } });
      } catch (cause) {
        // The service has already torn the call down, so the overlay closes and
        // this message needs somewhere else to live.
        setError(mediaMessage(cause));
      }
    },
    [service, noiseSuppression, hdVideo, cameraOnByDefault],
  );

  const answer = useCallback(async () => {
    if (!call) return;
    setError(undefined);
    try {
      // No `kind` here: the offer decides whether this is a video call.
      await service.answer(call.id, { noiseSuppression, hdVideo });
    } catch (cause) {
      setError(mediaMessage(cause));
    }
  }, [service, call, noiseSuppression, hdVideo]);

  const decline = useCallback(async () => {
    if (call) await service.decline(call.id);
  }, [service, call]);

  const hangUp = useCallback(async () => {
    if (call) await service.hangUp(call.id);
  }, [service, call]);

  const toggleMute = useCallback(() => {
    if (call) service.setMuted(call.id, !call.muted);
  }, [service, call]);

  const toggleCamera = useCallback(() => {
    if (call) service.setCameraOff(call.id, !call.cameraOff);
  }, [service, call]);

  const switchCamera = useCallback(async () => {
    if (call) await service.switchCamera(call.id);
  }, [service, call]);

  /*
   * Re-renders when the *contents* of a stream change, not just its identity.
   *
   * `ontrack` fires once per track and hands over the same `MediaStream` object
   * every time, so `setRemoteStream` after the second track is a no-op — React
   * compares by identity and bails out. On a video call the audio track arrives
   * first, which meant the picture never appeared even though the track was
   * right there. Listening to the stream itself is what makes the UI notice.
   */
  const [streamVersion, setStreamVersion] = useState(0);

  useEffect(() => {
    if (!remoteStream) return;
    const bump = () => setStreamVersion((n) => n + 1);
    remoteStream.addEventListener('addtrack', bump);
    remoteStream.addEventListener('removetrack', bump);
    return () => {
      remoteStream.removeEventListener('addtrack', bump);
      remoteStream.removeEventListener('removetrack', bump);
    };
  }, [remoteStream]);

  /*
   * Ringing, driven by call state rather than by the actions around it.
   *
   * Starting the tone inside `startCall` and stopping it inside `answer` and
   * `hangUp` would mean every future way a call can end — declined, busy,
   * unanswered, network failure — is a new place that has to remember to stop
   * the sound. Derived from state, there is exactly one rule: it rings while
   * the call is waiting to connect, and never otherwise.
   */
  const ringer = useRef<Ringer | undefined>(undefined);
  const ringing = call?.state === 'dialling' || call?.state === 'ringing';
  const ringKind = call?.direction === 'incoming' ? 'ringtone' : 'ringback';

  useEffect(() => {
    if (!ringing) return;
    ringer.current = startRinging(ringKind);
    return () => {
      ringer.current?.stop();
      ringer.current = undefined;
    };
  }, [ringing, ringKind]);

  const dismissError = useCallback(() => setError(undefined), []);

  const value = useMemo<CallContextValue>(
    () => ({
      call,
      startCall,
      answer,
      decline,
      hangUp,
      toggleMute,
      toggleCamera,
      switchCamera,
      localStream,
      remoteStream,
      error,
      dismissError,
    }),
    [
      call,
      startCall,
      answer,
      decline,
      hangUp,
      toggleMute,
      toggleCamera,
      switchCamera,
      localStream,
      remoteStream,
      // Not read above — it is here so a track appearing inside an unchanged
      // stream still produces a new context value. See the effect above.
      streamVersion,
      error,
      dismissError,
    ],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {/* One element, root-level, never unmounted. See the note above. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
    </CallContext.Provider>
  );
}

/**
 * Turns a `getUserMedia` rejection into something a user can act on.
 *
 * These are genuinely different problems with different fixes, and a single
 * "could not start the call" sends someone hunting through browser settings for
 * a permission they already granted. `NotFoundError` in particular means the
 * hardware is not there at all — nothing about PINGO will fix it.
 *
 * The wording says "microphone or camera" because one `getUserMedia` asks for
 * both and the rejection does not say which one was the problem. Naming only
 * the microphone would be a confident guess that is wrong half the time on a
 * video call.
 */
function mediaMessage(cause: unknown): string {
  if (!(cause instanceof DOMException)) return 'Could not start the call.';

  switch (cause.name) {
    case 'NotAllowedError':
      return 'PINGO needs microphone and camera access to make calls.';
    case 'NotFoundError':
      return 'No microphone or camera found. Connect one and try again.';
    case 'NotReadableError':
      return 'Your microphone or camera is in use by another app.';
    case 'OverconstrainedError':
      return "Your camera doesn't support the requested video quality.";
    default:
      return 'Could not start the call.';
  }
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside a <CallProvider>');
  return context;
}
