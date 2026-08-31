import {
  useAuth,
  useChat,
  type Call,
  type CallChatMessage,
  type CallKind,
  type CallQuality,
  type CallService,
} from '@pingo/core';
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
import { announce, stopAnnouncing, FAILURE_TEXT, type CallFailure } from './audio/announce.js';
import { startRinging, type Ringer } from './audio/ringtone.js';
import { useCallLog } from './useCallLog.js';
import { useSpeaker } from './useSpeaker.js';

/**
 * Call state, and the one audio element the whole app shares.
 *
 * ## Why the `<audio>` lives here
 *
 * Remote audio has to be attached to a media element to play, and that element
 * must outlive whatever screen started the call - otherwise navigating away
 * mid-call cuts the audio. One element at the root, never unmounted, is the
 * simplest thing that cannot break that way.
 *
 * It is hidden, not absent: an element with no controls still plays.
 */

interface CallContextValue {
  call: Call | undefined;
  startCall: (
    peerUserId: string,
    peerName: string,
    kind?: CallKind,
    conversationId?: string,
  ) => Promise<void>;
  /** Rings every member of a group at once. Friendship is not required. */
  startGroupCall: (
    conversationId: string,
    title: string,
    participantIds: string[],
    kind?: CallKind,
  ) => Promise<void>;
  /**
   * Walks into a group call already running.
   *
   * For somebody with no ring to answer - they declined, they were away, or
   * they joined the group after it started - who tapped the call in the thread.
   */
  joinGroupCall: (
    callId: string,
    conversationId: string,
    title: string,
    memberIds: string[],
    kind?: CallKind,
  ) => Promise<void>;
  /**
   * Screens being shared, keyed by whoever is sharing.
   *
   * Kept apart from `remoteStreams` because a shared screen is the main content
   * and a face is a tile beside it - one map each is what lets the layout say
   * that without inspecting stream shapes.
   */
  screenStreams: Map<string, MediaStream>;
  /**
   * Starts or stops this device's share.
   *
   * Undefined when the call cannot carry one - a peer-to-peer fallback has no
   * second video track to spare - so the control is hidden rather than offered
   * and then refused.
   */
  toggleScreenShare: (() => Promise<void>) | undefined;
  /** Why the last attempt did not start. Cleared when another is made. */
  screenError: string | undefined;
  /** Everything said in this call, oldest first. Never persisted. */
  chat: CallChatMessage[];
  /**
   * Says something to the call.
   *
   * Undefined when the service cannot carry it, for the same reason as
   * `toggleScreenShare` - a control that is always going to fail is worse than
   * a control that is not there.
   */
  sendChat: ((body: string) => Promise<void>) | undefined;
  answer: () => Promise<void>;
  decline: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
  /**
   * Video only, and both are video-only on purpose.
   *
   * Remote *audio* never comes through here - it stays on the root `<audio>`
   * element below, which outlives every screen. Attaching the same stream to a
   * second unmuted element would play the peer twice.
   */
  localStream: MediaStream | undefined;
  /**
   * Everyone else's media, keyed by their id.
   *
   * A map rather than one stream, because a group call is a mesh and each
   * person arrives on their own connection. A direct call has one entry, which
   * is why this replaced the singular field rather than sitting beside it.
   */
  remoteStreams: Map<string, MediaStream>;
  /**
   * The line is bad enough to say so.
   *
   * Measured from `getStats`, not guessed from the connection state - a peer
   * connection stays `connected` right through the loss that makes a call
   * unusable, which is why nothing was ever able to report this before.
   */
  weakConnection: boolean;
  /** Non-fatal problem worth showing, e.g. a refused microphone. */
  error: string | undefined;
  dismissError: () => void;
  /**
   * Speaker mode: the other person, amplified.
   *
   * On means the other person is amplified - see `useSpeaker`. Absent only
   * where Web Audio will not start, in which case the call still plays at
   * normal volume and no dead toggle is offered.
   */
  speaker: { on: boolean; toggle: () => void } | undefined;
  /**
   * The line being spoken after a call that did not connect.
   *
   * Present only while the announcement is playing. Shown as text at the same
   * time, so the information never depends on the audio arriving - a muted
   * device or a browser with no voices still tells the user what happened.
   */
  failureNotice: string | undefined;
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
  // The chat service, for the one thing a call needs from it: which thread a
  // call belongs to. See `startCall`.
  const { service: chat } = useChat();
  const { preferences } = usePreferences();

