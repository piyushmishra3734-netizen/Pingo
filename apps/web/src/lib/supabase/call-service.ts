import type {
  Call,
  CallEndReason,
  CallEvent,
  CallKind,
  CallService,
  CallServiceOptions,
  CallState,
} from '@pingo/core';

import { resolveIceServers } from '../webrtc/ice-servers.js';

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
 * here — TURN credentials expire, so they cannot be a constant. See that module
 * for why the secret is never in this bundle.
 */

/** How long an unanswered call rings before it gives up. */
const RING_TIMEOUT_MS = 45_000;

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
  | { kind: 'hangup'; callId: string; from: string; reason: CallEndReason };

export class SupabaseCallService implements CallService {
  readonly #client: PingoSupabaseClient;

  #listeners = new Set<(event: CallEvent) => void>();
  #channel: ReturnType<PingoSupabaseClient['channel']> | undefined;
  #userId: string | undefined;

  #call: Call | undefined;
  #peerConnection: RTCPeerConnection | undefined;
  #localStream: MediaStream | undefined;
  #cleanupAudio: (() => void) | undefined;
  #ringTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Candidates that arrived before the remote description was set.
   *
   * ICE routinely races SDP — `addIceCandidate` throws if there is no remote
   * description yet, and dropping those candidates is a call that connects
   * slowly or not at all.
   */
  #pendingCandidates: RTCIceCandidateInit[] = [];

  /**
   * The sender carrying the camera, kept so the track can be swapped later.
   *
   * `replaceTrack` on an existing sender changes what is being transmitted
   * without touching the SDP — which is what makes switching cameras instant
   * and free. Adding or removing a track instead would force renegotiation
   * mid-call and glitch the video for both sides.
   */
  #videoSender: RTCRtpSender | undefined;
  #facing: 'user' | 'environment' = 'user';

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

  // -- signalling ----------------------------------------------------------

  /**
   * Opens the signalling channel. Safe to call repeatedly and concurrently.
   *
   * Both properties matter. React's StrictMode mounts every effect twice in
   * development, so `connect()` is called, torn down, and called again while the
   * first call's `await` is still in flight — without the in-flight guard that
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
           * which every visitor does — so on a public `call:{userId}` topic a
           * stranger could watch your call setup and inject offers. Private
           * topics are gated by RLS on `realtime.messages`, and the policies in
           * `20260726140000_call_signalling.sql` say: you may only *read* your
           * own topic, and you must be signed in to write to anyone's.
           */
          private: true,
          broadcast: {
            /*
             * Not decorative. `self: false` — the default — silently drops
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
   * joined — `httpSend` posts to Realtime's REST endpoint and returns. It is
   * cached rather than created per signal because `client.channel()` registers
   * every object it makes, and a call sends a dozen ICE candidates.
   */
  #outbound: { topic: string; channel: ReturnType<PingoSupabaseClient['channel']> } | undefined;

  async #send(toUserId: string, payload: SignalPayload): Promise<void> {
    const topic = `call:${toUserId}`;

    if (this.#outbound?.topic !== topic) {
      this.#closeOutbound();
      this.#outbound = {
        topic,
        channel: this.#client.channel(topic, { config: { private: true } }),
      };
    }

