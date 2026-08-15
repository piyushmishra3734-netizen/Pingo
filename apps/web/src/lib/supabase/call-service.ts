import type {
  Call,
  CallEndReason,
  CallEvent,
  CallKind,
  CallQuality,
  CallParticipant,
  CallService,
  CallServiceOptions,
  CallState,
} from '@pingo/core';

import { trimCallChat } from '../../features/calls/call-chat-rules.js';
import { boostAudioSender, speechAudioConstraints } from '../audio/capture.js';
import { resolveIceServers } from '../webrtc/ice-servers.js';
import { CallRoom } from '../livekit/room.js';
import { qualityReader } from '../webrtc/quality.js';

import { getSupabaseClient, type PingoSupabaseClient } from './client.js';

/**
 * Voice calls: `RTCPeerConnection` for media, Supabase Realtime for signalling.
 *
 * ## Signalling
 *
 * Every signed-in user subscribes to a private broadcast channel named after
 * their own id. To call someone you publish an offer to *their* channel; they
 * reply on yours. That is the whole protocol, and it needs no server beyond the
 * Realtime service the app already runs on.
 *
 * ```
 *   caller                                   callee
 *     │  broadcast offer   ──────────────────▶ │
 *     │ ◀──────────────────   broadcast answer │
 *     │  ⇄ ice candidates, both directions  ⇄  │
 *     │  ═════════ media flows peer-to-peer ═══│
 * ```
 *
 * ## ICE
 *
 * The server list is resolved per call by `resolveIceServers()`, not hard-coded
 * here - TURN credentials expire, so they cannot be a constant. See that module
 * for why the secret is never in this bundle.
 */

/** How long an unanswered call rings before it gives up. */
const RING_TIMEOUT_MS = 45_000;

/*
 * The longest line the in-call chat will carry, shared with the composer.
 *
 * A broadcast payload is not a message body - it goes over the signalling
 * channel that also has to deliver ICE candidates promptly. Somebody pasting a
 * log into the call chat is truncated rather than allowed to hold up the
 * connection everybody else is on. Enforced here because this is the boundary;
 * the field knowing the same number is a courtesy, not the rule.
 */

type SignalPayload =
  /*
   * `media` tells the callee what they are being offered before they answer, so
   * the incoming screen can say "Video call" and open a camera rather than
   * discovering a video track after the fact. Optional because an older client
   * will not send it; absent means voice.
   */
  | { kind: 'offer'; callId: string; from: string; sdp: string; media?: CallKind }
  | { kind: 'answer'; callId: string; from: string; sdp: string }
  | { kind: 'ice'; callId: string; from: string; candidate: RTCIceCandidateInit }
  | { kind: 'decline'; callId: string; from: string }
  | { kind: 'hangup'; callId: string; from: string; reason: CallEndReason }
  /*
   * Group calls. Three extra signals, and each exists because a mesh has to
   * *discover* its members - a direct call knows both ends from the first
   * message and a room does not.
   *
   * `invite` carries no SDP. On a direct call the offer rides along with the
   * ring, because there is exactly one connection to set up and the caller
   * knows who it is with. In a room the caller cannot pre-negotiate: they do
   * not know who will pick up, and offering to five people to have one answer
   * would open four connections nobody wanted.
   */
  | {
      kind: 'invite';
      callId: string;
      from: string;
      media?: CallKind;
      conversationId: string;
      /** Everyone rung, so a joiner learns the room without asking a server. */
      participants: string[];
      /**
       * A one-to-one call that happens to use a room.
       *
       * With LiveKit carrying the media there is no offer to ring with, so a
       * direct call is announced by the same `invite` a group uses. Without
       * this marker the receiving end would build it as a group - naming the
       * conversation instead of the caller, and drawing a roster of two.
       */
      direct?: boolean;
    }
  /** "I have answered." Sent to everyone in the room. */
  | { kind: 'join'; callId: string; from: string }
  /** "So have I." The reply that lets a joiner discover who is already in. */
  | { kind: 'here'; callId: string; from: string }
  /** "I am gone." Ends one connection, not the call. */
  | { kind: 'leave'; callId: string; from: string }
  /**
   * A line of in-call chat.
   *
   * On the signalling channel rather than in the conversation, because it is
   * not a conversation message - see `CallChatMessage`. That also means it
   * costs nothing when nobody types: a call that has no chat sends no chat.
   */
  | {
      kind: 'chat';
      callId: string;
      from: string;
      messageId: string;
      body: string;
      sentAt: number;
    };

/**
 * One leg of the mesh.
 *
 * Everything that used to be a single field on the service is here instead,
 * because a mesh has one of each per person: its own ICE queue, its own video
 * sender to swap a camera into. Holding them as service-level singletons is
 * what made the old code structurally one-to-one.
 */
interface PeerLink {
  connection: RTCPeerConnection;
  /** Candidates that arrived before this leg had a remote description. */
  pending: RTCIceCandidateInit[];
  videoSender: RTCRtpSender | undefined;
  /**
   * An offer is being built for this leg right now.
   *
   * Set *synchronously*, which is the entire point. `signalingState` does not
   * leave `stable` until `setLocalDescription` resolves, so two discoveries of
   * the same peer arriving in the same tick both pass a state check and both
   * send an offer - the second arrives at a peer who is already
   * `have-remote-offer` and is thrown away.
   *
   * That is not hypothetical: it happened on the first three-way run of this
   * code, where one client sent three offers for two legs. It recovered, but
   * only because the *duplicate* was the one discarded. Had the interleaving
   * gone the other way the surviving offer would have been the rejected one,
   * and that leg would have stayed silent for the whole call.
   *
   * Both discoveries are legitimate and both must be handled - when two people
   * answer at once, each learns about the other through a `join` *and* through
   * the `here` that answers their own. This is what makes the second one a
   * no-op instead of a second offer.
   */
  negotiating: boolean;
}

export class SupabaseCallService implements CallService {
  readonly #client: PingoSupabaseClient;

  #listeners = new Set<(event: CallEvent) => void>();
  #channel: ReturnType<PingoSupabaseClient['channel']> | undefined;
  #userId: string | undefined;

  #call: Call | undefined;
  #localStream: MediaStream | undefined;
  #cleanupAudio: (() => void) | undefined;
  #ringTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * One connection per other person, keyed by their id.
   *
   * A direct call is a mesh of one. That is the whole reason this replaced the
   * single `#peerConnection` rather than sitting beside it - two code paths for
   * "talk to somebody" is how the second one rots, and the direct call is the
   * one that gets exercised every day.
   */
  #peers = new Map<string, PeerLink>();

  /** The ICE servers resolved for this call, reused for every leg of the mesh. */
  #iceServers: RTCIceServer[] = [];

  #facing: 'user' | 'environment' = 'user';

  /**
   * The LiveKit room carrying this call's media, when one could be joined.
   *
   * Undefined means the mesh is carrying it instead - see `#joinRoom`. Both
   * paths exist on purpose during the migration: LiveKit is the transport now,
   * and the peer connections stay as the answer to 'what if the room cannot be
   * reached', which is not a question worth finding out about mid-call.
   */
  #room: CallRoom | undefined;

  constructor(client: PingoSupabaseClient = getSupabaseClient()) {
    this.#client = client;
  }

  get current(): Call | undefined {
    return this.#call;
  }

