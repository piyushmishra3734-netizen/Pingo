/**
 * The CallService boundary.
 *
 * WebRTC on the web is the **browser's own API** — `RTCPeerConnection` — so
 * there is nothing to install. `webrtc-sdk/webrtc` is a fork of native
 * libwebrtc for iOS, Android and desktop; it has no place in a web build.
 *
 * What a browser does *not* provide is signalling: the two peers still have to
 * exchange an offer, an answer and ICE candidates through some channel of their
 * own. PINGO uses Supabase Realtime for that, which means no new server.
 *
 * ## What this interface deliberately hides
 *
 * Everything about SDP, ICE and media tracks. A screen asks to call someone and
 * is told what state the call is in. That is what lets the same UI sit on top of
 * a native implementation later, where the peer connection is Swift.
 */

export type CallState =
  /** Local user is dialling; the other side has not responded. */
  | 'dialling'
  /** Incoming, not yet answered. */
  | 'ringing'
  /** Negotiating after an answer — media not flowing yet. */
  | 'connecting'
  | 'connected'
  /** Was connected, lost the network, trying to recover. */
  | 'reconnecting'
  | 'ended';

export type CallEndReason =
  | 'hung-up'
  | 'declined'
  | 'unanswered'
  | 'busy'
  | 'failed'
  | 'cancelled';

export interface CallPeer {
  userId: string;
  name: string;
  avatarUrl?: string;
}

export type CallKind = 'voice' | 'video';

/**
 * One other person on a group call.
 *
 * Carries an id and a state and no name, on purpose: the app already resolves
 * ids to people everywhere else, and a name copied in here would be a second
 * copy to keep current — it would go stale the moment somebody edits their
 * profile mid-call.
 */
export interface CallParticipant {
  userId: string;
  /**
   * `ringing` until they pick up, `left` once they are gone.
   *
   * `left` rather than removing the row: a face that vanishes mid-sentence
   * reads as a bug, and the grid re-flowing under your eyes is worse than one
   * tile going quiet for a moment.
   */
  state: 'ringing' | 'connecting' | 'connected' | 'left';
}

export interface Call {
  id: string;
  peer: CallPeer;
  direction: 'incoming' | 'outgoing';
  /**
   * Chosen when the call is placed, and fixed for its lifetime.
   *
   * Upgrading a voice call to video mid-conversation means renegotiating SDP
   * while media is flowing; it is a real feature, not a variation on this one,
   * and it is deliberately not built. A `video` call whose camera is switched
   * off is still a video call — see `cameraOff`.
   */
  kind: CallKind;
  state: CallState;
  /** Epoch ms the call connected. Absent until it does — this is the timer's zero. */
  connectedAt?: number;
  endReason?: CallEndReason;
  /** True while the local microphone is muted. */
  muted: boolean;
  /** True while the local camera is off. Always true on a voice call. */
  cameraOff: boolean;

  /**
   * Everyone else on the call. Present only for a group call.
   *
   * Its absence is what distinguishes the two: a direct call has exactly one
   * other person and `peer` already names them. On a group call `peer` names
   * the *group*, and this is the roster.
   */
  participants?: CallParticipant[];

  /** The group this call belongs to. Absent for a direct call. */
  conversationId?: string;
}

export type CallEvent =
  | { type: 'call:incoming'; call: Call }
  | { type: 'call:updated'; call: Call }
  | { type: 'call:ended'; call: Call }
  /**
   * One peer's media, ready to attach to an output element.
   *
   * Carries the id because a mesh has one of these per person, and a stream
   * with no name attached cannot be put in the right tile — or stopped when
   * that one person leaves.
   */
  | { type: 'call:remote-stream'; stream: MediaStream; userId: string }
  /** That peer is gone. Detach and forget their stream. */
  | { type: 'call:remote-stream-ended'; userId: string }
  /**
   * This device's own camera, for the self-preview.
   *
   * Emitted separately because it is never played back — feeding your own
   * microphone to a speaker is how you get feedback howl. The UI must attach
   * this to a *muted* video element and nothing else.
   */
  | { type: 'call:local-stream'; stream: MediaStream };

export interface CallServiceOptions {
  /**
   * RNNoise on top of the browser's own suppression.
   *
   * Off by default: `getUserMedia` already applies noise suppression and echo
   * cancellation, and RNNoise costs a 1.9 MB module plus per-frame CPU. It earns
   * that on a noisy line, not on every call.
   */
  noiseSuppression?: boolean;

  /**
   * Voice or video. Ignored by `answer`, which always matches what was offered —
   * answering a video call with audio only would leave the caller staring at a
   * frame that never arrives.
   */
  kind?: CallKind;

  /**
   * Ask for 720p instead of the browser's default.
   *
   * A *request*, not a guarantee: `getUserMedia` gives the closest mode the
   * camera actually has, and WebRTC will scale down anyway when the connection
   * cannot carry it.
   */
  hdVideo?: boolean;

  /** Start a video call with the camera already off. */
  cameraOff?: boolean;
}

export interface CallService {
  /** Starts listening for incoming calls. Safe to call more than once. */
  connect(): Promise<void>;
  disconnect(): void;

  call(peerUserId: string, options?: CallServiceOptions): Promise<Call>;

  /**
   * Rings everyone in a group at once.
   *
   * ## A mesh, not a conference server
   *
   * Each person holds one `RTCPeerConnection` per other person, so media goes
   * directly between them and PINGO never sees a frame — the same privacy
   * property a direct call has, kept. The cost is that upload grows with the
   * room: sending to five people means encoding and uploading five times. That
   * is fine for the size of group anyone actually calls and would not be for a
   * broadcast, which is what an SFU is for. This is the honest trade for a
   * product whose whole argument is that the middle is empty.
   *
   * ## Friendship is not checked
   *
   * A direct call needs a mutual follow, because it is a stranger making your
   * phone ring. Being in a group is already the consent — you were either added
   * by a friend or walked in through a link — so a group call reaches everybody
   * in it whether or not they know each other.
   */
  callGroup(
    conversationId: string,
    participantIds: string[],
    options?: CallServiceOptions,
  ): Promise<Call>;
  answer(callId: string, options?: CallServiceOptions): Promise<void>;
  decline(callId: string): Promise<void>;
  hangUp(callId: string): Promise<void>;

  setMuted(callId: string, muted: boolean): void;

  /** No-op on a voice call, which has no camera track to disable. */
  setCameraOff(callId: string, cameraOff: boolean): void;

  /**
   * Flips between the front and rear camera.
   *
   * Resolves to the facing mode actually in use — a device with one camera
   * stays where it is rather than failing.
   */
  switchCamera(callId: string): Promise<'user' | 'environment'>;

  subscribe(listener: (event: CallEvent) => void): () => void;

  readonly current: Call | undefined;
}