  const [call, setCall] = useState<Call | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [localStream, setLocalStream] = useState<MediaStream | undefined>();
  /** One per person on the call. A direct call has exactly one entry. */
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  /** One per person sharing. Usually zero or one; a room may have more. */
  const [screenStreams, setScreenStreams] = useState<Map<string, MediaStream>>(new Map());
  const [screenError, setScreenError] = useState<string | undefined>();
  /**
   * In-call chat, oldest first. Emptied when the call ends - it is not history.
   *
   * Named `callChat` locally because `chat` in this file is already the chat
   * *service*, and the two are unrelated: one is a conversation store, the
   * other is a handful of lines that will not outlive the call.
   */
  const [callChat, setCallChat] = useState<CallChatMessage[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);

  // The Calls settings screen drives the media, so its toggles are not decorative.
  const {
    noiseCancellation: noiseSuppression,
    echoCancellation,
    hdAudio,
    hdVideo,
    cameraOnByDefault,
  } = preferences.calls;

  useEffect(() => {
    /*
     * Signing out closes the channel; nothing else does.
     *
     * In particular the cleanup below only drops the listener - it must not
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
          setRemoteStreams(new Map());
          setScreenStreams(new Map());
          // A meeting chat belongs to the meeting. Carrying it into the next
          // call would show lines from a conversation that already ended.
          setCallChat([]);
          if (audioRef.current) audioRef.current.srcObject = null;
          break;

        case 'call:remote-stream':
          /*
           * Keyed by person, because a mesh has one of these each.
           *
           * This used to be a single `remoteStream`, which meant the second
           * person to connect silently replaced the first: their tile went
           * blank and their voice stopped, with nothing anywhere saying why.
           */
          setRemoteStreams((previous) => {
            if (previous.get(event.userId) === event.stream) return previous;
            const next = new Map(previous);
            next.set(event.userId, event.stream);
            return next;
          });
          break;

        case 'call:remote-stream-ended':
          setRemoteStreams((previous) => {
            if (!previous.has(event.userId)) return previous;
            const next = new Map(previous);
            next.delete(event.userId);
            return next;
          });
          break;

        case 'call:screen-stream':
          setScreenStreams((previous) => {
            if (previous.get(event.userId) === event.stream) return previous;
            const next = new Map(previous);
            next.set(event.userId, event.stream);
            return next;
          });
          break;

        case 'call:screen-ended':
          setScreenStreams((previous) => {
            if (!previous.has(event.userId)) return previous;
            const next = new Map(previous);
            next.delete(event.userId);
            return next;
          });
          break;

        case 'call:local-stream':
          setLocalStream(event.stream);
          break;

        case 'call:chat':
          /*
           * Deduplicated by id, because a resend is a real possibility and a
           * line appearing twice reads as the person having said it twice.
           */
          setCallChat((previous) =>
            previous.some((line) => line.id === event.message.id)
              ? previous
              : [...previous, event.message],
          );
          break;
      }
    });

    return unsubscribe;
  }, [service, signedIn]);

  const startCall = useCallback(
    async (
      peerUserId: string,
      peerName: string,
      kind: CallKind = 'voice',
      conversationId?: string,
    ) => {
      setError(undefined);
      try {
        /*
         * The thread this call belongs to, found or made before it rings.
         *
         * A room token is authorised against conversation membership, so a call
         * with no conversation had nothing for the server to check and fell
         * back to peer-to-peer. That covered every call placed from a profile
         * page or the call history - which is most of them.
         *
         * `startDirectConversation` is find-or-create and idempotent, so this
         * is not a side effect so much as arriving at the same row the first
         * message would have made. The call log wants it too: `useCallLog` has
         * always needed a thread to write into and gave up silently without
         * one, which is why calls placed from a profile never appeared in
         * anybody's history.
         *
         * A failure here is not fatal. The call proceeds without a room and the
         * mesh carries it, exactly as it did before.
         */
        let thread = conversationId;
        if (!thread) {
          thread = await chat
            .startDirectConversation(peerUserId)
            .catch(() => undefined);
        }

        const started = await service.call(peerUserId, {
          kind,
          noiseSuppression,
          echoCancellation,
          hdAudio,
          hdVideo,
          // Only meaningful on a video call, and only as a starting position  - 
          // the user can turn the camera on the moment they are connected.
          cameraOff: kind === 'video' && !cameraOnByDefault,
          /*
           * What authorises the room token, when the screen knows it.
           *
           * Absent from a call placed off a profile page, where there may be no
           * conversation yet - such a call falls back to peer-to-peer rather
           * than being refused. See `CallServiceOptions.conversationId`.
           */
          ...(thread ? { conversationId: thread } : {}),
        });
        setCall({ ...started, peer: { ...started.peer, name: peerName } });
      } catch (cause) {
        // The service has already torn the call down, so the overlay closes and
        // this message needs somewhere else to live.
        setError(mediaMessage(cause));
      }
    },
    [service, noiseSuppression, echoCancellation, hdAudio, hdVideo, cameraOnByDefault],
  );

  /**
   * Rings a whole group.
   *
   * The title is passed in for the same reason a person's name is: the service
   * deals in ids, and `peer` on a group call names the conversation. Without
   * it the overlay would say "Group call" over a room that has a name.
   */
  const startGroupCall = useCallback(
    async (
      conversationId: string,
      title: string,
      participantIds: string[],
      kind: CallKind = 'voice',
    ) => {
      setError(undefined);
      try {
        const started = await service.callGroup(conversationId, participantIds, {
          kind,
          noiseSuppression,
          echoCancellation,
          hdAudio,
          hdVideo,
          cameraOff: kind === 'video' && !cameraOnByDefault,
        });
        setCall({ ...started, peer: { ...started.peer, name: title } });
      } catch (cause) {
        setError(mediaMessage(cause));
      }
    },
    [service, noiseSuppression, echoCancellation, hdAudio, hdVideo, cameraOnByDefault],
  );

  /**
   * Joins a group call that is already running.
   *
   * Kept beside `startGroupCall` because from the caller's side they are the
   * same decision - be in this room - and only the service knows that one of
   * them has to discover who is already there.
   */
  const joinGroupCall = useCallback(
    async (
      callId: string,
      conversationId: string,
      title: string,
      memberIds: string[],
      kind: CallKind = 'voice',
    ) => {
      setError(undefined);
      try {
        await service.joinGroupCall?.(callId, conversationId, title, memberIds, kind, {
          noiseSuppression,
          echoCancellation,
          hdAudio,
          hdVideo,
          cameraOff: kind === 'video' && !cameraOnByDefault,
        });
      } catch (cause) {
        setError(mediaMessage(cause));
      }
    },
    [service, noiseSuppression, echoCancellation, hdAudio, hdVideo, cameraOnByDefault],
  );

  const answer = useCallback(async () => {
    if (!call) return;
    setError(undefined);
    try {
      // No `kind` here: the offer decides whether this is a video call.
      await service.answer(call.id, {
        noiseSuppression,
        echoCancellation,
        hdAudio,
        hdVideo,
      });
    } catch (cause) {
      setError(mediaMessage(cause));
    }
  }, [service, call, noiseSuppression, echoCancellation, hdAudio, hdVideo]);

  const decline = useCallback(async () => {
    if (call) await service.decline(call.id);
  }, [service, call]);

  /**
   * Starts or stops this device's share.
   *
   * Undefined while there is no call, and while the call is on the
   * peer-to-peer fallback, which has no room to publish a second video into.
   * Hiding it beats offering a button that always fails.
   *
   * Refusing the browser's picker lands here as an error like any other, and it
   * must not end the call - somebody who changes their mind about sharing is
   * still on the call. The message is shown with a retry and nothing else
   * happens.
   */
  const toggleScreenShare = useMemo(() => {
    if (!call || !service.setScreenShare) return undefined;
    return async () => {
      setScreenError(undefined);
      try {
        await service.setScreenShare!(call.id, !call.screenSharing);
      } catch {
        setScreenError("Screen sharing couldn't start.");
      }
    };
  }, [service, call]);

  const sendChat = useMemo(() => {
    if (!call || !service.sendCallChat) return undefined;
    return (body: string) => service.sendCallChat!(call.id, body);
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
   * every time, so `setRemoteStream` after the second track is a no-op - React
   * compares by identity and bails out. On a video call the audio track arrives
   * first, which meant the picture never appeared even though the track was
   * right there. Listening to the stream itself is what makes the UI notice.
   */
  const [streamVersion, setStreamVersion] = useState(0);

  // Every stream, not just the first: in a mesh each person's picture arrives
  // after their audio, and only the one being watched would ever appear.
  useEffect(() => {
    const bump = () => setStreamVersion((n) => n + 1);
    const watched = [...remoteStreams.values()];

    for (const stream of watched) {
      stream.addEventListener('addtrack', bump);
      stream.addEventListener('removetrack', bump);
    }
    return () => {
      for (const stream of watched) {
        stream.removeEventListener('addtrack', bump);
        stream.removeEventListener('removetrack', bump);
      }
    };
  }, [remoteStreams]);

  /**
   * The one stream the root `<audio>` element plays.
   *
   * A direct call has exactly one, and it is this. A group call plays the rest
   * through their own elements below - one element cannot play four people, and
   * mixing them here would mean building an audio graph to solve a problem the
   * DOM already solves.
   */
  const primaryRemote = [...remoteStreams.values()][0];

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;

    element.srcObject = primaryRemote ?? null;
    if (!primaryRemote) return;

    // Autoplay can be refused until the user has interacted; answering a call
    // is an interaction, so this normally succeeds.
    void element.play().catch(() => setError('Tap anywhere to enable audio.'));
  }, [primaryRemote]);

  /*
   * Ringing, driven by call state rather than by the actions around it.
   *
   * Starting the tone inside `startCall` and stopping it inside `answer` and
   * `hangUp` would mean every future way a call can end - declined, busy,
   * unanswered, network failure - is a new place that has to remember to stop
   * the sound. Derived from state, there is exactly one rule: it rings while
   * the call is waiting to connect, and never otherwise.
   */
  // Every finished call is written into its conversation. See `useCallLog`.
  useCallLog(call);

  /*
   * Boosts the remote voice rather than switching device. See `useSpeaker`.
   *
   * One-to-one only, and deliberately absent in a group: it amplifies one
   * element, and a room has one per person. A toggle that made one of four
   * people louder would be worse than no toggle - the contract already allows
   * this to be undefined, and the UI hides it rather than offering a lie.
   */
  const speaker = useSpeaker(
    audioRef,
    remoteStreams.size <= 1 ? primaryRemote : undefined,
    Boolean(call),
  );

  /**
   * The failure tone and spoken line, after a call that never connected.
   *
   * Held separately from `call`, because it outlives it: the point is to keep
   * saying something for a moment after the overlay would otherwise vanish, the
   * way a real call does.
   */
  const [failure, setFailure] = useState<CallFailure | undefined>();
  const previousCall = useRef<Call | undefined>(undefined);

  useEffect(() => {
    const ended = previousCall.current;
    previousCall.current = call;

    // Only an outgoing call that never connected has anything to announce.
    if (call || !ended || ended.direction !== 'outgoing') return;
    if (ended.connectedAt !== undefined) return;
    if (ended.endReason === 'cancelled' || ended.endReason === 'hung-up') return;

    setFailure(ended.endReason === 'unanswered' ? 'no-answer' : 'unreachable');
  }, [call]);

  useEffect(() => {
    if (!failure) return;

    // Busy tone first, then the sentence over the top of it - the order every
    // network uses, and the reason the tone alone is enough for most people.
    const tone = startRinging('busy');
    void announce(failure).finally(() => setFailure(undefined));

    return () => {
      tone.stop();
      stopAnnouncing();
    };
  }, [failure]);

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

  /*
   * The beep, while the call is still open and nothing is getting through.
   *
   * A dropped connection is the one call state with no visual: the picture
   * freezes, the voice stops, and every phone in the world plays a tone at that
   * moment because the person is looking at their own ear, not at a screen.
   * Without it the two most different outcomes - "they went quiet" and "the
   * network died" - are the same silence, and people keep talking into it.
   *
   * Its own ringer, not the dialling one. They can never overlap, because
   * reconnecting is a state a call only reaches after it connected, but keeping
   * them separate means the handle that stops one cannot be the one holding the
   * other - which is how a ring gets left playing under a live call.
   */
  const reconnecting = call?.state === 'reconnecting';
  const dropTone = useRef<Ringer | undefined>(undefined);

  useEffect(() => {
    if (!reconnecting) return;
    dropTone.current = startRinging('weak');
    return () => {
      dropTone.current?.stop();
      dropTone.current = undefined;
    };
  }, [reconnecting]);

  const dismissError = useCallback(() => setError(undefined), []);

  /**
   * Poll the connection while a call is up, so "it sounds bad" is a number.
   *
   * Two seconds is the interval a person's patience is already tuned to - it is
   * the same one the connection banner uses - and `getStats` at that rate costs
   * nothing next to encoding the call. Sampling only while connected keeps the
   * reader's baseline meaningful: a call that has not connected has no packets
   * to have lost.
   */
  const connected = call?.state === 'connected';
  const [quality, setQuality] = useState<CallQuality | undefined>();

  useEffect(() => {
    if (!connected || !service.quality) {
      setQuality(undefined);
      return;
    }

    let live = true;
    const sample = () => {
      void service.quality?.().then((next) => {
        if (live) setQuality(next);
      });
    };

    const timer = window.setInterval(sample, 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [connected, service]);

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
      remoteStreams,
      screenStreams,
      toggleScreenShare,
      screenError,
      chat: callChat,
      sendChat,
      startGroupCall,
      joinGroupCall,
      error,
      dismissError,
      speaker,
      failureNotice: failure ? FAILURE_TEXT[failure] : undefined,
      weakConnection: quality?.weak === true,
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
      remoteStreams,
      /*
       * The rest of what the value actually reads.
       *
       * These were missing, and a missing dependency here is not a stale
       * closure - it is a context that does not update. A screen arriving
       * changed `screenStreams` and produced no new value, so the share
       * appeared for nobody until something else happened to re-render; and a
       * chat line would have landed in state that the panel never saw.
       */
      screenStreams,
      toggleScreenShare,
      screenError,
      callChat,
      sendChat,
      joinGroupCall,
      startGroupCall,
      // Not read above - it is here so a track appearing inside an unchanged
      // stream still produces a new context value. See the effect above.
      streamVersion,
      error,
      dismissError,
      speaker,
      failure,
      quality,
    ],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {/* One element, root-level, never unmounted. See the note above. */}
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {/*
        Everyone else on a group call, one element each.

        Outside the overlay on purpose - these outlive any screen, exactly as
        the element above does. Mounted inside the call UI they would stop
        playing the moment the overlay unmounted for a re-render, which is a
        call that goes silent for no visible reason.
      */}
      {[...remoteStreams.entries()].slice(1).map(([userId, stream]) => (
        <PeerAudio key={userId} stream={stream} />
      ))}
    </CallContext.Provider>
  );
}

/**
 * Turns a `getUserMedia` rejection into something a user can act on.
 *
 * These are genuinely different problems with different fixes, and a single
 * "could not start the call" sends someone hunting through browser settings for
 * a permission they already granted. `NotFoundError` in particular means the
 * hardware is not there at all - nothing about PINGO will fix it.
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

/**
 * One person's audio on a group call.
 *
 * A component rather than a ref, because the number of them changes as people
 * join and leave, and React attaching `srcObject` through a `ref` callback is
 * the only version of this that stays correct when the list reorders.
 */
function PeerAudio({ stream }: { stream: MediaStream }) {
  return (
    <audio
      autoPlay
      playsInline
      className="hidden"
      ref={(element) => {
        if (!element) return;
        element.srcObject = stream;
        // Already an interaction by this point - they answered or placed it.
        void element.play().catch(() => undefined);
      }}
    />
  );
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside a <CallProvider>');
  return context;
}
