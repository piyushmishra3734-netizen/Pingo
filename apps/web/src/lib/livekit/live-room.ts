/**
 * The LiveKit half of a live stream.
 *
 * One room, three seats: the host publishes, an approved guest publishes, and
 * the audience subscribes. The token decides the seat - see
 * `supabase/functions/live-token` - so joining as the wrong role fails at
 * `connect`, not halfway through the broadcast.
 *
 * Imported dynamically by the live screens so `livekit-client` stays off the
 * startup path - same reason the call room is.
 */

import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';

export interface LiveGrant {
  url: string;
  token: string;
}

export interface LiveHostRoom {
  setMicrophoneEnabled: (enabled: boolean) => void;
  setCameraEnabled: (enabled: boolean) => void;
  viewerCount: () => number;
  onViewersChanged: (handler: (count: number) => void) => void;
  leave: () => Promise<void>;
}

export interface LiveRoomEvents {
  /** A second publisher arrived (guest on the host's screen, host on guest's). */
  onCoStream: (userId: string, stream: MediaStream) => void;
  onCoGone: (userId: string) => void;
  onDisconnected: () => void;
}

async function publishLocal(room: Room, stream: MediaStream): Promise<void> {
  for (const track of stream.getTracks()) {
    await room.localParticipant.publishTrack(track, {
      ...(track.kind === 'audio'
        ? { audioBitrate: 48_000, dtx: false, red: true }
        : {
            source: Track.Source.Camera,
            videoEncoding: { maxBitrate: 1_700_000, maxFramerate: 30 },
          }),
    });
  }
}

/**
 * Binds remote publishers to per-person streams.
 *
 * One MediaStream per identity, grown as tracks arrive - audio and video land
 * separately and in either order, so a stream per track would show half a
 * person twice.
 */
function bindCoStreams(
  room: Room,
  events: LiveRoomEvents,
): { cleanup: () => void } {
  const streams = new Map<string, MediaStream>();

  const onSubscribed = (track: RemoteTrack, _publication: unknown, participant: { identity: string }) => {
    const stream = streams.get(participant.identity) ?? new MediaStream();
    stream.addTrack(track.mediaStreamTrack);
    streams.set(participant.identity, stream);
    events.onCoStream(participant.identity, stream);
  };
  const onUnsubscribed = (track: RemoteTrack) => {
    for (const [identity, stream] of streams) {
      stream.removeTrack(track.mediaStreamTrack);
      if (stream.getTracks().length === 0) {
        streams.delete(identity);
        events.onCoGone(identity);
      }
    }
  };
  const onLeft = (participant: { identity: string }) => {
    if (streams.delete(participant.identity)) events.onCoGone(participant.identity);
  };
  const onGone = () => events.onDisconnected();

  room.on(RoomEvent.TrackSubscribed, onSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
  room.on(RoomEvent.ParticipantDisconnected, onLeft);
  room.on(RoomEvent.Disconnected, onGone);

  return {
    cleanup: () => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      room.off(RoomEvent.Disconnected, onGone);
    },
  };
}

/** Publishes the host's camera + microphone into `live_<id>`. */
export async function joinLiveAsHost(
  grant: LiveGrant,
  stream: MediaStream,
  events: LiveRoomEvents,
): Promise<LiveHostRoom> {
  const room = new Room({ adaptiveStream: false, dynacast: true });
  let viewersHandler: ((count: number) => void) | undefined;

  const emitViewers = () => {
    viewersHandler?.(room.remoteParticipants.size);
  };

  room.on(RoomEvent.ParticipantConnected, emitViewers);
  room.on(RoomEvent.ParticipantDisconnected, emitViewers);

  const bound = bindCoStreams(room, events);
  await room.connect(grant.url, grant.token);
  await publishLocal(room, stream);

  return {
    setMicrophoneEnabled(enabled: boolean) {
      for (const publication of room.localParticipant.audioTrackPublications.values()) {
        if (enabled) void publication.track?.unmute();
        else void publication.track?.mute();
      }
    },
    setCameraEnabled(enabled: boolean) {
      for (const publication of room.localParticipant.videoTrackPublications.values()) {
        if (publication.source === Track.Source.ScreenShare) continue;
        if (enabled) void publication.track?.unmute();
        else void publication.track?.mute();
      }
    },
    viewerCount: () => room.remoteParticipants.size,
    onViewersChanged: (handler) => {
      viewersHandler = handler;
      handler(room.remoteParticipants.size);
    },
    leave: async () => {
      bound.cleanup();
      await room.disconnect();
    },
  };
}

export interface LiveGuestRoom {
  leave: () => Promise<void>;
}

/** A co-host: publishes like the host, watches the host's picture. */
export async function joinLiveAsGuest(
  grant: LiveGrant,
  stream: MediaStream,
  events: LiveRoomEvents,
): Promise<LiveGuestRoom> {
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const bound = bindCoStreams(room, events);
  await room.connect(grant.url, grant.token);
  await publishLocal(room, stream);
  return {
    leave: async () => {
      bound.cleanup();
      await room.disconnect();
    },
  };
}

export interface LiveViewerRoom {
  leave: () => Promise<void>;
}

/** Subscribes to the broadcast. Viewers publish nothing. */
export async function joinLiveAsViewer(
  grant: LiveGrant,
  onStream: (stream: MediaStream) => void,
  onHostLeft: () => void,
  onDisconnected: () => void,
): Promise<LiveViewerRoom> {
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const combined = new MediaStream();
  let announced = false;

  const announce = () => {
    if (!announced && combined.getTracks().length > 0) {
      announced = true;
      onStream(combined);
    }
  };

  room.on(
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, _publication, participant) => {
      // The broadcasters are the only publishers; anything arriving is live.
      void participant;
      combined.addTrack(track.mediaStreamTrack);
      onStream(combined);
      announce();
    },
  );
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    combined.removeTrack(track.mediaStreamTrack);
  });
  room.on(RoomEvent.ParticipantDisconnected, () => {
    if (room.remoteParticipants.size === 0) onHostLeft();
  });
  room.on(RoomEvent.Disconnected, onDisconnected);

  await room.connect(grant.url, grant.token);

  return {
    leave: async () => {
      await room.disconnect();
    },
  };
}
