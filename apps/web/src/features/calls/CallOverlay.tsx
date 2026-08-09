import { formatDuration, useChat, type CallParticipant } from '@pingo/core';
import {
  Avatar,
  CameraFlipIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  SpeakerIcon,
  VideoIcon,
  VideoOffIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n/useT.js';
import { useCall } from './CallProvider.js';

/**
 * The call surface: incoming sheet, in-call screen, voice and video.
 *
 * One component for all of it, because they are one thing at different moments  - 
 * the same avatar, the same name, the same status line, and what changes is the
 * action row and whether video sits behind it. Splitting them would mean the
 * avatar jumping the instant a call connects.
 *
 * ## Why it covers everything
 *
 * A call is modal in the real sense: while it is happening it is the only thing
 * the user is doing. So this sits above the app at `z-1000` rather than being
 * routed to, which also means answering a call does not lose the user's place in
 * whatever screen they were on.
 *
 * ## Video is a layer, not a different screen
 *
 * On a video call the remote picture fills the background and the avatar block
 * fades out once frames arrive. Until then - dialling, ringing, camera still
 * opening - it is exactly the voice layout, so there is never an empty black
 * rectangle where a person should be.
 */
export function CallOverlay() {
  const {
    call,
    answer,
    decline,
    hangUp,
    toggleMute,
    toggleCamera,
    switchCamera,
    localStream,
    remoteStreams,
    error,
    dismissError,
    failureNotice,
    speaker,
  } = useCall();
  const { users } = useChat();
  const t = useT();

  /*
   * A call that never started still has something to say. "No microphone found"
   * arrives *after* the service has torn the call down, so without this the
   * screen closes and the reason goes with it.
   */
  /*
   * A call that did not connect keeps the screen for a moment after it ends,
   * saying why - the same beat a real call gives you before the line drops.
   * Not dismissable: it clears itself when the announcement finishes.
   */
  if (!call && failureNotice) return <CallError message={failureNotice} />;

  if (!call) return error ? <CallError message={error} onDismiss={dismissError} /> : null;

  // The service only knows the peer's id. The name comes from the chat roster,
  // which is where names live for everyone the user has ever spoken to.
  const known = users.find((user) => user.id === call.peer.userId);
  const name = known?.name ?? call.peer.name;
  const incoming = call.direction === 'incoming' && call.state === 'ringing';
  const video = call.kind === 'video';

  /*
   * A group call shows a roster instead of one big face.
   *
   * Branching on `participants` rather than on the conversation's kind keeps
   * this honest: it is the *call* that is a group call, and a call placed to
   * one person from inside a group is still a direct call.
   */
  const roster = call.participants;

  /*
   * "Are we actually showing a picture?" - not "is this a video call?".
   *
   * A video call spends its first seconds with no remote track at all, and the
   * peer may have their camera off for the whole call. Both of those must keep
   * the avatar layout rather than showing a black rectangle. A group never
   * takes the full-bleed path at all - one person cannot own the background
   * when four people are talking.
   */
  const primaryRemote = [...remoteStreams.values()][0];
  const showingRemote =
    video && !roster && Boolean(primaryRemote?.getVideoTracks().length);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        incoming
          ? video
            ? t('call.incomingVideo', { name })
            : t('call.incomingVoice', { name })
          : t('call.with', { name })
      }
      className={cn(
        'fixed inset-0 z-1000 flex flex-col items-center justify-between',
        /*
          `bg-page` first, and it is not redundant. `brand-wash` is a translucent
          tint - on its own the chat list shows straight through a ringing call,
          which reads as a broken overlay rather than a screen.
        */
        'bg-page px-6 pt-24 pb-24',
        'animate-fade-in',
      )}
    >
      {showingRemote ? (
        <RemoteVideo stream={primaryRemote} />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-brand-wash" aria-hidden />
      )}

      {/*
        Hidden rather than unmounted once video takes over, so the name and timer
        stay in the accessibility tree and the layout does not reflow.
      */}
      <div
        className={cn(
          'relative flex flex-col items-center gap-5',
          'transition-opacity duration-base ease-standard',
          showingRemote && 'pointer-events-none opacity-0',
        )}
      >
        {roster ? (
          <CallRoster participants={roster} streams={remoteStreams} video={video} />
        ) : (
          <Avatar name={name} id={call.peer.userId} src={known?.avatarUrl} size="2xl" />
        )}

        <div className="text-center">
          <h1 className="text-h1 text-ink">{name}</h1>
          <p className="mt-1 text-body text-text-secondary" aria-live="polite">
            <StatusLine
              state={call.state}
              direction={call.direction}
              connectedAt={call.connectedAt}
            />
          </p>
          {error ? <p className="mt-2 text-caption text-brand">{error}</p> : null}
        </div>
      </div>

      {/* Once video fills the screen the name needs to come back, legibly. */}
      {showingRemote ? (
        <div className="pointer-events-none absolute inset-x-0 top-10 text-center">
          <p className="text-h2 text-white drop-shadow-lg">{name}</p>
          <p className="mt-0.5 text-caption text-white/80 drop-shadow-lg" aria-live="polite">
            <StatusLine
              state={call.state}
              direction={call.direction}
              connectedAt={call.connectedAt}
            />
          </p>
        </div>
      ) : null}

      {/* The self-preview, from the moment the camera opens. */}
      {video && localStream && !incoming ? (
        <LocalPreview stream={localStream} cameraOff={call.cameraOff} />
      ) : null}

      {incoming ? (
        <div className="relative flex w-full max-w-xs items-center justify-between">
          <CallAction label={t('call.decline')} tone="end" onClick={() => void decline()}>
            {/*
              A handset rotated 135° - the universal hang-up glyph, and the same
              icon as the answer button so the pair reads as one gesture.
            */}
            <PhoneIcon size={26} className="rotate-[135deg]" />
          </CallAction>

          <CallAction
            label={video ? t('call.answerVideo') : t('call.answer')}
            tone="answer"
            onClick={() => void answer()}
          >
            {video ? <VideoIcon size={26} /> : <PhoneIcon size={26} />}
          </CallAction>
        </div>
      ) : (
        <div className="relative flex items-center gap-4">
          <CallAction
            label={call.muted ? t('call.unmuteMic') : t('call.muteMic')}
            tone="neutral"
            pressed={call.muted}
            onClick={toggleMute}
          >
            {call.muted ? <MicOffIcon size={24} /> : <MicIcon size={24} />}
          </CallAction>

          {video ? (
            <CallAction
              label={call.cameraOff ? t('call.cameraOn') : t('call.cameraOff')}
              tone="neutral"
              pressed={call.cameraOff}
              onClick={toggleCamera}
            >
              {call.cameraOff ? <VideoOffIcon size={24} /> : <VideoIcon size={24} />}
            </CallAction>
          ) : null}

          {/*
            Offered from the moment a call starts rather than from when it
            connects. Reaching for the speaker before the other person picks up
            is the normal way round, and the choice is applied as soon as there
            is sound to apply it to.
          */}
          {speaker && (
            <CallAction
              label={speaker.on ? t('call.speakerOff') : t('call.speakerOn')}
              tone="neutral"
              pressed={speaker.on}
              onClick={speaker.toggle}
            >
              <SpeakerIcon size={24} />
            </CallAction>
          )}

          {video ? (
            <CallAction
              label={t('call.switchCamera')}
              tone="neutral"
              onClick={() => void switchCamera()}
            >
              <CameraFlipIcon size={24} />
            </CallAction>
          ) : null}

          <CallAction label={t('call.end')} tone="end" onClick={() => void hangUp()}>
            <PhoneIcon size={26} className="rotate-[135deg]" />
          </CallAction>
        </div>
      )}
    </div>
  );
}

