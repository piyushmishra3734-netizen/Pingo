import type { Story, StoryGroup } from '@pingo/core';
import { Avatar, CloseIcon, MoreIcon, PingoLoader, cn } from '@pingo/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { Overlay } from '../../components/Overlay.js';
import { ShareStorySheet } from './ShareStorySheet.js';
import { StoryActions } from './StoryActions.js';
import { useStories } from './StoryContext.js';
import { MyStoryMenu, OtherStoryMenu } from './StoryMenus.js';
import { StoryOverlay } from './StoryOverlay.js';
import { StoryProgress } from './StoryProgress.js';
import { StoryViewersSheet } from './StoryViewersSheet.js';
import { useStoryPlayer } from './useStoryPlayer.js';

/**
 * Fullscreen story playback.
 *
 * Tap right to advance, tap left to go back, hold to pause, swipe down to
 * close, and a segmented bar shows where you are — the grammar everyone already
 * knows, so there is nothing to learn. Running off the end of one person starts
 * the next, which is what makes a rail feel like a rail rather than a set of
 * separate things you keep having to go back to.
 *
 * ## Why one pointer surface rather than tap zones
 *
 * The first version used two invisible buttons over the media. That cannot
 * express hold-to-pause or swipe-to-close: a button fires on release and knows
 * nothing about how long it was held or how far the finger moved. So the media
 * is a single pointer surface and the gesture is classified on release — far
 * enough down and it was a dismissal, held long enough and it was a pause and
 * never a tap, otherwise which third it landed on decides.
 *
 * The keyboard is served separately and properly: arrows move, space pauses,
 * Escape closes. A pointer-only viewer would be unusable without a touchscreen.
 */

/** Past this, letting go closes the viewer. Roughly a thumb's travel. */
const DISMISS_DISTANCE = 110;

/** A press longer than this was a pause, so releasing must not also advance. */
const HOLD_MS = 220;

export interface StoryViewerProps {
  /** Every group in rail order, so the queue can run past one author. */
  groups: StoryGroup[];
  /** Which circle was tapped. */
  startGroupIndex: number;
  /** Decides whose story shows insights rather than a reply box. */
  currentUserId: string | undefined;
  onClose: () => void;
  /**
   * Where the tapped circle was, so the viewer can grow out of it.
   *
   * Optional: opened without an origin, it simply fades in.
   */
  origin?: DOMRect;
}