  subscribe(listener: (event: CallEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: CallEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #update(changes: Partial<Call>): void {
    if (!this.#call) return;
    this.#call = { ...this.#call, ...changes };
    this.#emit({ type: 'call:updated', call: this.#call });
  }

  /**
   * How the call is going, measured rather than assumed.
   *
   * One reader per leg, kept across samples because loss has to be differenced
   * against the previous one - see `quality.ts`. The worst leg is the answer: in
   * a mesh, one bad connection is a bad call, and averaging it against three
   * good ones is how a real problem gets reported as fine.
   */
  async quality(): Promise<CallQuality | undefined> {
    const samples = await Promise.all(
      [...this.#peers].map(([userId, link]) => {
        let read = this.#quality.get(userId);
        if (!read) {
          read = qualityReader(link.connection);
          this.#quality.set(userId, read);
        }
        return read();
      }),
    );

    const live = samples.filter((sample): sample is CallQuality => sample !== undefined);
    if (live.length === 0) return undefined;

    return live.reduce((worst, sample) => (sample.loss > worst.loss ? sample : worst));
  }

  #quality = new Map<string, () => Promise<CallQuality | undefined>>();

  // -- signalling ----------------------------------------------------------

  /**
   * Opens the signalling channel. Safe to call repeatedly and concurrently.
   *
   * Both properties matter. React's StrictMode mounts every effect twice in
   * development, so `connect()` is called, torn down, and called again while the
   * first call's `await` is still in flight - without the in-flight guard that
   * leaves two channels on one topic, and the second join hangs forever behind
   * the first. This is the same failure the chat service hit; the shape of the
   * fix is the same.
   */
  async connect(): Promise<void> {
    if (this.#channel) return;
    this.#connecting ??= this.#open().finally(() => {
      this.#connecting = undefined;
    });
    return this.#connecting;
  }

  #connecting: Promise<void> | undefined;

  async #open(): Promise<void> {
    const { data } = await this.#client.auth.getUser();
    const id = data.user?.id;
    if (!id) throw new Error('Not signed in.');

