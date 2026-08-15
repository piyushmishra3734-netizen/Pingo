import {
  ConnectionQuality,
  ConnectionState,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from 'livekit-client';

import { getSupabaseClient } from '../supabase/client.js';

/**
 * The transport half of a call, on LiveKit.
 *
 * ## What this replaces, and what it deliberately does not
 *
 * PINGO's calls were a peer-to-peer mesh: one `RTCPeerConnection` per other
 * person, SDP and ICE hand-carried over Supabase broadcast channels, TURN
 * credentials minted per call. That is replaced here, and only that - the
 * offer, the answer, the candidate exchange, the relay.
 *
 * **Ringing is not replaced.** LiveKit has no notion of a phone ringing: a room
 * exists and participants join it. Somebody has to tell the other person there
 * is a call at all, and that is still a broadcast signal over the same channel
 * it always was. The two halves are now cleanly separated - signalling says
 * *come to this room*, this module is the room.
 *
 * ## Why the microphone is still ours
 *
 * LiveKit will happily capture the microphone itself, and doing it that way
 * would throw away the part of PINGO's calls that took the most care: 48 kHz
 * mono speech constraints, the browser's AEC/NS/AGC, and an optional RNNoise
 * pass on top of them. So capture stays where it was and the finished tracks
 * are *published* to the room. LiveKit carries what it is given.
 *
 * ## What is lost, honestly
 *
 * Media now passes through LiveKit's servers rather than only between the two
 * devices. The mesh's argument was that the middle is empty; an SFU is a middle.
 * What is gained is a group call that does not ask a phone to encode and upload
 * one copy per person, and a connection that survives networks the mesh could
 * not cross. That is the trade, and it is worth stating plainly rather than
 * discovering later.
 */

/** How a room reports itself back to the call service. */
export interface RoomHandlers {
  /** A remote participant's media, ready to attach. */
  onRemoteStream: (userId: string, stream: MediaStream) => void;
  /** They left, or their media went away. */
  onRemoteGone: (userId: string) => void;
  /**
   * Somebody started sharing their screen.
   *
   * Separate from `onRemoteStream` because it is a different thing on screen,
   * not a second camera: a shared screen becomes the main content and the faces
   * become small. Keeping them in one channel would mean the layout guessing
   * which stream was which from its aspect ratio.
   */
  onScreenStream?: (userId: string, stream: MediaStream) => void;
  onScreenGone?: (userId: string) => void;
  /** Somebody is in the room and connected. */
  onParticipantJoined: (userId: string) => void;
  /** The room is re-establishing itself after a network change. */
  onReconnecting: () => void;
  onReconnected: () => void;
  /** The room is gone and will not come back on its own. */
  onDisconnected: () => void;
  /** Coarse link quality for the local participant. */
  onQuality?: (weak: boolean) => void;
}

/** What the token endpoint hands back. Never contains the API secret. */
interface TokenGrant {
  url: string;
  token: string;
  room: string;
}

/**
 * Asks the Edge Function for a pass into this call's room.
 *
 * The function checks conversation membership with the caller's own JWT, so a
 * token cannot be obtained for a conversation the user is not in - see
 * `supabase/functions/livekit-token`.
 */
async function requestToken(callId: string, conversationId: string): Promise<TokenGrant> {
  const { data, error } = await getSupabaseClient().functions.invoke('livekit-token', {
    body: { callId, conversationId },
  });

  if (error) throw new Error('Could not get permission to join the call.');
  const grant = data as Partial<TokenGrant> | undefined;
  if (!grant?.url || !grant.token) throw new Error('Calling is not configured.');

  return { url: grant.url, token: grant.token, room: grant.room ?? `call_${callId}` };
}

export class CallRoom {
  #room: Room | undefined;
  #handlers: RoomHandlers;
  /** One stream per remote participant, built up as their tracks arrive. */
  #remote = new Map<string, MediaStream>();
  /** Shared screens, kept apart from faces - see `onScreenStream`. */
  #screens = new Map<string, MediaStream>();

  constructor(handlers: RoomHandlers) {
    this.#handlers = handlers;
  }

  get connected(): boolean {
    return this.#room?.state === ConnectionState.Connected;
  }

  /**
   * Joins the room for this call and publishes the given tracks.
   *
   * `local` is the stream the call service already opened and processed -
   * see the note above about why capture is not delegated.
   */
  async join(callId: string, conversationId: string, local: MediaStream): Promise<void> {
    const grant = await requestToken(callId, conversationId);

    const room = new Room({
      /*
       * Adaptive stream and dynacast are off.
       *
       * Both are bandwidth optimisations for rooms with an audience - pausing
       * tracks nobody is looking at, dropping layers nobody subscribes to. On a
       * call every participant is watching every other one, so they would cost
       * a decision per track to save nothing.
       */
      adaptiveStream: false,
      dynacast: false,
      // Matches the capture side: mono speech at 48 kHz. See `#openMedia`.
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.#room = room;
    this.#bind(room);

    await room.connect(grant.url, grant.token);

    /*
     * Published, not captured.
     *
     * `publishTrack` on the existing tracks keeps PINGO's own audio pipeline -
     * including the RNNoise pass, whose output is a different track object from
     * the microphone - rather than letting the SDK open its own.
     */
    for (const track of local.getTracks()) {
      await room.localParticipant.publishTrack(track, {
        // Speech, not music: mono at a bitrate that stays intelligible on a
        // train. Video defaults are the SDK's, which are tuned for calls.
        ...(track.kind === 'audio' ? { audioBitrate: 32_000, dtx: true, red: true } : {}),
      });
    }
  }

  /** Mutes or unmutes what is published, without dropping the track. */
  setMicrophoneEnabled(enabled: boolean): void {
    for (const publication of this.#room?.localParticipant.audioTrackPublications.values() ??
      []) {
      if (enabled) void publication.track?.unmute();
      else void publication.track?.mute();
    }
  }

  /** Same for the camera. A voice call has no video track and this is a no-op. */
  setCameraEnabled(enabled: boolean): void {
    for (const publication of this.#room?.localParticipant.videoTrackPublications.values() ??
      []) {
      if (enabled) void publication.track?.unmute();
      else void publication.track?.mute();
    }
  }

  /**
   * Swaps the published camera for another one.
   *
   * Republishing rather than renegotiating: the SDK handles the swap, and the
   * far end sees the same participant with a different picture.
   */
  async replaceVideo(track: MediaStreamTrack): Promise<void> {
    const room = this.#room;
    if (!room) return;

    for (const publication of room.localParticipant.videoTrackPublications.values()) {
      if (publication.track) await room.localParticipant.unpublishTrack(publication.track);
    }
    await room.localParticipant.publishTrack(track);
  }

  /**
   * Publishes this device's screen as its own track.
   *
   * ## Its own track, never the camera's
   *
   * `setScreenShareEnabled` publishes with source `ScreenShare` alongside
   * whatever else is up, so a camera that was on stays on and the far end gets
   * two pictures rather than one replaced. Replacing the camera track would
   * have been fewer lines and would mean turning the camera back on ends the
   * share.
   *
   * ## Audio is offered, not required
   *
   * `audio: true` asks the browser to *offer* system audio in its picker; every
   * platform that cannot do it simply does not show the option, and the share
   * proceeds without it. Nothing here fails for want of it.
   *
   * ## Ending it from the browser's own control
   *
   * Chrome puts a "Stop sharing" bar at the bottom of the screen, and people
   * use it. That ends the track without going through this class, so the caller
   * is told through `onEnded` - otherwise PINGO would go on showing a share
   * button in the "sharing" state over a track that had stopped.
   */
  async startScreenShare(onEnded: () => void): Promise<void> {
    const room = this.#room;
    if (!room) throw new Error('The call is not connected.');

    const published = await room.localParticipant.setScreenShareEnabled(true, {
      audio: true,
    });

    const track = published?.track?.mediaStreamTrack;
    if (track) track.addEventListener('ended', onEnded, { once: true });
  }

  async stopScreenShare(): Promise<void> {
    await this.#room?.localParticipant.setScreenShareEnabled(false);
  }

  /** What this device is publishing as a screen, for the sharer's own preview. */
  localScreen(): MediaStream | undefined {
    for (const publication of this.#room?.localParticipant.videoTrackPublications.values() ??
      []) {
      if (publication.source !== Track.Source.ScreenShare) continue;
      const track = publication.track?.mediaStreamTrack;
      if (track) return new MediaStream([track]);
    }
    return undefined;
  }

  async leave(): Promise<void> {
    const room = this.#room;
    this.#room = undefined;
    this.#remote.clear();
    this.#screens.clear();
    await room?.disconnect();
  }

  #bind(room: Room): void {
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication, participant) => {
      /*
       * A shared screen is its own channel, not a second camera.
       *
       * LiveKit labels the publication's source, so this is read rather than
       * guessed - a screen and a camera are both video tracks and telling them
       * apart by shape would be a coin flip on a portrait monitor.
       */
      if (publication.source === Track.Source.ScreenShare) {
        const screen = new MediaStream([track.mediaStreamTrack]);
        this.#screens.set(participant.identity, screen);
        this.#handlers.onScreenStream?.(participant.identity, screen);
        return;
      }

      /*
       * One stream per person, grown as their tracks arrive.
       *
       * Audio and video are subscribed separately and can land in either order,
       * so a new `MediaStream` per track would give the UI two half-people. The
       * identity is the PINGO user id, because that is what the token was
       * minted with.
       */
      const stream = this.#remote.get(participant.identity) ?? new MediaStream();
      stream.addTrack(track.mediaStreamTrack);
      this.#remote.set(participant.identity, stream);
      this.#handlers.onRemoteStream(participant.identity, stream);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication, participant) => {
      if (publication.source === Track.Source.ScreenShare) {
        this.#screens.delete(participant.identity);
        this.#handlers.onScreenGone?.(participant.identity);
        return;
      }

      const stream = this.#remote.get(participant.identity);
      stream?.removeTrack(track.mediaStreamTrack);
      if (stream && stream.getTracks().length === 0) {
        this.#remote.delete(participant.identity);
        this.#handlers.onRemoteGone(participant.identity);
      }
    });

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      this.#handlers.onParticipantJoined(participant.identity);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.#remote.delete(participant.identity);
      this.#handlers.onRemoteGone(participant.identity);
      if (this.#screens.delete(participant.identity)) {
        this.#handlers.onScreenGone?.(participant.identity);
      }
    });

    room.on(RoomEvent.Reconnecting, () => this.#handlers.onReconnecting());
    room.on(RoomEvent.Reconnected, () => this.#handlers.onReconnected());
    room.on(RoomEvent.Disconnected, () => this.#handlers.onDisconnected());

    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      // Only our own reading; a remote participant's poor link is their news to
      // show, not ours to blame the call for.
      if (participant?.identity !== room.localParticipant.identity) return;
      this.#handlers.onQuality?.(
        quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost,
      );
    });
  }

  /** Attached by the overlay for remote video. Kept for parity with the mesh. */
  static isVideo(publication: RemoteTrackPublication): boolean {
    return publication.kind === Track.Kind.Video;
  }
}