export function StoryViewer({
  groups,
  startGroupIndex,
  currentUserId,
  onClose,
  origin,
}: StoryViewerProps) {
  const { markSeen, setLiked, service, refresh, mutedAuthors, setAuthorMuted } = useStories();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const player = useStoryPlayer({ groups, startGroupIndex, onClose });
  const { group, storyIndex, progressRef } = player;
  const story = group.stories[storyIndex];

  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  /*
   * FLIP: the viewer is already full-screen, and we animate *back* from where
   * the circle was to where it now is.
   *
   * Animating width and height instead would relayout every frame and drop the
   * whole thing to single figures on a phone. A transform is composited, so it
   * stays smooth, and morphing `border-radius` alongside it is what sells the
   * circle becoming a rectangle rather than a card sliding up.
   */
  useEffect(() => {
    const element = rootRef.current;
    if (!element || !origin) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const target = element.getBoundingClientRect();
    if (target.width === 0 || target.height === 0) return;

    const scaleX = origin.width / target.width;
    const scaleY = origin.height / target.height;
    const dx = origin.left + origin.width / 2 - (target.left + target.width / 2);
    const dy = origin.top + origin.height / 2 - (target.top + target.height / 2);

    element.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`,
          borderRadius: '9999px',
          opacity: 0,
        },
        { transform: 'none', borderRadius: '0px', opacity: 1 },
      ],
      {
        duration: 340,
        // The app's standard curve: quick to leave, slow to settle.
        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
        fill: 'both',
      },
    );
  }, [origin]);

  // Focus lands on Close once, on open. Anything that re-ran this would take
  // focus off the reply box a beat after the user tapped into it.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  /*
   * Marked on display rather than on close, so leaving halfway still records
   * exactly what was actually looked at.
   *
   * Keyed on the id, never the object. A story object is rebuilt whenever
   * anything about the rail changes — including by this very call — so
   * depending on its identity means marking the same story seen forever.
   */
  const storyId = story?.id;
  useEffect(() => {
    if (storyId) void markSeen(storyId);
  }, [storyId, markSeen]);

  // ---- keyboard -----------------------------------------------------------

  useEffect(() => {
    let spaceRelease: (() => void) | undefined;

    const typing = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
    };

    const onDown = (event: KeyboardEvent) => {
      // Anything typed into the reply box belongs to the reply box.
      if (typing(event)) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur();
        return;
      }

      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') player.next();
      else if (event.key === 'ArrowLeft') player.previous();
      else if (event.key === ' ') {
        // Space is the universal pause, and it would otherwise scroll.
        event.preventDefault();
        if (!event.repeat && !spaceRelease) spaceRelease = player.hold();
      }
    };

    const onUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        spaceRelease?.();
        spaceRelease = undefined;
      }
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      // Unmounting mid-press must not leave playback paused forever.
      spaceRelease?.();
    };
  }, [onClose, player]);

  // ---- one pointer surface ------------------------------------------------

  const gesture = useRef<
    { x: number; y: number; at: number; release: () => void } | undefined
  >(undefined);

  const onPointerDown = (event: React.PointerEvent) => {
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
      // Pauses immediately: a finger on the story is a finger on the story,
      // whatever the gesture turns out to have been.
      release: player.hold(),
    };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = gesture.current;
    if (!start) return;
    // Only downward. There is nothing above a story to drag towards.
    setDragY(Math.max(0, event.clientY - start.y));
  };

  const endGesture = (event: React.PointerEvent) => {
    const start = gesture.current;
    if (!start) return;
    gesture.current = undefined;
    start.release();
    setDragging(false);

    const movedY = event.clientY - start.y;
    const movedX = Math.abs(event.clientX - start.x);
    const held = performance.now() - start.at;

    setDragY(0);

    if (movedY > DISMISS_DISTANCE) {
      onClose();
      return;
    }
    // A pause, or a drag that came back. Either way it was not a tap.
    if (held > HOLD_MS || movedY > 12 || movedX > 12) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    // The left third goes back and the rest advances — the proportion every
    // thumb already expects.
    if (event.clientX - bounds.left < bounds.width / 3) player.previous();
    else player.next();
  };

  if (!story) return null;

  const owned = story.authorId === currentUserId;
  const muted = mutedAuthors.includes(story.authorId);
  const dragProgress = Math.min(1, dragY / (DISMISS_DISTANCE * 2));
  const storyUrl = `${window.location.origin}/profile/${story.authorUsername}`;

  // ---- actions ------------------------------------------------------------

  const removeStory = async () => {
    setMenuOpen(false);
    const go = await confirm({
      title: 'Delete this story?',
      description:
        'It goes now rather than at the end of the day, along with its views and likes.',
      confirmLabel: 'Delete',
    });
    if (!go) return;
    await service.remove(story.id);
    await refresh();
    onClose();
  };

  const saveStory = () => {
    setMenuOpen(false);
    const link = document.createElement('a');
    link.href = story.mediaUrl;
    link.download = `pingo-story-${story.id}.${story.kind === 'video' ? 'mp4' : 'jpg'}`;
    link.rel = 'noopener';
    link.click();
  };

  const copyLink = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(storyUrl);
    } catch {
      // Clipboard refused. Nothing worth interrupting playback over.
    }
  };

  /*
   * Sharing goes to a chat, not to the OS.
   *
   * The spec's destinations are a friend and a group, which are both inside the
   * product — handing the URL to the system share sheet would be a different
   * feature that happens to share the word. The sheet also enforces the rule
   * that a close-friends or specific-people story cannot be passed on at all.
   */
  const shareStory = () => {
    setMenuOpen(false);
    setSharing(true);
  };

  const toggleMute = async () => {
    setMenuOpen(false);
    await setAuthorMuted(story.authorId, !muted);
    // A muted author's circle leaves the rail, so there is nothing to go back to.
    if (!muted) onClose();
  };

  return (
    <Overlay>
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${group.authorName}'s story`}
        className={cn(
          'fixed inset-0 z-1000 flex flex-col overflow-hidden bg-ink',
          // Only when there is no circle to grow out of; the FLIP above owns
          // the motion whenever there is one, and two would fight.
          !origin && 'animate-fade-in',
        )}
        style={{
          transform: dragY
            ? `translateY(${dragY}px) scale(${1 - dragProgress * 0.06})`
            : undefined,
          // Absent while the finger is down, so the drag tracks it exactly; the
          // release then springs back.
          transition: dragging ? undefined : 'transform 240ms cubic-bezier(0.32,0.72,0,1)',
          borderRadius: dragY ? '1.5rem' : undefined,
        }}
      >
        <StoryProgress count={group.stories.length} index={storyIndex} progressRef={progressRef} />

        {/* ---- who, when, and the menu -------------------------------- */}
        <div className="relative z-20 flex shrink-0 items-center gap-3 px-4 py-3">
          <Avatar
            name={group.authorName}
            id={group.authorId}
            src={group.authorAvatarUrl}
            size="sm"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-body text-white">
                {owned ? 'Your story' : group.authorName}
              </span>
              <span className="shrink-0 text-caption text-white/55">{ago(story.createdAt)}</span>
            </span>
            <span className="block truncate text-caption text-white/55">
              {/*
                "3 / 5" beside the handle as well as in the bars. The bars show
                position graphically; this is the same fact for anyone who would
                rather read it, and for a screen reader.
              */}
              @{group.authorUsername} · {storyIndex + 1} / {group.stories.length}
              {story.audience === 'close' && ' · Close friends'}
            </span>
          </span>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Story options"
            className="touch-target focus-ring grid size-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10"
          >
            <MoreIcon size={22} />
          </button>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="touch-target focus-ring grid size-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10"
          >
            <CloseIcon size={22} />
          </button>
        </div>

        {/* ---- the story ---------------------------------------------- */}
        <div
          className="relative min-h-0 flex-1"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          // The browser must not also pan, zoom or pull-to-refresh underneath.
          style={{ touchAction: 'none' }}
        >
          {story.kind === 'video' ? (
            <StoryVideo story={story} paused={player.paused} onDuration={player.reportDuration} />
          ) : (
            <StoryImage
              story={story}
              alt={story.caption ?? `Story by ${group.authorName}`}
              hold={player.hold}
            />
          )}

          <StoryOverlay story={story} />

          {player.paused && (
            <span
              className={cn(
                'animate-fade-in pointer-events-none absolute top-3 left-1/2 -translate-x-1/2',
                'rounded-full bg-ink/50 px-3 py-1 text-caption text-white backdrop-blur-glass',
              )}
            >
              Paused
            </span>
          )}
        </div>

        {/* ---- what you can do about it -------------------------------- */}
        <div className="relative z-20 shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-xl">
            {owned ? (
              <button
                type="button"
                onClick={() => setViewersOpen(true)}
                className={cn(
                  'focus-ring mx-auto flex items-center gap-2 rounded-full',
                  'bg-white/12 px-4 py-2.5 text-caption text-white backdrop-blur-glass',
                  'transition-colors duration-instant hover:bg-white/20',
                )}
              >
                Seen by — tap for insights
              </button>
            ) : (
              <StoryActions
                story={story}
                liked={story.likedByMe}
                onLike={(liked) => void setLiked(story.id, liked)}
                onHold={player.hold}
                onOpenChat={(conversationId) => {
                  onClose();
                  navigate(`/chats/${conversationId}`);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {menuOpen &&
        (owned ? (
          <MyStoryMenu
            onDelete={() => void removeStory()}
            onSave={saveStory}
            onArchive={() => {
              setMenuOpen(false);
              onClose();
              navigate('/stories/archive');
            }}
            onInsights={() => {
              setMenuOpen(false);
              setViewersOpen(true);
            }}
            onShare={shareStory}
            onClose={() => setMenuOpen(false)}
          />
        ) : (
          <OtherStoryMenu
            story={story}
            muted={muted}
            onShare={() => void shareStory()}
            onCopyLink={() => void copyLink()}
            onMute={() => void toggleMute()}
            onReport={() => {
              /*
               * Reporting lives on the profile, where the sheet, the reasons
               * and the block-as-well follow-up already exist. A second
               * reporting flow here would be a second set of reasons to keep
               * in step with the first.
               */
              setMenuOpen(false);
              onClose();
              navigate(`/profile/${story.authorUsername}`);
            }}
            onClose={() => setMenuOpen(false)}
          />
        ))}

      {viewersOpen && <StoryViewersSheet story={story} onClose={() => setViewersOpen(false)} />}

      {sharing && <ShareStorySheet story={story} onClose={() => setSharing(false)} />}
    </Overlay>
  );
}

/**
 * A video story, driving the progress bar from its own length.
 *
 * A five-second timer over a twenty-second video would cut it off mid-sentence,
 * so the clock defers: the element reports its duration once metadata arrives
 * and the player uses that instead.
 */
/**
 * A story photo that holds the clock until it is actually on screen.
 *
 * ## The bug this exists to fix
 *
 * The progress bar started the moment the story was selected, not the moment
 * its picture arrived. On a fast connection those are the same instant and
 * nothing looks wrong. On a slow one the five seconds run out while the image
 * is still downloading, the viewer advances, and the story is marked seen and
 * gone — the user watched an empty screen and then lost the story entirely.
 *
 * The player already had the mechanism: `hold()` is the counted pause that
 * long-press uses. Loading is simply another reason to wait, and because the
 * count is shared, a finger held down during a slow load keeps it paused
 * afterwards rather than the two fighting over one boolean.
 *
 * ## Held before the first frame, not after
 *
 * The hold is taken during render — in a ref, synchronously — rather than in an
 * effect. An effect runs after paint, which leaves one frame where the clock is
 * already ticking, and that frame is exactly when a cached image would have
 * resolved. Taking it late also means a story that loads instantly briefly
 * shows the spinner.
 *
 * ## `decode()` rather than `onLoad`
 *
 * `onLoad` fires when the bytes are in, which is before the browser has
 * decoded them into something it can paint. A large photo can take another
 * beat, and the bar would start moving over a blank frame. `decode()` resolves
 * when it is genuinely ready to draw.
 */
function StoryImage({
  story,
  alt,
  hold,
}: {
  story: Story;
  alt: string;
  hold: () => () => void;
}) {
  const release = useRef<(() => void) | undefined>(undefined);
  const [ready, setReady] = useState(false);

  // Taken synchronously, once per story. See the note above.
  if (!release.current && !ready) release.current = hold();

  const done = useCallback(() => {
    setReady(true);
    release.current?.();
    release.current = undefined;
  }, []);

  useEffect(() => {
    // A new story means a new wait. Any hold from the previous one is released
    // by the cleanup below, so the count cannot drift upward across stories.
    setReady(false);
    release.current ??= hold();

    return () => {
      release.current?.();
      release.current = undefined;
    };
  }, [story.id, hold]);

  return (
    <>
      <img
        key={story.id}
        src={story.mediaUrl}
        alt={alt}
        draggable={false}
        onLoad={(event) => {
          /*
           * Resolved either way. `decode()` rejects on a detached or replaced
           * image, and treating that as "never ready" would hang the story
           * forever behind a spinner — which is a worse failure than starting
           * the clock a frame early.
           */
          void event.currentTarget.decode().catch(() => undefined).finally(done);
        }}
        onError={done}
        className={cn(
          'absolute inset-0 size-full object-contain select-none',
          'transition-opacity duration-base ease-standard',
          ready ? 'opacity-100' : 'opacity-0',
        )}
      />

      {!ready && (
        <span className="absolute inset-0 grid place-items-center">
          <PingoLoader label="Loading story" />
        </span>
      )}
    </>
  );
}

function StoryVideo({
  story,
  paused,
  onDuration,
}: {
  story: Story;
  paused: boolean;
  onDuration: (ms: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (paused) element.pause();
    else void element.play().catch(() => undefined);
  }, [paused]);

  return (
    <video
      ref={ref}
      key={story.id}
      src={story.mediaUrl}
      autoPlay
      playsInline
      /*
       * Muted, and deliberately. Autoplay with sound is refused by every
       * browser, so an unmuted story would simply not start — and a story that
       * needs a tap before it plays is a story most people never see.
       */
      muted
      onLoadedMetadata={(event) => onDuration(event.currentTarget.duration * 1000)}
      className="absolute inset-0 size-full object-contain"
    />
  );
}

/** "now", "3m", "5h" — a story never lives long enough to need more. */
function ago(createdAt: number): string {
  const minutes = Math.floor((Date.now() - createdAt) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