    // Re-checked after the await: a teardown may have run while it was pending.
    if (this.#channel) return;
    this.#userId = id;

    this.#channel = this.#client
      .channel(`call:${id}`, {
        config: {
          /**
           * `private` is the whole reason this is safe.
           *
           * A public Realtime topic is readable by anyone holding the anon key,
           * which every visitor does - so on a public `call:{userId}` topic a
           * stranger could watch your call setup and inject offers. Private
           * topics are gated by RLS on `realtime.messages`, and the policies in
           * `20260726140000_call_signalling.sql` say: you may only *read* your
           * own topic, and you must be signed in to write to anyone's.
           */
          private: true,
          broadcast: {
            /*
             * Not decorative. `self: false` - the default - silently drops
             * signals that arrive over Realtime's HTTP broadcast endpoint,
             * which is exactly how `#send` publishes. Verified in the browser:
             * identical send, received with `self: true`, dropped without it.
             */
            self: true,
            ack: false,
          },
        },
      })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        void this.#onSignal(payload as SignalPayload);
      })
      .subscribe();
  }

  disconnect(): void {
    this.#teardown('cancelled');
    if (this.#channel) void this.#client.removeChannel(this.#channel);
    this.#channel = undefined;
    this.#userId = undefined;
  }

  /**
   * The peer's topic, held for the length of one call.
   *
   * Publishing needs a channel object but not a subscription, so this is never
   * joined - `httpSend` posts to Realtime's REST endpoint and returns. It is
   * cached rather than created per signal because `client.channel()` registers
   * every object it makes, and a call sends a dozen ICE candidates.
   */
  #outbound = new Map<string, ReturnType<PingoSupabaseClient['channel']>>();

  async #send(toUserId: string, payload: SignalPayload): Promise<void> {
    const topic = `call:${toUserId}`;

    /*
     * One cached channel per peer, not one in total.
     *
     * This used to hold a single channel and rebuild it whenever the
     * destination changed, which was free when there was only ever one
     * destination. A mesh interleaves candidates to four people, so that cache
     * would miss on essentially every send - tearing down and re-registering a
     * channel per ICE candidate, and stalling connection setup exactly when
     * candidates matter most.
     */
    let channel = this.#outbound.get(topic);
    if (!channel) {
      channel = this.#client.channel(topic, { config: { private: true } });
      this.#outbound.set(topic, channel);
    }

    /*
     * `httpSend`, not `send`.
     *
     * `send()` on an unjoined channel does reach the same REST endpoint, but
     * only via a deprecated fallback that logs a warning on every signal. This
     * is the explicit form, and it resolves on HTTP 202.
     */
    await channel.httpSend('signal', payload);
  }

  #closeOutbound(): void {
    /*
     * Removed by topic, and the topic is always the *peer's* - never this
     * user's own. That matters: `removeChannel` leaves the topic on the shared
     * socket, so removing a same-topic twin would silently unsubscribe the
     * listening channel and leave the user unreachable. (Observed exactly that
     * while testing a call to oneself.)
     */
    for (const channel of this.#outbound.values()) void this.#client.removeChannel(channel);
    this.#outbound.clear();
  }

  async #onSignal(signal: SignalPayload): Promise<void> {
    switch (signal.kind) {
      case 'offer': {
        /*
         * An offer for the call we are already on is a new leg of the mesh,
         * not somebody ringing. Checked before the busy test, or every person
         * joining a group call would be told the room was busy - by the room.
         */
        if (this.#call?.id === signal.callId && this.#inCall()) {
          await this.#answerOffer(signal.from, signal.callId, signal.sdp);
          return;
        }

        // Busy: already on a call. Told explicitly rather than left ringing.
        if (this.#call && this.#call.state !== 'ended') {
          await this.#send(signal.from, {
            kind: 'hangup',
            callId: signal.callId,
            from: this.#userId!,
            reason: 'busy',
          });
          return;
        }

        this.#call = {
          id: signal.callId,
          peer: { userId: signal.from, name: 'Calling…' },
          direction: 'incoming',
          kind: signal.media ?? 'voice',
          state: 'ringing',
          muted: false,
          // Nothing is being captured yet; answering is what opens the camera.
          cameraOff: true,
        };

        // Held until the user answers - the offer is useless before then.
        this.#pendingOffer = signal.sdp;
        this.#emit({ type: 'call:incoming', call: this.#call });
        this.#armRingTimeout();
        break;
      }

      /*
       * A group ring. No SDP - see the note on the signal type.
       *
       * The roster travels with the invite so a joiner knows the room without
       * asking a server for it, which is what keeps the mesh serverless.
       */
      case 'invite': {
        if (this.#call && this.#call.state !== 'ended') {
          await this.#send(signal.from, {
            kind: 'hangup',
            callId: signal.callId,
            from: this.#userId!,
            reason: 'busy',
          });
          return;
        }

        this.#call = {
          id: signal.callId,
          /*
           * A group invite names the group; a direct one names the caller.
           *
           * On a group call `peer` is the room and the UI fills in its title,
           * the same way it fills in a caller's name. A direct call carried by
           * a room is still a call from a person, and saying "Group call" over
           * one would be the transport leaking into what the screen says.
           */
          peer: signal.direct
            ? { userId: signal.from, name: 'Incoming call' }
            : { userId: signal.conversationId, name: 'Group call' },
          conversationId: signal.conversationId,
          direction: 'incoming',
          kind: signal.media ?? 'voice',
          state: 'ringing',
          muted: false,
          cameraOff: true,
          participants: signal.participants
            .filter((id) => id !== this.#userId)
            .map((userId) => ({ userId, state: 'ringing' as const })),
        };

        this.#emit({ type: 'call:incoming', call: this.#call });
        this.#armRingTimeout();
        break;
      }

      /*
       * Somebody said something.
       *
       * Dropped unless it belongs to the call on screen: a line from a call
       * that has already ended has nowhere to go, and one for a call this
       * device is not on is not ours to display.
       */
      case 'chat': {
        if (this.#call?.id !== signal.callId) return;
        this.#emit({
          type: 'call:chat',
          message: {
            id: signal.messageId,
            userId: signal.from,
            body: signal.body,
            sentAt: signal.sentAt,
          },
        });
        break;
      }

      /*
       * Somebody picked up.
       *
       * Answered by *everyone already in the room*, which is how a joiner
       * discovers who to connect to without a roster service. `here` goes back
       * so they learn about us; the offer is decided by the rule below so
       * exactly one side of each pair offers.
       */
      case 'join': {
        if (this.#call?.id !== signal.callId || !this.#inCall()) return;

        this.#setParticipantState(signal.from, 'connecting');
        await this.#send(signal.from, {
          kind: 'here',
          callId: signal.callId,
          from: this.#userId!,
        });
        if (this.#shouldOffer(signal.from)) await this.#offerTo(signal.from);
        break;
      }

      case 'here': {
        if (this.#call?.id !== signal.callId || !this.#inCall()) return;

        this.#setParticipantState(signal.from, 'connecting');
        if (this.#shouldOffer(signal.from)) await this.#offerTo(signal.from);
        break;
      }

      case 'answer': {
        const link = this.#peers.get(signal.from);
        if (!link || this.#call?.id !== signal.callId) return;
        await link.connection.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        // Settled. Cleared so a later renegotiation on this leg is not blocked
        // by a flag describing an offer that has already been answered.
        link.negotiating = false;
        await this.#drainCandidates(signal.from);
        if (!this.#call.participants) this.#update({ state: 'connecting' });
        break;
      }

      case 'ice': {
        if (this.#call?.id !== signal.callId) return;
        const link = this.#peers.get(signal.from);
        if (link?.connection.remoteDescription) {
          await link.connection.addIceCandidate(signal.candidate).catch(() => {
            // A candidate that cannot be added is not fatal; ICE tries others.
          });
        } else if (link) {
          link.pending.push(signal.candidate);
        } else {
          /*
           * ICE from somebody we have not built a leg for yet.
           *
           * In a mesh this is routine rather than exceptional: their candidates
           * start flowing the moment they set a local description, which can
           * beat their offer to us. Dropping these is a call that takes the
           * long way round through TURN, or does not connect at all.
           */
          const queued = this.#earlyCandidates.get(signal.from) ?? [];
          queued.push(signal.candidate);
          this.#earlyCandidates.set(signal.from, queued);
        }
        break;
      }

      case 'decline':
        if (this.#call?.id !== signal.callId) return;
        // In a room, one person saying no is not the call being declined.
        if (this.#call.participants) this.#dropPeer(signal.from);
        else this.#teardown('declined');
        break;

      case 'leave':
        if (this.#call?.id === signal.callId) this.#dropPeer(signal.from);
        break;

      case 'hangup':
        if (this.#call?.id !== signal.callId) return;
        // In a room this is one person going - including the `busy` a phone
        // already on another call sends back. It is never the room ending.
        if (this.#call.participants) this.#dropPeer(signal.from);
        else this.#teardown(signal.reason);
        break;
    }
  }

  #pendingOffer: string | undefined;

  /** Candidates that arrived before their leg existed, keyed by sender. */
  #earlyCandidates = new Map<string, RTCIceCandidateInit[]>();

  /** True once we have media open - i.e. we are in the room, not just ringing. */
  #inCall(): boolean {
    return Boolean(this.#localStream) && this.#call?.state !== 'ringing';
  }

  /**
   * Which side of a pair creates the offer.
   *
   * Both ends run this and reach opposite answers, so exactly one offers. Any
   * total order over the two ids would do - the point is that it is decided by
   * *who they are* rather than by who spoke first, because who spoke first is
   * precisely what two people joining at the same instant cannot agree on.
   *
   * Without it, both sides offer, both set a local description, and both reject
   * the other's offer for being in the wrong signalling state. That is glare,
   * and in a mesh it is not a rare race - it is what happens every time two
   * people answer the same ring together.
   */
  #shouldOffer(peerUserId: string): boolean {
    return (this.#userId ?? '') < peerUserId;
  }

  async #offerTo(peerUserId: string): Promise<void> {
    const callId = this.#call?.id;
    if (!callId) return;

    const link = this.#link(peerUserId, callId);

    // Already negotiating or negotiated. The flag is checked as well as the
    // signalling state because the state lags an offer that is still being
    // built - see `PeerLink.negotiating`.
    if (link.negotiating || link.connection.signalingState !== 'stable') return;
    link.negotiating = true;

    const offer = await link.connection.createOffer();
    await link.connection.setLocalDescription(offer);

    await this.#send(peerUserId, {
      kind: 'offer',
      callId,
      from: this.#userId!,
      sdp: offer.sdp ?? '',
      media: this.#call?.kind,
    });
  }

  /**
   * Answers an offer that arrived mid-call, for a leg we did not initiate.
   *
   * Only reachable on a group call: on a direct call the offer arrives with the
   * ring and is held until the user picks up, because answering it before then
   * would open the microphone of somebody who has not agreed to talk.
   */
  async #answerOffer(peerUserId: string, callId: string, sdp: string): Promise<void> {
    const link = this.#link(peerUserId, callId);

    await link.connection.setRemoteDescription({ type: 'offer', sdp });
    await this.#drainCandidates(peerUserId);

    const answer = await link.connection.createAnswer();
    await link.connection.setLocalDescription(answer);

    await this.#send(peerUserId, {
      kind: 'answer',
      callId,
      from: this.#userId!,
      sdp: answer.sdp ?? '',
    });
  }

  async #drainCandidates(peerUserId: string): Promise<void> {
    const link = this.#peers.get(peerUserId);
    if (!link) return;

    const early = this.#earlyCandidates.get(peerUserId) ?? [];
    this.#earlyCandidates.delete(peerUserId);

    const queued = [...early, ...link.pending];
    link.pending = [];

    for (const candidate of queued) {
      await link.connection.addIceCandidate(candidate).catch(() => {});
    }
  }

  // -- media ---------------------------------------------------------------

  /** Constraints for the camera, in one place because two call sites need them. */
  #videoConstraints(options?: CallServiceOptions): MediaTrackConstraints {
    return {
      facingMode: this.#facing,
      /*
       * `ideal`, never `exact`. An exact constraint on a camera that cannot hit
       * 720p rejects with `OverconstrainedError` and kills the call; ideal asks
       * for it and accepts whatever the hardware actually offers.
       */
      width: { ideal: options?.hdVideo ? 1280 : 640 },
      height: { ideal: options?.hdVideo ? 720 : 480 },
    };
  }

  async #openMedia(kind: CallKind, options?: CallServiceOptions): Promise<MediaStream> {
    /*
     * Same speech capture for voice and video.
     *
     * Video calls used to *feel* clearer because the peer connection was
     * already carrying more media capacity; voice-only and notes were left on
     * minimal constraints. One path keeps them even - 48 kHz mono speech with
     * the browser's AEC/NS/AGC, then optional RNNoise on top.
     */
    /*
     * A video call may legitimately have nothing to capture.
     *
     * Somebody joining to share their screen has no reason to have granted a
     * camera or a microphone, and being refused either used to end the call
     * before it started - the throw below tore it down and the person never got
     * as far as the share button. So on a video call a refusal is survivable:
     * the call connects with whatever tracks exist, which may be none, and the
     * screen can still be published into it.
     *
     * A voice call keeps the old behaviour. There is nothing to join a voice
     * call *for* without a microphone, and connecting one silently would be a
     * worse answer than saying the microphone was refused.
     */
    const wanted: MediaStreamConstraints = {
      audio: speechAudioConstraints({
        echoCancellation: options?.echoCancellation !== false,
        // Browser NS stays on even when RNNoise is requested - RNNoise is a
        // second pass, not a replacement (see rnnoise.ts).
        noiseSuppression: true,
        autoGainControl: true,
        hd: options?.hdAudio !== false,
      }),
      video: kind === 'video' ? this.#videoConstraints(options) : false,
    };

    let raw: MediaStream;
    try {
      raw = await navigator.mediaDevices.getUserMedia(wanted);
    } catch (cause) {
      if (kind !== 'video') throw cause;

      /*
       * Try each half on its own before giving up on both.
       *
       * A refused camera and a refused microphone are separate permissions, and
       * `getUserMedia` fails the whole request if either is denied - so asking
       * for both and catching once would drop a working microphone because the
       * camera was off. Whatever is available is used; an empty stream is a
       * valid answer and is what a screen-share-only participant joins with.
       */
      const parts: MediaStreamTrack[] = [];
      for (const half of [{ audio: wanted.audio }, { video: wanted.video }]) {
        if (!half.audio && !half.video) continue;
        try {
          const got = await navigator.mediaDevices.getUserMedia(half);
          parts.push(...got.getTracks());
        } catch {
          // Refused or absent. The call proceeds without it.
        }
      }
      raw = new MediaStream(parts);
    }

    /*
     * Held separately from the stream that gets sent.
     *
     * With RNNoise on, the transmitted stream is the worklet's *output* - a
     * different object whose tracks are not the microphone. Stopping only that
     * one leaves the real microphone open and the browser's recording indicator
     * lit after the call ends.
     */
    this.#rawTracks = raw.getTracks();
    this.#hdAudio = options?.hdAudio !== false;

    if (!options?.noiseSuppression) return raw;

    try {
      const { applyRNNoise } = await import('../../features/calls/audio/rnnoise.js');
      const { stream, cleanup } = await applyRNNoise(raw);
      this.#cleanupAudio = cleanup;

      // RNNoise returns audio only, so the camera track is carried across by
      // hand - otherwise turning on noise suppression would silently drop video.
      return new MediaStream([...stream.getAudioTracks(), ...raw.getVideoTracks()]);
    } catch {
      // RNNoise failing must not fail the call - the browser's suppression is
      // still running, and a slightly noisier call beats no call.
      return raw;
    }
  }

  /** Whether this call requested HD audio (bitrate + sample rate). */
  #hdAudio = true;

  #rawTracks: MediaStreamTrack[] = [];

  /**
   * Adds the captured tracks to the connection and publishes the self-preview.
   *
   * Shared by both legs - caller and callee do exactly the same thing here, and
   * when they drifted apart earlier it was the callee that quietly lost video.
   */
  #attachLocalTracks(link: PeerLink): void {
    const stream = this.#localStream;
    if (!stream) return;

    /*
     * The same tracks, added to every leg.
     *
     * One capture, N encodings - which is the mesh's real cost and the reason
     * it is right for a handful of people and wrong for a hundred. Sharing the
     * track object rather than re-opening the camera per peer is what keeps it
     * to one capture: mute and camera-off then apply everywhere at once,
     * because there is only ever one track to disable.
     */
    for (const track of stream.getTracks()) {
      const sender = link.connection.addTrack(track, stream);
      if (track.kind === 'video') {
        link.videoSender = sender;
        capVideoSender(sender);
      }
      if (track.kind === 'audio') {
        // Prefer the speech codec and set an explicit Opus rate - voice-only
        // used to sit on browser defaults while video calls negotiated a
        // richer path. See `capture.ts` for why the number is small.
        boostAudioSender(link.connection, sender, this.#hdAudio);
      }
    }

    if (stream.getVideoTracks().length > 0) {
      this.#emit({ type: 'call:local-stream', stream });
    }
  }

  /**
   * Opens one leg of the mesh, or hands back the one already open.
   *
   * Idempotent because discovery can name the same person twice - a `join` and
   * a `here` can cross on the wire - and building a second connection to
   * somebody you are already talking to gets you two of their voice.
   */
  #link(peerUserId: string, callId: string): PeerLink {
    const existing = this.#peers.get(peerUserId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({ iceServers: this.#iceServers });
    const link: PeerLink = {
      connection,
      pending: [],
      videoSender: undefined,
      negotiating: false,
    };
    this.#peers.set(peerUserId, link);

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.#send(peerUserId, {
        kind: 'ice',
        callId,
        from: this.#userId!,
        candidate: event.candidate.toJSON(),
      });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      // Named, so the UI can put it in this person's tile rather than guessing.
      if (stream) this.#emit({ type: 'call:remote-stream', stream, userId: peerUserId });
    };

    connection.onconnectionstatechange = () => {
      this.#onLegStateChange(peerUserId, connection.connectionState);
    };

    this.#attachLocalTracks(link);
    return link;
  }

  /**
   * One leg changed. What that means for the call depends on the others.
   *
   * This is where a mesh stops behaving like a direct call. On a direct call a
   * failed connection *is* a failed call, so the old code tore everything down
   * - correct for one peer, and catastrophic for five: one person's flaky
   * network would end the call for the whole room. Here a leg failing removes
   * that person and nothing else, and the call itself is only as ended as the
   * roster is empty.
   */
  #onLegStateChange(peerUserId: string, state: RTCPeerConnectionState): void {
    if (!this.#call) return;

    const group = Boolean(this.#call.participants);

    if (state === 'failed' || state === 'closed') {
      if (!group) {
        this.#teardown('failed');
        return;
      }
      this.#dropPeer(peerUserId);
      return;
    }

    if (group) {
      const participantState =
        state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : undefined;
      if (participantState) this.#setParticipantState(peerUserId, participantState);
    }

    const map: Partial<Record<RTCPeerConnectionState, CallState>> = {
      connected: 'connected',
      disconnected: 'reconnecting',
      connecting: 'connecting',
    };

    const next = map[state];
    if (!next) return;

    /*
     * In a room, one person reconnecting must not put the whole call into
     * "Reconnecting…" while four others are talking normally. The call is
     * connected while anybody is.
     */
    if (group && next !== 'connected' && this.#anyoneConnected()) return;

    this.#update({
      state: next,
      // The timer starts at the first connect, not at each reconnect.
      ...(next === 'connected' && !this.#call.connectedAt ? { connectedAt: Date.now() } : {}),
    });
    if (next === 'connected') this.#clearRingTimeout();
  }

  #anyoneConnected(): boolean {
    for (const link of this.#peers.values()) {
      if (link.connection.connectionState === 'connected') return true;
    }
    return false;
  }

  #setParticipantState(userId: string, state: CallParticipant['state']): void {
    if (!this.#call?.participants) return;

    let changed = false;
    const participants = this.#call.participants.map((participant) => {
      if (participant.userId !== userId || participant.state === state) return participant;
      changed = true;
      return { ...participant, state };
    });

    // Returning without emitting when nothing moved keeps a chatty connection
    // state from re-rendering the grid on every ICE transition.
    if (changed) this.#update({ participants });
  }

  /**
   * Removes one person from the mesh, leaving the call standing.
   *
   * Their tile goes quiet rather than disappearing - `left`, not deleted - so a
   * grid of four does not re-flow under everyone's eyes the instant somebody's
   * train enters a tunnel.
   */
  #dropPeer(userId: string): void {
    const link = this.#peers.get(userId);
    if (link) {
      link.connection.close();
      this.#peers.delete(userId);
      this.#emit({ type: 'call:remote-stream-ended', userId });
    }

    this.#setParticipantState(userId, 'left');

    // The last person leaving ends the call. Sitting alone in an empty room
    // waiting for a ring timeout that was cleared long ago is not a state.
    if (this.#call?.participants && this.#peers.size === 0) {
      const anyoneLeft = this.#call.participants.some((p) => p.state !== 'left');
      if (!anyoneLeft) this.#teardown('hung-up');
    }
  }

  // -- public actions ------------------------------------------------------

  /**
   * Puts this call's media on LiveKit, or says it could not.
   *
   * Returns `true` when the room is carrying the call, in which case no peer
   * connection is built and the mesh signals are never sent. Returns `false`
   * for every failure - no token, no route, misconfiguration - and the caller
   * falls through to the mesh exactly as before.
   *
   * That fallback is the whole reason both paths exist right now. Calling works
   * today; a transport swap that cannot be tested with two real devices in two
   * real places must not be able to take it away.
   *
   * `conversationId` is required because the token is authorised against
   * conversation membership, which is what stops a signed-in stranger minting a
   * pass into somebody else's room.
   */
  async #joinRoom(callId: string, conversationId: string | undefined): Promise<boolean> {
    if (!conversationId || !this.#localStream) return false;

    const room = new CallRoom({
      onRemoteStream: (userId, stream) => {
        this.#setParticipantState(userId, 'connected');
        this.#emit({ type: 'call:remote-stream', userId, stream });
        // A room that is carrying media is a call that has connected.
        if (this.#call && this.#call.state !== 'connected') {
          this.#clearRingTimeout();
          this.#update({ state: 'connected', connectedAt: this.#call.connectedAt ?? Date.now() });
        }
      },
      onRemoteGone: (userId) => {
        this.#setParticipantState(userId, 'left');
        this.#emit({ type: 'call:remote-stream-ended', userId });
      },
      onScreenStream: (userId, stream) =>
        this.#emit({ type: 'call:screen-stream', stream, userId }),
      onScreenGone: (userId) => this.#emit({ type: 'call:screen-ended', userId }),
      /*
       * Somebody being in the room is somebody having answered.
       *
       * This used to only mark the tile `connecting` and leave the call
       * ringing until their first track arrived - which is fine right up until
       * a participant has no tracks. A video call now survives a refused
       * camera and microphone, so "they joined with nothing" is a real state,
       * and in it no track ever arrived, the ringback never stopped, and the
       * caller sat listening to their own phone ring at somebody who was
       * already on the call.
       *
       * Presence in the room is the transport telling us they picked up, and
       * it does not depend on them having anything to send.
       */
      onParticipantJoined: (userId) => {
        this.#setParticipantState(userId, 'connected');
        this.#clearRingTimeout();
        if (this.#call && this.#call.state !== 'connected') {
          this.#update({ state: 'connected', connectedAt: this.#call.connectedAt ?? Date.now() });
        }
      },
      onReconnecting: () => this.#update({ state: 'reconnecting' }),
      onReconnected: () => this.#update({ state: 'connected' }),
      onDisconnected: () => {
        /*
         * Said out loud, because this is the one way a call can end that looks
         * from the outside exactly like the UI having crashed: the screen goes,
         * and nobody is told which of the two happened. One line in the console
         * separates "the room dropped us" from "React gave up".
         */
        if (this.#room) console.warn('[call] the room disconnected; ending the call');
        // Only ends the call if the room was the thing carrying it.
        if (this.#room) this.#teardown('failed');
      },
    });

    try {
      await room.join(callId, conversationId, this.#localStream);
      this.#room = room;
      return true;
    } catch (cause) {
      console.warn('[call] LiveKit unavailable, falling back to peer-to-peer', cause);
      await room.leave().catch(() => undefined);
      return false;
    }
  }

  async call(peerUserId: string, options?: CallServiceOptions): Promise<Call> {
    await this.connect();

    const kind = options?.kind ?? 'voice';
    const callId = crypto.randomUUID();
    this.#call = {
      id: callId,
      peer: { userId: peerUserId, name: 'Calling…' },
      direction: 'outgoing',
      kind,
      state: 'dialling',
      muted: false,
      cameraOff: kind === 'voice' || Boolean(options?.cameraOff),
    };
    this.#emit({ type: 'call:updated', call: this.#call });

    /*
     * Everything after the emit is torn down on failure.
     *
     * The emit has to come first - it is what puts "Calling…" on screen while
     * the microphone opens - but that means a refused or missing microphone
     * leaves a call the UI is showing and the service no longer believes in.
     * Without this the user is stranded on a call screen for a call that never
     * started. Rethrown, because the caller still needs to say why.
     */
    try {
      /*
       * In parallel: the TURN credential is an HTTP round trip and the camera
       * permission prompt can take seconds. Doing them in sequence would add the
       * network time to every call for no reason. `resolveIceServers` never
       * rejects, so only the media failure can reach the catch below.
       */
      const [stream, iceServers] = await Promise.all([
        this.#openMedia(kind, options),
        resolveIceServers(),
      ]);

      this.#localStream = stream;
      this.#iceServers = iceServers;

      // Honours `cameraOff` before the first frame is ever sent, so starting
      // camera-off never leaks a moment of video.
      if (this.#call.cameraOff) this.#applyCameraOff(true);

      /*
       * The room first, the mesh only if there is no room.
       *
       * A direct call still rings over the same broadcast channel either way -
       * LiveKit has no idea anybody's phone should light up. What changes is
       * what the ring points at: a room to join, or an offer to answer.
       */
      const onRoom = await this.#joinRoom(callId, options?.conversationId);

      if (onRoom) {
        await this.#send(peerUserId, {
          kind: 'invite',
          callId,
          from: this.#userId!,
          media: kind,
          conversationId: options!.conversationId!,
          participants: [this.#userId!, peerUserId],
          direct: true,
        });
      } else {
        const link = this.#link(peerUserId, callId);
        const offer = await link.connection.createOffer();
        await link.connection.setLocalDescription(offer);

        await this.#send(peerUserId, {
          kind: 'offer',
          callId,
          from: this.#userId!,
          sdp: offer.sdp ?? '',
          media: kind,
        });
      }
    } catch (cause) {
      this.#teardown('failed');
      throw cause;
    }

    this.#armRingTimeout();
    return this.#call;
  }

  /**
   * Rings a whole group.
   *
   * The media opens *before* anybody is invited, and that order is deliberate:
   * a refused microphone should be a dialog on your own screen, not five
   * phones ringing for a call you turn out to be unable to join.
   *
   * Nothing is negotiated here. The invite is a ring and only a ring; each
   * connection is built when its person actually answers, so calling six
   * people and having one pick up costs one connection rather than six.
   */
  async callGroup(
    conversationId: string,
    participantIds: string[],
    options?: CallServiceOptions,
  ): Promise<Call> {
    await this.connect();

    const kind = options?.kind ?? 'voice';
    const callId = crypto.randomUUID();
    const others = participantIds.filter((id) => id !== this.#userId);

    this.#call = {
      id: callId,
      peer: { userId: conversationId, name: 'Group call' },
      conversationId,
      direction: 'outgoing',
      kind,
      state: 'dialling',
      muted: false,
      cameraOff: kind === 'voice' || Boolean(options?.cameraOff),
      participants: others.map((userId) => ({ userId, state: 'ringing' as const })),
    };
    this.#emit({ type: 'call:updated', call: this.#call });

    try {
      const [stream, iceServers] = await Promise.all([
        this.#openMedia(kind, options),
        resolveIceServers(),
      ]);

      this.#localStream = stream;
      this.#iceServers = iceServers;
      if (this.#call.cameraOff) this.#applyCameraOff(true);

      // The self-preview, which otherwise appears only once a leg is built  - 
      // and on a group call the first leg may be twenty seconds away.
      if (stream.getVideoTracks().length > 0) {
        this.#emit({ type: 'call:local-stream', stream });
      }

      /*
       * The room, before anybody is invited.
       *
       * `#answerGroup` joins the room and, having joined, sends no `join` to
       * the mesh - there is nobody to negotiate with in an SFU. So if the host
       * is not already in that room when the invites go out, every person who
       * picks up walks into an empty one and the host sits ringing forever
       * waiting for a mesh signal that will never be sent. That is what a group
       * call did until the moment the token endpoint started working: the
       * fallback hid it, because a room nobody could join is a room nobody was
       * missing from.
       *
       * `call()` has always done this for direct calls. Groups are the same
       * rule, and the failure was that only one of the two paths said so.
       */
      await this.#joinRoom(callId, conversationId);

      /*
       * The state deliberately stays `dialling`.
       *
       * The caller counts as being in the room from the moment they place the
       * call - `#inCall()` tests for media plus "not still ringing", and
       * `dialling` satisfies both - so an early `join` is answered without
       * having to advance anything here.
       *
       * Advancing to `connecting` would have been the obvious thing and would
       * have stopped the ringback tone, which is driven by the call state:
       * a group call would ring six phones while its caller sat in silence.
       * The first leg to negotiate moves it on, which is exactly when the
       * ringing should stop.
       */
      await Promise.all(
        others.map((userId) =>
          this.#send(userId, {
            kind: 'invite',
            callId,
            from: this.#userId!,
            media: kind,
            conversationId,
            participants: participantIds,
          }),
        ),
      );
    } catch (cause) {
      this.#teardown('failed');
      throw cause;
    }

    this.#armRingTimeout();
    return this.#call;
  }

  async answer(callId: string, options?: CallServiceOptions): Promise<void> {
    if (!this.#call || this.#call.id !== callId) return;

    // A group ring carries no offer, so there is nothing to answer - there is a
    // room to announce yourself to. See `#answerGroup`.
    if (this.#call.participants) return this.#answerGroup(callId, options);

    if (!this.#pendingOffer) return;

    this.#clearRingTimeout();
    // `options.kind` is ignored here on purpose: the offer decides. See the
    // note on `CallServiceOptions.kind`.
    const kind = this.#call.kind;
    this.#update({ state: 'connecting', cameraOff: kind === 'voice' });

    /*
     * Torn down on failure, exactly as in `call()`.
     *
     * Without this a refused or missing camera leaves the call stuck on
     * "Connecting…" forever - the state was already advanced, no media ever
     * arrives, and the ring timeout has been cleared so nothing will ever end
     * it. Observed on a machine with no capture hardware.
     */
    const peerUserId = this.#call.peer.userId;
    try {
      const [stream, iceServers] = await Promise.all([
        this.#openMedia(kind, options),
        resolveIceServers(),
      ]);

      this.#localStream = stream;
      this.#iceServers = iceServers;

      await this.#answerOffer(peerUserId, callId, this.#pendingOffer);
    } catch (cause) {
      // The caller is still ringing and deserves to know, rather than being left
      // to time out 45 seconds later.
      await this.#send(peerUserId, {
        kind: 'hangup',
        callId,
        from: this.#userId!,
        reason: 'failed',
      }).catch(() => {});
      this.#teardown('failed');
      throw cause;
    }

    this.#pendingOffer = undefined;
  }

  /**
   * Joining a room, rather than answering a person.
   *
   * The whole protocol is one broadcast: *I have answered.* Everyone already in
   * the room replies `here`, and each pair then builds its own connection with
   * the offerer decided by `#shouldOffer`. Nobody had to be told who was in the
   * room, which is what lets a mesh work without a conference server.
   *
   * The announcement goes to everyone who was *invited*, not to everyone who
   * has answered - we cannot know the latter, and that is precisely the thing
   * being discovered.
   */
  /**
   * Walks into a group call already in progress.
   *
   * ## Why this is not `answer`
   *
   * `answer` finishes a ring this device is already holding. Somebody tapping a
   * call in the thread has no ring: they declined it, or they were away, or
   * they joined the group after it started. There is nothing to answer, so the
   * call is constructed here and then announced exactly as an answered ring
   * would be - `#answerGroup` is shared, so a joiner and an answerer reach the
   * room by the same path and cannot drift apart.
   *
   * ## The roster is the whole group
   *
   * A joiner cannot know who is actually in the room - that is what `here`
   * replies are for. So `join` goes to every member, and the ones who are not
   * in the call drop it on the floor: the handler ignores a `join` whose
   * `callId` it does not recognise. Broadcasting to a few extra people is a
   * signalling message each; asking a server who is in the room would be a
   * table, a policy and a source of truth to keep honest.
   */
  async joinGroupCall(
    callId: string,
    conversationId: string,
    title: string,
    memberIds: string[],
    kind: CallKind = 'voice',
    options?: CallServiceOptions,
  ): Promise<void> {
    await this.connect();
    if (this.#call) return;

    const others = memberIds.filter((id) => id !== this.#userId);

    this.#call = {
      id: callId,
      peer: { userId: conversationId, name: title },
      conversationId,
      direction: 'incoming',
      kind,
      state: 'connecting',
      muted: false,
      cameraOff: kind === 'voice' || Boolean(options?.cameraOff),
      participants: others.map((userId) => ({ userId, state: 'ringing' as const })),
    };
    this.#emit({ type: 'call:updated', call: this.#call });

    await this.#answerGroup(callId, options);
  }

  async #answerGroup(callId: string, options?: CallServiceOptions): Promise<void> {
    if (!this.#call?.participants) return;

    this.#clearRingTimeout();
    const kind = this.#call.kind;
    /*
     * Everyone invited, which already includes whoever placed the call.
     *
     * `peer.userId` is the *conversation* on a group call, not the host, so
     * there is no separate person to tell - reading it as one would have sent
     * every announcement to a topic nobody listens on.
     */
    const roster = this.#call.participants.map((participant) => participant.userId);

    this.#update({ state: 'connecting', cameraOff: kind === 'voice' });

    try {
      const [stream, iceServers] = await Promise.all([
        this.#openMedia(kind, options),
        resolveIceServers(),
      ]);

      this.#localStream = stream;
      this.#iceServers = iceServers;
      if (this.#call.cameraOff) this.#applyCameraOff(true);
      if (stream.getVideoTracks().length > 0) {
        this.#emit({ type: 'call:local-stream', stream });
      }

      /*
       * The room, if there is one to join.
       *
       * Joining it is the whole of answering when LiveKit carries the call: the
       * discovery below exists to find peers to negotiate with, and an SFU has
       * none to find. Everyone who joins the same room finds everyone else in
       * it, which is the part a mesh had to be told.
       */
      if (await this.#joinRoom(callId, this.#call.conversationId)) {
        this.#update({
          state: 'connected',
          connectedAt: this.#call.connectedAt ?? Date.now(),
        });
        return;
      }

      /*
       * Announced only once media is open.
       *
       * A `here` can come back within milliseconds and an offer straight after
       * it, and `#link` attaches the local tracks as it builds the connection  -
       * announcing first would race a leg into existence with nothing to send
       * down it, and that leg would be silent for the rest of the call.
       */
      await Promise.all(
        roster.map((userId) =>
          this.#send(userId, { kind: 'join', callId, from: this.#userId! }),
        ),
      );
    } catch (cause) {
      /*
       * Tell the room, not just the host.
       *
       * A direct call has one person waiting; a group has everyone who already
       * picked up, and each of them is holding a tile that says you are
       * connecting. Silence would leave it there.
       */
      await Promise.all(
        roster.map((userId) =>
          this.#send(userId, {
            kind: 'leave',
            callId,
            from: this.#userId!,
          }).catch(() => {}),
        ),
      );
      this.#teardown('failed');
      throw cause;
    }
  }

  /**
   * Says something to everybody on the call.
   *
   * Echoed locally rather than sent to our own topic. Publishing to
   * `call:<self>` would make an outbound channel carrying the same topic as
   * the subscribed one, and tearing that down at the end of the call
   * unsubscribes the channel this device *listens* on - which is the failure
   * already recorded on `#clearOutbound`, and it leaves the user unreachable
   * rather than merely without their own message.
   *
   * Empty and runaway input is refused here rather than in the composer,
   * because this is the boundary: the composer is one caller, and the next one
   * would have to remember the same two rules.
   */
  async sendCallChat(callId: string, body: string): Promise<void> {
    if (this.#call?.id !== callId || !this.#userId) return;

    const text = trimCallChat(body);
    if (!text) return;

    const message = {
      id: crypto.randomUUID(),
      userId: this.#userId,
      body: text,
      sentAt: Date.now(),
    };

    this.#emit({ type: 'call:chat', message });

    await Promise.all(
      this.#audience().map((userId) =>
        this.#send(userId, {
          kind: 'chat',
          callId,
          from: this.#userId!,
          messageId: message.id,
          body: message.body,
          sentAt: message.sentAt,
        }).catch(() => {}),
      ),
    );
  }

  /** Everyone this call has to be told about, deduplicated. */
  #audience(): string[] {
    if (!this.#call) return [];
    const roster = this.#call.participants?.map((participant) => participant.userId) ?? [];
    // The host is in `peer` on a group call, and `peer` is the *conversation*
    // there - so the roster is the list, and a direct call is just peer.
    return this.#call.participants
      ? [...new Set([...roster, ...this.#peers.keys()])]
      : [this.#call.peer.userId];
  }

  async decline(callId: string): Promise<void> {
    if (this.#call?.id !== callId) return;

    await Promise.all(
      this.#audience().map((userId) =>
        this.#send(userId, { kind: 'decline', callId, from: this.#userId! }).catch(() => {}),
      ),
    );
    this.#teardown('declined');
  }

  async hangUp(callId: string): Promise<void> {
    if (this.#call?.id !== callId) return;

    const wasConnected = Boolean(this.#call.connectedAt);
    const group = Boolean(this.#call.participants);
    const audience = this.#audience();

    /*
     * `leave`, not `hangup`, when it is a room.
     *
     * They are genuinely different acts and the old signal could only say one
     * of them: hanging up a direct call ends it for both people, and walking
     * out of a group ends it for nobody. Sending `hangup` to a room would clear
     * everyone's screen the moment the first person stepped away.
     */
    await Promise.all(
      audience.map((userId) =>
        this.#send(
          userId,
          group
            ? { kind: 'leave', callId, from: this.#userId! }
            : {
                kind: 'hangup',
                callId,
                from: this.#userId!,
                reason: wasConnected ? 'hung-up' : 'cancelled',
              },
        ).catch(() => {}),
      ),
    );

    this.#teardown(wasConnected ? 'hung-up' : 'cancelled');
  }

  setMuted(callId: string, muted: boolean): void {
    if (this.#call?.id !== callId) return;
    // Disabling the track keeps the connection up and stops sending audio,
    // which is what mute means - stopping the track would end the call's media.
    for (const track of this.#localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
    /*
     * And told to the room, which is not the same thing.
     *
     * Disabling the track already stops the audio - the published track is this
     * one. What this adds is the *state*: LiveKit tells the other participants
     * somebody is muted, so their screens can show it. Without it the audio
     * stops and nobody is told why.
     */
    this.#room?.setMicrophoneEnabled(!muted);
    this.#update({ muted });
  }

  setCameraOff(callId: string, cameraOff: boolean): void {
    if (this.#call?.id !== callId || this.#call.kind !== 'video') return;

    /*
     * There may be no camera track to enable.
     *
     * A video call now survives a refused camera - that is what lets somebody
     * join to share their screen with nothing switched on. The cost was that
     * `#applyCameraOff` then looped over zero video tracks forever: the button
     * flipped, nothing was captured, and the other side never saw a picture.
     * Turning the camera *on* has to be able to open one.
     */
    if (!cameraOff && (this.#localStream?.getVideoTracks().length ?? 0) === 0) {
      void this.#startCamera();
      return;
    }

    this.#applyCameraOff(cameraOff);
    // Same reason as mute: the track stops either way, this is what says so.
    this.#room?.setCameraEnabled(!cameraOff);
    this.#update({ cameraOff });
  }

  /**
   * Opens a camera mid-call and publishes it.
   *
   * Only reachable when the call started without one. The permission prompt
   * appears now rather than at the start, which is the honest moment for it -
   * this is the click that asks for a camera.
   *
   * A refusal puts the button back rather than leaving it showing a camera that
   * is not on. The call is untouched either way: somebody who declines twice is
   * still on the call, listening.
   */
  async #startCamera(): Promise<void> {
    const callId = this.#call?.id;
    if (!callId) return;

    try {
      const opened = await navigator.mediaDevices.getUserMedia({
        video: this.#videoConstraints(),
      });
      const track = opened.getVideoTracks()[0];
      if (!track) throw new Error('No camera track.');
      if (this.#call?.id !== callId) {
        // The call ended while the prompt was open. Do not leave the camera on.
        track.stop();
        return;
      }

      this.#rawTracks = [...this.#rawTracks, track];
      this.#localStream?.addTrack(track);

      /*
       * The room can take a new publication mid-call; the mesh cannot.
       *
       * A peer connection built without a video sender needs a fresh offer and
       * answer to grow one, and that renegotiation does not exist here. The
       * mesh is the fallback for a room we could not reach, and a call that
       * started with no camera on the fallback keeps none - it is a corner of a
       * corner, and inventing renegotiation for it would be the tail wagging
       * the dog. `videoSender` is present whenever the call opened with a
       * camera, which is every other case.
       */
      if (this.#room) await this.#room.replaceVideo(track);
      else {
        await Promise.all(
          [...this.#peers.values()].map((link) => link.videoSender?.replaceTrack(track)),
        );
      }

      if (this.#localStream) {
        this.#emit({ type: 'call:local-stream', stream: this.#localStream });
      }
      this.#update({ cameraOff: false });
    } catch {
      this.#update({ cameraOff: true });
    }
  }

  /**
   * Disables the camera track rather than stopping it.
   *
   * A stopped track cannot be restarted - turning the camera back on would mean
   * a fresh `getUserMedia` and a renegotiation. Disabling transmits black
   * frames at almost no bitrate and flips back instantly, which is what every
   * other client does too.
   */
  #applyCameraOff(cameraOff: boolean): void {
    for (const track of this.#localStream?.getVideoTracks() ?? []) {
      track.enabled = !cameraOff;
    }
  }

  /**
   * Starts or stops sharing this device's screen.
   *
   * Only a room can carry it: a screen is a second video track alongside the
   * camera, and the mesh's per-leg senders were built for exactly one. A call
   * that fell back to peer-to-peer therefore says so rather than appearing to
   * share into a void.
   *
   * Rejecting is normal. Somebody who opens the browser's picker and changes
   * their mind produces exactly the same error as a failure, and neither is a
   * reason to end a call - the caller shows a retry and the call carries on.
   */
  async setScreenShare(callId: string, sharing: boolean): Promise<void> {
    if (this.#call?.id !== callId) return;

    const room = this.#room;
    if (!room) throw new Error('Screen sharing needs a room-based call.');

    if (!sharing) {
      await room.stopScreenShare();
      this.#update({ screenSharing: false });
      this.#emit({ type: 'call:screen-ended', userId: this.#userId! });
      return;
    }

    await room.startScreenShare(() => {
      /*
       * The browser's own "Stop sharing" bar ends the track without coming
       * through here. Without this the button would still say "sharing" over a
       * track that had stopped.
       */
      this.#update({ screenSharing: false });
      this.#emit({ type: 'call:screen-ended', userId: this.#userId! });
    });

    this.#update({ screenSharing: true });

    // The sharer sees their own screen too, so they can tell what is going out.
    const own = room.localScreen();
    if (own) {
      this.#emit({ type: 'call:screen-stream', stream: own, userId: this.#userId! });
    }
  }

  async switchCamera(callId: string): Promise<'user' | 'environment'> {
    if (this.#call?.id !== callId || this.#call.kind !== 'video') return this.#facing;

    const wanted = this.#facing === 'user' ? 'environment' : 'user';
    const previous = this.#facing;
    this.#facing = wanted;

    let replacement: MediaStream;
    try {
      replacement = await navigator.mediaDevices.getUserMedia({
        video: this.#videoConstraints(),
        audio: false,
      });
    } catch {
      // One camera, or the other one is busy. Staying put beats ending the call.
      this.#facing = previous;
      return previous;
    }

    const [track] = replacement.getVideoTracks();
    if (!track) {
      this.#facing = previous;
      return previous;
    }

    // Carry the on/off state across, or switching cameras would silently
    // un-mute a camera the user had deliberately turned off.
    track.enabled = !this.#call.cameraOff;

    /*
     * One republish, or one `replaceTrack` per leg.
     *
     * The room is the easy case: everybody subscribes to the same publication,
     * so swapping it once reaches the whole call. The mesh below is the reason
     * this used to be a loop - one sender per person, and a swap that reached
     * only the first would leave the rest watching the old lens.
     */
    if (this.#room) {
      await this.#room.replaceVideo(track);
    } else {
      await Promise.all(
        [...this.#peers.values()].map((link) => link.videoSender?.replaceTrack(track)),
      );
    }

    for (const old of this.#localStream?.getVideoTracks() ?? []) {
      this.#localStream?.removeTrack(old);
      old.stop();
    }
    this.#localStream?.addTrack(track);
    this.#rawTracks = [...this.#rawTracks.filter((t) => t.kind !== 'video'), track];

    // The self-preview is bound to the stream object, but re-emitting tells the
    // UI to re-attach - some browsers freeze the last frame otherwise.
    if (this.#localStream) {
      this.#emit({ type: 'call:local-stream', stream: this.#localStream });
    }

    return wanted;
  }

  // -- lifecycle -----------------------------------------------------------

  #armRingTimeout(): void {
    this.#clearRingTimeout();
    this.#ringTimer = setTimeout(() => this.#teardown('unanswered'), RING_TIMEOUT_MS);
  }

  #clearRingTimeout(): void {
    if (this.#ringTimer) clearTimeout(this.#ringTimer);
    this.#ringTimer = undefined;
  }

  #teardown(reason: CallEndReason): void {
    this.#clearRingTimeout();
    this.#closeOutbound();

    /*
     * Leave the room before the tracks are stopped.
     *
     * Cleared first so the room's own `Disconnected` event - which this
     * disconnect causes - finds no room and does not tear the call down a
     * second time. Not awaited: the call is over on this screen either way, and
     * LiveKit closes the transport regardless.
     */
    const room = this.#room;
    this.#room = undefined;
    void room?.leave().catch(() => undefined);

    /*
     * Both sets, and `#rawTracks` is the one that matters.
     *
     * With RNNoise on, `#localStream` holds the worklet's output - stopping only
     * those leaves the real microphone and camera running, and the browser keeps
     * showing the recording indicator after the call has ended.
     */
    for (const track of this.#localStream?.getTracks() ?? []) track.stop();
    for (const track of this.#rawTracks) track.stop();
    this.#localStream = undefined;
    this.#rawTracks = [];

    this.#cleanupAudio?.();
    this.#cleanupAudio = undefined;

    // Every leg, and the map emptied - a mesh that keeps one connection open
    // after the call ends keeps a microphone flowing down it.
    for (const [userId, link] of this.#peers) {
      link.connection.close();
      this.#emit({ type: 'call:remote-stream-ended', userId });
    }
    this.#peers.clear();
    this.#quality.clear();

    this.#facing = 'user';
    this.#hdAudio = true;
    this.#iceServers = [];
    this.#earlyCandidates.clear();
    this.#pendingOffer = undefined;

    if (this.#call) {
      const ended: Call = { ...this.#call, state: 'ended', endReason: reason };
      this.#call = undefined;
      this.#emit({ type: 'call:ended', call: ended });
    }
  }
}

/**
 * A ceiling on outgoing video, so it cannot take the whole link.
 *
 * Left uncapped, WebRTC's bandwidth estimator ramps video up until something
 * gives - and on a phone what gives is the link both streams are sharing. Audio
 * is marked higher priority and still loses, because the loss is happening in
 * the network rather than in the scheduler: by the time the estimator has
 * noticed and backed off, a second of speech is already gone. That is the
 * "video call mein aawaz aur kharab" case, and it is not an audio bug.
 *
 * 1.2 Mb/s is a comfortable 720p call and well above what 480p needs, so this
 * is a ceiling rather than a target - the estimator still moves freely below
 * it, which is where the actual adaptation happens.
 */
const MAX_VIDEO_BITRATE = 1_200_000;

function capVideoSender(sender: RTCRtpSender): void {
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    for (const encoding of params.encodings) {
      encoding.maxBitrate = MAX_VIDEO_BITRATE;
    }
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Leave browser defaults - an uncapped call beats no call.
  }
}