    /*
     * `httpSend`, not `send`.
     *
     * `send()` on an unjoined channel does reach the same REST endpoint, but
     * only via a deprecated fallback that logs a warning on every signal. This
     * is the explicit form, and it resolves on HTTP 202.
     */
    await this.#outbound.channel.httpSend('signal', payload);
  }

  #closeOutbound(): void {
    /*
     * Removed by topic, and the topic is always the *peer's* — never this
     * user's own. That matters: `removeChannel` leaves the topic on the shared
     * socket, so removing a same-topic twin would silently unsubscribe the
     * listening channel and leave the user unreachable. (Observed exactly that
     * while testing a call to oneself.)
     */
    if (this.#outbound) void this.#client.removeChannel(this.#outbound.channel);
    this.#outbound = undefined;
  }

  async #onSignal(signal: SignalPayload): Promise<void> {
    switch (signal.kind) {
      case 'offer': {
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

        // Held until the user answers — the offer is useless before then.
        this.#pendingOffer = signal.sdp;
        this.#emit({ type: 'call:incoming', call: this.#call });
        this.#armRingTimeout();
        break;
      }

      case 'answer': {
        if (!this.#peerConnection || this.#call?.id !== signal.callId) return;
        await this.#peerConnection.setRemoteDescription({
          type: 'answer',
          sdp: signal.sdp,
        });
        await this.#drainCandidates();
        this.#update({ state: 'connecting' });
        break;
      }

      case 'ice': {
        if (this.#call?.id !== signal.callId) return;
        if (this.#peerConnection?.remoteDescription) {
          await this.#peerConnection.addIceCandidate(signal.candidate).catch(() => {
            // A candidate that cannot be added is not fatal; ICE tries others.
          });
        } else {
          this.#pendingCandidates.push(signal.candidate);
        }
        break;
      }

      case 'decline':
        if (this.#call?.id === signal.callId) this.#teardown('declined');
        break;

      case 'hangup':
        if (this.#call?.id === signal.callId) this.#teardown(signal.reason);
        break;
    }
  }

  #pendingOffer: string | undefined;

  async #drainCandidates(): Promise<void> {
    const queued = this.#pendingCandidates;
    this.#pendingCandidates = [];
    for (const candidate of queued) {
      await this.#peerConnection?.addIceCandidate(candidate).catch(() => {});
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
     * The browser's own DSP, requested explicitly.
     *
     * These three constraints are what "echo cancellation, noise suppression"
     * means on the web — WebRTC ships them, and they are free and always on the
     * fast path. RNNoise below is an *addition* to this, never a replacement.
     */
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: kind === 'video' ? this.#videoConstraints(options) : false,
    });

    /*
     * Held separately from the stream that gets sent.
     *
     * With RNNoise on, the transmitted stream is the worklet's *output* — a
     * different object whose tracks are not the microphone. Stopping only that
     * one leaves the real microphone open and the browser's recording indicator
     * lit after the call ends.
     */
    this.#rawTracks = raw.getTracks();

    if (!options?.noiseSuppression) return raw;

    try {
      const { applyRNNoise } = await import('../../features/calls/audio/rnnoise.js');
      const { stream, cleanup } = await applyRNNoise(raw);
      this.#cleanupAudio = cleanup;

      // RNNoise returns audio only, so the camera track is carried across by
      // hand — otherwise turning on noise suppression would silently drop video.
      return new MediaStream([...stream.getAudioTracks(), ...raw.getVideoTracks()]);
    } catch {
      // RNNoise failing must not fail the call — the browser's suppression is
      // still running, and a slightly noisier call beats no call.
      return raw;
    }
  }

  #rawTracks: MediaStreamTrack[] = [];

  /**
   * Adds the captured tracks to the connection and publishes the self-preview.
   *
   * Shared by both legs — caller and callee do exactly the same thing here, and
   * when they drifted apart earlier it was the callee that quietly lost video.
   */
  #attachLocalTracks(connection: RTCPeerConnection): void {
    const stream = this.#localStream;
    if (!stream) return;

    for (const track of stream.getTracks()) {
      const sender = connection.addTrack(track, stream);
      if (track.kind === 'video') this.#videoSender = sender;
    }

    if (stream.getVideoTracks().length > 0) {
      this.#emit({ type: 'call:local-stream', stream });
    }
  }

  #createPeerConnection(
    peerUserId: string,
    callId: string,
    iceServers: RTCIceServer[],
  ): RTCPeerConnection {
    const connection = new RTCPeerConnection({ iceServers });

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
      if (stream) this.#emit({ type: 'call:remote-stream', stream });
    };

    connection.onconnectionstatechange = () => {
      const map: Partial<Record<RTCPeerConnectionState, CallState>> = {
        connected: 'connected',
        disconnected: 'reconnecting',
        connecting: 'connecting',
      };

      const next = map[connection.connectionState];
      if (next) {
        this.#update({
          state: next,
          // The timer starts at the first connect, not at each reconnect.
          ...(next === 'connected' && !this.#call?.connectedAt
            ? { connectedAt: Date.now() }
            : {}),
        });
        if (next === 'connected') this.#clearRingTimeout();
      }

      if (connection.connectionState === 'failed') this.#teardown('failed');
    };

    return connection;
  }

  // -- public actions ------------------------------------------------------

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
     * The emit has to come first — it is what puts "Calling…" on screen while
     * the microphone opens — but that means a refused or missing microphone
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
      const connection = this.#createPeerConnection(peerUserId, callId, iceServers);
      this.#peerConnection = connection;

      this.#attachLocalTracks(connection);

      // Honours `cameraOff` before the first frame is ever sent, so starting
      // camera-off never leaks a moment of video.
      if (this.#call.cameraOff) this.#applyCameraOff(true);

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      await this.#send(peerUserId, {
        kind: 'offer',
        callId,
        from: this.#userId!,
        sdp: offer.sdp ?? '',
        media: kind,
      });
    } catch (cause) {
      this.#teardown('failed');
      throw cause;
    }

    this.#armRingTimeout();
    return this.#call;
  }

  async answer(callId: string, options?: CallServiceOptions): Promise<void> {
    if (!this.#call || this.#call.id !== callId || !this.#pendingOffer) return;

    this.#clearRingTimeout();
    // `options.kind` is ignored here on purpose: the offer decides. See the
    // note on `CallServiceOptions.kind`.
    const kind = this.#call.kind;
    this.#update({ state: 'connecting', cameraOff: kind === 'voice' });

    /*
     * Torn down on failure, exactly as in `call()`.
     *
     * Without this a refused or missing camera leaves the call stuck on
     * "Connecting…" forever — the state was already advanced, no media ever
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
      const connection = this.#createPeerConnection(peerUserId, callId, iceServers);
      this.#peerConnection = connection;

      this.#attachLocalTracks(connection);

      await connection.setRemoteDescription({ type: 'offer', sdp: this.#pendingOffer });
      await this.#drainCandidates();

      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);

      await this.#send(peerUserId, {
        kind: 'answer',
        callId,
        from: this.#userId!,
        sdp: answer.sdp ?? '',
      });
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

  async decline(callId: string): Promise<void> {
    if (this.#call?.id !== callId) return;
    await this.#send(this.#call.peer.userId, {
      kind: 'decline',
      callId,
      from: this.#userId!,
    });
    this.#teardown('declined');
  }

  async hangUp(callId: string): Promise<void> {
    if (this.#call?.id !== callId) return;
    const wasConnected = Boolean(this.#call.connectedAt);
    await this.#send(this.#call.peer.userId, {
      kind: 'hangup',
      callId,
      from: this.#userId!,
      reason: wasConnected ? 'hung-up' : 'cancelled',
    });
    this.#teardown(wasConnected ? 'hung-up' : 'cancelled');
  }

  setMuted(callId: string, muted: boolean): void {
    if (this.#call?.id !== callId) return;
    // Disabling the track keeps the connection up and stops sending audio,
    // which is what mute means — stopping the track would end the call's media.
    for (const track of this.#localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
    this.#update({ muted });
  }

  setCameraOff(callId: string, cameraOff: boolean): void {
    if (this.#call?.id !== callId || this.#call.kind !== 'video') return;
    this.#applyCameraOff(cameraOff);
    this.#update({ cameraOff });
  }

  /**
   * Disables the camera track rather than stopping it.
   *
   * A stopped track cannot be restarted — turning the camera back on would mean
   * a fresh `getUserMedia` and a renegotiation. Disabling transmits black
   * frames at almost no bitrate and flips back instantly, which is what every
   * other client does too.
   */
  #applyCameraOff(cameraOff: boolean): void {
    for (const track of this.#localStream?.getVideoTracks() ?? []) {
      track.enabled = !cameraOff;
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

    await this.#videoSender?.replaceTrack(track);

    for (const old of this.#localStream?.getVideoTracks() ?? []) {
      this.#localStream?.removeTrack(old);
      old.stop();
    }
    this.#localStream?.addTrack(track);
    this.#rawTracks = [...this.#rawTracks.filter((t) => t.kind !== 'video'), track];

    // The self-preview is bound to the stream object, but re-emitting tells the
    // UI to re-attach — some browsers freeze the last frame otherwise.
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
     * Both sets, and `#rawTracks` is the one that matters.
     *
     * With RNNoise on, `#localStream` holds the worklet's output — stopping only
     * those leaves the real microphone and camera running, and the browser keeps
     * showing the recording indicator after the call has ended.
     */
    for (const track of this.#localStream?.getTracks() ?? []) track.stop();
    for (const track of this.#rawTracks) track.stop();
    this.#localStream = undefined;
    this.#rawTracks = [];

    this.#cleanupAudio?.();
    this.#cleanupAudio = undefined;

    this.#peerConnection?.close();
    this.#peerConnection = undefined;
    this.#videoSender = undefined;
    this.#facing = 'user';

    this.#pendingCandidates = [];
    this.#pendingOffer = undefined;

    if (this.#call) {
      const ended: Call = { ...this.#call, state: 'ended', endReason: reason };
      this.#call = undefined;
      this.#emit({ type: 'call:ended', call: ended });
    }
  }
}