/**
 * Binds a stream to a video element.
 *
 * `srcObject` is a property, not an attribute, so React cannot set it from JSX  - 
 * it has to be assigned through a ref. Re-run on every stream identity change,
 * which is also what makes `switchCamera`'s re-emit take effect.
 */
function useStream(stream: MediaStream | undefined) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    void element.play().catch(() => {
      // Autoplay refusals are the browser's business; the element is muted, so
      // this only ever means a frame arrives a beat later.
    });
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return ref;
}

/** The peer, full-bleed. Muted - their audio plays on the provider's `<audio>`. */
/**
 * Everyone on a group call, as a grid.
 *
 * ## Everybody is here from the first ring
 *
 * Including the people who have not picked up, dimmed and labelled. A grid that
 * filled in as people answered would give no sense of how big the room is or
 * who is still missing, and the tiles would jump under your eyes as each person
 * arrived - the two things you most want to be still while you wait.
 *
 * ## Faces, not video, past two people
 *
 * A four-way video mesh already asks a phone to encode one stream and decode
 * three. Laying them out as live rectangles invites six- and eight-person calls
 * that the format cannot carry. Video plays for a pair; beyond that the grid
 * shows who is here and lets the voices do the work - which is what these calls
 * are for anyway.
 */
function CallRoster({
  participants,
  streams,
  video,
}: {
  participants: CallParticipant[];
  streams: Map<string, MediaStream>;
  video: boolean;
}) {
  const { users } = useChat();

  // Two people is still a conversation with a face in it; past that it is a
  // room, and a room is a list of who is in it.
  const showVideo = video && participants.length === 1;

  return (
    <ul
      className={cn(
        'grid gap-4',
        participants.length <= 1
          ? 'grid-cols-1'
          : participants.length <= 4
            ? 'grid-cols-2'
            : 'grid-cols-3',
      )}
    >
      {participants.map((participant) => {
        const person = users.find((user) => user.id === participant.userId);
        const stream = streams.get(participant.userId);
        const live = showVideo && Boolean(stream?.getVideoTracks().length);

        return (
          <li
            key={participant.userId}
            className="flex flex-col items-center gap-1.5"
            /*
             * The state is on the row, not only in the colour. "Ringing" and
             * "connected" differ by opacity alone otherwise, which is nothing
             * at all to a screen reader and very little in bright sun.
             */
            aria-label={`${person?.name ?? 'Someone'}, ${participant.state}`}
          >
            <span
              className={cn(
                'transition-opacity duration-base ease-standard',
                participant.state === 'connected' ? 'opacity-100' : 'opacity-45',
              )}
            >
              {live ? (
                <RemoteVideo stream={stream} inline />
              ) : (
                <Avatar
                  name={person?.name ?? 'Someone'}
                  id={participant.userId}
                  src={person?.avatarUrl}
                  size={participants.length <= 2 ? 'xl' : 'lg'}
                />
              )}
            </span>

            <span className="max-w-24 truncate text-caption text-text-secondary">
              {person?.name ?? 'Someone'}
            </span>

            {/*
              Said in words for the two states that are not "here and talking".
              Everyone connected gets nothing, because a label under every face
              saying "connected" is noise once the call is under way.
            */}
            {participant.state !== 'connected' && (
              <span className="text-caption text-text-tertiary">
                {participant.state === 'left' ? 'Left' : 'Ringing…'}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RemoteVideo({
  stream,
  inline = false,
}: {
  stream: MediaStream | undefined;
  /** Sized to a roster tile instead of filling the screen. */
  inline?: boolean;
}) {
  const ref = useStream(stream);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      /*
        `cover`, not `contain`. A portrait phone camera inside a landscape window
        letterboxes into thick black bars with `contain`; cropping to fill is what
        every video app does and what people expect to see.
      */
      className={cn(
        'object-cover',
        inline
          ? 'size-20 rounded-full bg-surface-sunken'
          : 'absolute inset-0 size-full',
      )}
    />
  );
}

/** The self-preview: small, corner-pinned, and always muted. */
function LocalPreview({ stream, cameraOff }: { stream: MediaStream; cameraOff: boolean }) {
  const ref = useStream(stream);

  return (
    <div
      className={cn(
        'absolute top-6 right-6 z-10 overflow-hidden rounded-lg',
        'h-40 w-28 border border-white/15 bg-black shadow-lg',
        'transition-opacity duration-base ease-standard',
        cameraOff && 'opacity-0',
      )}
      aria-hidden
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        /*
          Mirrored, like every selfie preview and every video app. Only the
          preview - what the peer receives is never flipped.
        */
        className="size-full -scale-x-100 object-cover"
      />
    </div>
  );
}

/** A toast for a call that could not begin. Dismissible, and never blocking. */
function CallError({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="status"
      className={cn(
        'fixed inset-x-0 top-4 z-1000 mx-auto w-fit max-w-[90vw]',
        'glass-surface flex items-center gap-3 rounded-full px-4 py-2.5 shadow-md',
        'animate-fade-in',
      )}
    >
      <span className="text-caption text-ink">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="focus-ring rounded-full px-2 py-0.5 text-caption font-medium text-brand"
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * The one line under the name.
 *
 * Once connected it becomes a running timer, which is the only part of this
 * screen that needs to re-render every second - so the interval lives here and
 * not in the provider, where it would re-render the whole app.
 */
function StatusLine({
  state,
  direction,
  connectedAt,
}: {
  state: string;
  direction: 'incoming' | 'outgoing';
  connectedAt?: number;
}) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!connectedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [connectedAt]);

  if (state === 'connected' && connectedAt) {
    return <>{formatDuration(Math.floor((now - connectedAt) / 1000))}</>;
  }

  switch (state) {
    case 'dialling':
      return <>{t('call.calling')}</>;
    case 'ringing':
      return <>{direction === 'incoming' ? t('call.incomingShort') : t('call.ringing')}</>;
    case 'connecting':
      return <>{t('call.connecting')}</>;
    case 'reconnecting':
      return <>{t('call.reconnecting')}</>;
    default:
      return <>{t('call.ended')}</>;
  }
}

/** A large round call button. Big enough to hit without looking. */
function CallAction({
  label,
  tone,
  pressed,
  onClick,
  children,
}: {
  label: string;
  tone: 'answer' | 'end' | 'neutral';
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={tone === 'neutral' ? pressed : undefined}
      onClick={onClick}
      className={cn(
        'focus-ring grid size-16 place-items-center rounded-full',
        'transition-transform duration-instant ease-standard active:scale-95',
        tone === 'answer' && 'bg-online text-white shadow-md',
        tone === 'end' && 'bg-danger text-white shadow-md',
        tone === 'neutral' &&
          (pressed ? 'bg-ink text-surface' : 'bg-surface text-ink shadow-sm'),
      )}
    >
      {children}
    </button>
  );
}
