import { formatDuration, useAuth, useChat, type CallParticipant } from '@pingo/core';
import {
  Avatar,
  CameraFlipIcon,
  ChatIcon,
  FullscreenIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  SpeakerIcon,
  VideoIcon,
  VideoOffIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '../i18n/useT.js';
import { CallChatPanel, useCallChatUnread, useChatWindow } from './CallChat.js';
import { useCall } from './CallProvider.js';
import { screenCaptureAvailable } from './screen-capture-support.js';
import { canOfferScreenShare, personBehind, primaryShare } from './screen-share-rules.js';

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
    screenStreams,
    toggleScreenShare,
    screenError,
    chat,
    sendChat,
    error,
    dismissError,
    failureNotice,
    speaker,
    weakConnection,
  } = useCall();
  const { users } = useChat();
  const { session } = useAuth();
  const t = useT();

  const [chatOpen, setChatOpen] = useState(false);
  const selfId = session?.user.id;
  const unread = useCallChatUnread(chat, chatOpen, selfId);

  /*
   * A floating window, but only while this device is the one sharing.
   *
   * The sharer is the person who cannot see PINGO - they are looking at
   * whatever they are presenting. Everybody else already has the panel in
   * front of them and does not need a second window on top of their desktop.
   */
  const chatWindow = useChatWindow(chatOpen && Boolean(call?.screenSharing));
  const wide = useWideWindow();

  // A call that ends with the panel open must not reopen it on the next one.
  useEffect(() => {
    if (!call) setChatOpen(false);
  }, [call]);

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
   * Somebody is actually on the other end.
   *
   * The controls that need a second person - screen sharing, chat - wait for
   * this. Before it there is only your own equipment to set up, and three
   * switches is the whole of what a ringing phone should be asking you to
   * think about.
   */
  const connected = call.state === 'connected' || call.state === 'reconnecting';

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

  /*
   * A shared screen is the main content, whoever it belongs to.
   *
   * It outranks every camera including this device's own: somebody sharing is
   * showing the room something, and the faces become context around it. Only
   * the first is promoted - two people sharing at once is rare enough that
   * picking one and leaving the other as a tile beats a split view nobody could
   * read on a phone.
   */
  const share = primaryShare(screenStreams);
  const sharerId = share?.userId;
  const sharedScreen = share?.stream;

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
      {sharedScreen ? (
        <SharedScreen
          stream={sharedScreen}
          mine={Boolean(call.screenSharing)}
          /*
            The sharer, not the connection sharing. On Android the screen
            arrives from `<user>#screen` - a separate LiveKit participant,
            because a phone captures its screen natively and joins twice.
            Nobody wants to read "piyush#screen is presenting".
          */
          who={users.find((u) => u.id === personBehind(sharerId ?? ''))?.name ?? name}
          /*
            Everybody whose face the strip can show. A group call names them
            from the roster; a direct call has exactly one other person and
            `peer` already is them.
          */
          faces={(roster ?? [{ userId: call.peer.userId, state: 'connected' as const }]).map(
            (participant) => {
              const person = users.find((user) => user.id === participant.userId);
              return {
                userId: participant.userId,
                name: person?.name ?? t('call.someone'),
                avatarUrl: person?.avatarUrl,
                stream: remoteStreams.get(participant.userId),
              };
            },
          )}
        />
      ) : showingRemote ? (
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
          {weakConnection ? <WeakLine /> : null}
          {error ? <p className="mt-2 text-caption text-brand">{error}</p> : null}

          {/*
            A refused capture prompt is not a broken call.

            Somebody who opens the picker and changes their mind produces the
            same error as a real failure, and neither is a reason to hang up.
            The line says what happened and offers the button again; the call
            carries on underneath it either way.
          */}
          {screenError && toggleScreenShare ? (
            <p className="mt-2 flex items-center justify-center gap-2 text-caption text-brand">
              {t('call.shareFailed')}
              <button
                type="button"
                onClick={() => void toggleScreenShare()}
                className="focus-ring rounded-full px-2 py-0.5 font-medium underline"
              >
                {t('call.tryAgain')}
              </button>
            </p>
          ) : null}
        </div>
      </div>

      {/*
        Scrims, top and bottom, whenever something is playing behind the chrome.

        The name and the control bar were relying on a drop shadow to stay
        legible over whatever the camera happened to be pointing at, and a drop
        shadow does nothing against a bright wall. Two short gradients fading to
        nothing give both ends a floor to sit on without dimming the picture in
        the middle, which is where the person actually is.

        A shared screen does not get them: that stage is already dark, its own
        labels carry their own backgrounds, and a bottom scrim would fall
        straight across the strip of faces.
      */}
      {showingRemote ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/55 to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/60 to-transparent"
          />
        </>
      ) : null}

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
          {weakConnection ? <WeakLine onVideo /> : null}
        </div>
      ) : null}

      {/* The self-preview, from the moment the camera opens. */}
      {video && localStream && !incoming ? (
        <LocalPreview
          stream={localStream}
          cameraOff={call.cameraOff}
          onFlip={() => void switchCamera()}
          flipLabel={t('call.switchCamera')}
        />
      ) : null}

      {incoming ? (
        <div className="relative flex w-full max-w-xs items-center justify-between">
          <CallAction
            label={t('call.decline')}
            tone="end"
            size="lg"
            onClick={() => void decline()}
          >
            {/*
              A handset rotated 135° - the universal hang-up glyph, and the same
              icon as the answer button so the pair reads as one gesture.
            */}
            <PhoneIcon size={26} className="rotate-[135deg]" />
          </CallAction>

          <CallAction
            label={video ? t('call.answerVideo') : t('call.answer')}
            tone="answer"
            size="lg"
            onClick={() => void answer()}
          >
            {video ? <VideoIcon size={26} /> : <PhoneIcon size={26} />}
          </CallAction>
        </div>
      ) : (
        /*
          Two rows: what you can switch, then the one thing you cannot undo.

          No container around the switches. They were in a glass bar, and a
          translucent slab sitting over a moving picture is the one place that
          material does not work - it takes its colour from whatever is behind
          it, so the bar changed shade every time the other person moved. Solid
          circles read the same against a face, a shared spreadsheet and the
          plain page behind a voice call.

          Five switches at most, which fits one row on a narrow phone. Ending
          the call gets its own row and its own size, because giving the hang-up
          button exactly as much weight as "flip camera" is how people press it
          by accident.
        */
        <div className="relative flex flex-col items-center gap-4">
          <div className="flex items-center justify-center gap-2.5">
            <CallAction
              label={call.muted ? t('call.unmuteMic') : t('call.muteMic')}
              tone="neutral"
              pressed={call.muted}
              onClick={toggleMute}
            >
              {call.muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
            </CallAction>

            {video ? (
              <CallAction
                label={call.cameraOff ? t('call.cameraOn') : t('call.cameraOff')}
                tone="neutral"
                pressed={call.cameraOff}
                onClick={toggleCamera}
              >
                {call.cameraOff ? <VideoOffIcon size={22} /> : <VideoIcon size={22} />}
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
                <SpeakerIcon size={22} />
              </CallAction>
            )}

          {/*
            Video calls only, and only when the call can actually carry one.
            `toggleScreenShare` is undefined on the peer-to-peer fallback, where
            there is no second video track to spare - a hidden control beats one
            that always fails.
          */}
            {/*
              Sharing and chat appear once the call is actually up.

              Until somebody picks up there is nothing to share a screen with
              and nobody to type to, and offering either while a phone is still
              ringing is four controls where three would do. Waiting for a call
              to connect is the moment to be given the fewest possible things to
              look at: your microphone, your camera, and where the sound comes
              out.
            */}
            {connected &&
            canOfferScreenShare({
              kind: call.kind,
              onRoom: Boolean(toggleScreenShare),
              incoming,
              supported: screenCaptureAvailable(),
            }) &&
            toggleScreenShare ? (
              <CallAction
                label={call.screenSharing ? t('call.stopShare') : t('call.shareScreen')}
                /*
                  Brand, not the "off" ink chip the other toggles use. Every
                  other switch here turns something of yours off; this one is
                  the only control that starts broadcasting, and it should not
                  look like the state you are in when you are muted.
                */
                tone={call.screenSharing ? 'active' : 'neutral'}
                pressed={Boolean(call.screenSharing)}
                onClick={() => void toggleScreenShare()}
              >
                {call.screenSharing ? (
                  <ScreenShareOffIcon size={22} />
                ) : (
                  <ScreenShareIcon size={22} />
                )}
              </CallAction>
            ) : null}

          {/*
            The chat, with a count of what has been said while it was shut.
            Offered on every call that can carry it, not only while a screen is
            being shared - somebody spelling out an address is the other reason
            this exists.
          */}
            {connected && sendChat ? (
              <CallAction
                label={t('call.chatTitle')}
                tone="neutral"
                pressed={chatOpen}
                badge={unread}
                onClick={() => setChatOpen((open) => !open)}
              >
                <ChatIcon size={22} />
              </CallAction>
            ) : null}

            {/*
              Flipping the camera is not here. It belongs to the little picture
              of yourself in the corner - that is the thing it changes, and a
              control that sits on what it affects needs no label and no place
              in a row that has none to spare. See `LocalPreview`.
            */}
          </div>

          <CallAction label={t('call.end')} tone="end" size="lg" onClick={() => void hangUp()}>
            <PhoneIcon size={26} className="rotate-[135deg]" />
          </CallAction>
        </div>
      )}

      {/*
        Docked beside a shared screen on a wide window, a sheet everywhere else.

        Presenting is the case that earns the dock: the screen is the content
        and the chat is a margin note beside it, so neither covers the other.
        With no share there is nothing to sit beside, and on a phone there is no
        room to sit beside anything.
      */}
      {chatOpen && sendChat && !chatWindow ? (
        <CallChatPanel
          messages={chat}
          onSend={sendChat}
          onClose={() => setChatOpen(false)}
          selfId={selfId}
          docked={Boolean(sharedScreen) && wide}
        />
      ) : null}

      {/*
        The same panel, in the floating window, when there is one. Portalled
        rather than re-implemented: one chat, rendered in a different place.
      */}
      {chatOpen && sendChat && chatWindow
        ? createPortal(
            <CallChatPanel
              messages={chat}
              onSend={sendChat}
              onClose={() => setChatOpen(false)}
              selfId={selfId}
              docked
            />,
            chatWindow as unknown as Element,
          )
        : null}
    </div>
  );
}

/**
 * Whether the window is wide enough to put two things side by side.
 *
 * A media query rather than a breakpoint class, because the answer changes
 * which component tree is built - `docked` is a prop, not a style - and a
 * class cannot decide that.
 */
function useWideWindow(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768,
  );

  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = () => setWide(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return wide;
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

/**
 * The little picture of yourself, bottom right, with its own camera switch.
 *
 * ## Where it sits
 *
 * Bottom right, above the controls, because that is where every video call
 * anybody has used puts it - and because the top of the screen belongs to the
 * other person's name. It used to be top right, over exactly that.
 *
 * ## Why the flip button lives here
 *
 * Switching between the front and rear camera changes *this* picture and
 * nothing else, so the control belongs on it. In the row below it was a sixth
 * anonymous circle competing with hang-up; here it needs no label, because it
 * is sitting on the thing it changes. It also disappears with the preview when
 * the camera is off, which is correct - there is nothing to flip.
 *
 * Kept out of the accessibility tree apart from the button: a mirrored video of
 * yourself has nothing to announce, but a control does.
 */
function LocalPreview({
  stream,
  cameraOff,
  onFlip,
  flipLabel,
}: {
  stream: MediaStream;
  cameraOff: boolean;
  onFlip: () => void;
  flipLabel: string;
}) {
  const ref = useStream(stream);

  return (
    <div
      className={cn(
        /*
          Clear of the controls, not floating over them. The block below is two
          rows - switches then hang-up - and it ends 96px up from the bottom
          edge, so this starts above all of it.
        */
        'absolute right-4 bottom-60 z-10 overflow-hidden rounded-2xl',
        'h-36 w-28 border border-white/20 bg-backdrop shadow-xl',
        'transition-opacity duration-base ease-standard',
        // Hidden rather than unmounted, so turning the camera back on does not
        // rebuild the element and lose the first second of picture.
        cameraOff && 'pointer-events-none opacity-0',
      )}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        aria-hidden
        /*
          Mirrored, like every selfie preview and every video app. Only the
          preview - what the peer receives is never flipped.
        */
        className="size-full -scale-x-100 object-cover"
      />

      <button
        type="button"
        onClick={onFlip}
        aria-label={flipLabel}
        className={cn(
          'focus-ring absolute right-1.5 bottom-1.5 grid size-8 place-items-center',
          'rounded-full bg-black/55 text-white',
          'transition-transform duration-instant active:scale-90',
        )}
      >
        <CameraFlipIcon size={16} />
      </button>
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
/**
 * "Weak connection", said once, quietly.
 *
 * A call that is breaking up is the one moment a person starts to doubt the app
 * rather than the network - they repeat themselves, hear nothing back, and hang
 * up believing PINGO dropped it. One line naming what is actually happening
 * turns that into an ordinary bad signal, which is the same thing every other
 * phone call in their life has taught them to wait out.
 *
 * Deliberately not an error: nothing has failed, nothing needs dismissing, and
 * a call still in progress must not be dressed up as a call that has broken.
 * It appears and disappears with the measurement, so it stops saying so the
 * moment the line recovers.
 */
function WeakLine({ onVideo = false }: { onVideo?: boolean }) {
  return (
    <p
      role="status"
      className={cn(
        'mt-1 flex items-center justify-center gap-1.5 text-caption',
        onVideo ? 'text-white/90 drop-shadow-lg' : 'text-warning',
      )}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-current"
      />
      Weak connection
    </p>
  );
}

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
  badge,
  size = 'md',
  onClick,
  children,
}: {
  label: string;
  /**
   * `neutral` is a switch, `active` is a switch that is broadcasting, and the
   * other two are the two ways a call begins and ends. They are separated
   * because colour here is meaning, not decoration: red appears exactly once on
   * this screen and it is the thing you cannot undo.
   */
  tone: 'answer' | 'end' | 'neutral' | 'active';
  pressed?: boolean;
  /** A count to show on the corner. Zero draws nothing. */
  badge?: number;
  /** `lg` is for the two buttons that start and end a call. */
  size?: 'md' | 'lg';
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={badge ? `${label}, ${badge} new` : label}
      aria-pressed={tone === 'neutral' || tone === 'active' ? pressed : undefined}
      onClick={onClick}
      className={cn(
        'focus-ring relative grid shrink-0 place-items-center rounded-full',
        size === 'lg' ? 'size-16' : 'size-12',
        'transition-[transform,background-color] duration-instant ease-standard active:scale-95',
        tone === 'answer' && 'bg-online text-white shadow-md',
        tone === 'end' && 'bg-danger text-white shadow-lg',
        tone === 'active' && 'bg-brand text-white shadow-md',
        /*
          Solid, and inverted when the switch is on.

          Dark circle with a white glyph is the resting state, and it holds
          against everything this screen can put behind it: a face, a shared
          document, the plain page of a voice call. The glass version borrowed
          its colour from whatever was underneath, which meant the controls
          changed shade whenever the other person moved.

          Flipping to white is how "muted" and "camera off" announce
          themselves. It is the loudest thing available and it is spent on the
          two states somebody needs to notice they are in.
        */
        tone === 'neutral' &&
          (pressed ? 'bg-white text-ink shadow-md' : 'bg-ink/85 text-white shadow-sm'),
      )}
    >
      {children}
      {badge ? (
        <span
          aria-hidden
          className={cn(
            'absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center',
            'rounded-full bg-brand px-1.5 py-0.5',
            'text-caption font-semibold text-white tabular-nums',
          )}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Somebody's screen, as the main content of the call.
 *
 * ## `contain`, not `cover`
 *
 * The opposite of every other video in this file, and deliberately. A face
 * cropped to fill looks right; a spreadsheet cropped to fill has lost the
 * column somebody is pointing at. A shared screen is information, so all of it
 * is shown and the letterboxing is accepted.
 *
 * ## Fullscreen is on the surface, not in a menu
 *
 * The one thing anybody wants from a shared screen on a phone is *bigger*.
 * `requestFullscreen` is asked of the wrapper rather than the video element,
 * because on iOS a fullscreen `<video>` is taken over by the system player -
 * which would put native controls over a live call and lose the call UI behind
 * it. Where the API is missing entirely the button is not drawn.
 */
function SharedScreen({
  stream,
  who,
  mine,
  faces,
}: {
  stream: MediaStream;
  /** Whose screen it is. Said differently for your own - you know it is yours. */
  who: string;
  mine: boolean;
  /** Everybody else on the call, for the strip along the bottom. */
  faces: { userId: string; name: string; avatarUrl?: string; stream?: MediaStream }[];
}) {
  const t = useT();
  const ref = useStream(stream);
  const frame = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const canFullscreen =
    typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);

  const toggle = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void frame.current?.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div
      ref={frame}
      /*
        `backdrop`, the same near-black the camera and the story viewer sit on,
        and the one colour that does not follow the theme - a shared screen is
        a picture, and a picture is dark around the edges in every product on
        earth. Using `ink` here would turn the stage white in dark mode.
      */
      className="absolute inset-0 bg-backdrop"
    >
      <video ref={ref} autoPlay playsInline muted className="size-full object-contain" />

      {/*
        One bar across the top carrying everything: who is presenting on the
        left, the controls on the right. Two floating islands at different
        heights was the arrangement before, and it read as two unrelated things
        stuck on rather than one piece of chrome belonging to the stage.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 pt-10">
        <span
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2.5',
            'bg-black/55 text-white backdrop-blur-glass',
            'text-caption font-medium',
          )}
        >
          {/*
            A live dot, because a still frame and a frozen one look identical.
            It is the one piece of motion on this surface and it earns its
            place: it is the difference between "this is happening" and "this
            has stopped".
          */}
          <span
            aria-hidden
            className="size-2 shrink-0 animate-pulse rounded-full bg-danger"
          />
          {mine ? t('call.youArePresenting') : t('call.isPresenting', { name: who })}
        </span>

        {canFullscreen && (
          <button
            type="button"
            onClick={toggle}
            aria-label={full ? t('call.exitFullscreen') : t('call.fullscreen')}
            className={cn(
              'pointer-events-auto focus-ring grid size-10 shrink-0 place-items-center rounded-full',
              'bg-black/55 text-white backdrop-blur-glass',
              'transition-transform duration-instant active:scale-95',
            )}
          >
            <FullscreenIcon size={20} />
          </button>
        )}
      </div>

      {/*
        The faces, kept along the bottom of the stage.

        A shared screen with nobody visible beside it is a screen recording, not
        a call. The strip is small on purpose - the content is the point and the
        people are context - and it sits above the control row rather than
        behind it.
      */}
      {faces.length > 0 && (
        <ul className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center gap-2 px-3">
          {faces.map((face) => (
            <li key={face.userId}>
              {face.stream?.getVideoTracks().length ? (
                <span className="block overflow-hidden rounded-lg border border-white/15 shadow-lg">
                  <PresenterFace stream={face.stream} />
                </span>
              ) : (
                <Avatar name={face.name} id={face.userId} src={face.avatarUrl} size="md" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A face beside a shared screen. Small, cropped to fill, always muted. */
function PresenterFace({ stream }: { stream: MediaStream }) {
  const ref = useStream(stream);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className="h-16 w-24 bg-backdrop object-cover"
    />
  );
}
