import { STORY_PHOTO_MS, useChat, type Story, type StoryGroup, type StoryViewer as Watcher } from '@pingo/core';
import { cn } from '@pingo/ui';
import { BellOff, CirclePlus, Download, Link as LinkIcon, MoreHorizontal, MoreVertical, Music2, Repeat2, Send, Star, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import {
  VideoOverlayLayer,
  pictureRatio,
  useContainBox,
  videoGeometry,
} from '../camera/VideoOverlay.js';
import { publicAppUrl } from '../../lib/public-origin.js';
import { StoryActions } from './StoryActions.js';
import { useStories } from './StoryContext.js';
import { StoryOverlay } from './StoryOverlay.js';
import { StoryPrivacySheet } from './StoryPrivacySheet.js';
import { StoryStickerLayer } from './stickers/StoryStickerLayer.js';
import { StoryProgress } from './StoryProgress.js';
import { StorySound, soundLength } from './StorySound.js';
import { MAX_STORY_SECONDS } from './story-audio.js';
import { useStoryPlayer } from './useStoryPlayer.js';
import { useBoomerang } from './Boomerang.js';
import { ActivitySheet, MyMenu, OtherMenu, SendStorySheet } from './ViewerSheets.js';

/**
 * Watching stories, the stories sample's way (`docs/handoff/stories-camera/
 * sample/story.html`).
 *
 * The picture fills the frame down to the bar at the foot, which is the reply
 * box and the heart on somebody else's story and Activity on yours. Tap right
 * to advance and left (the first 30%) to go back, hold to pause - the bars, the
 * header and the foot step aside - swipe sideways to turn to the next person
 * round a cube, down to close and up for the reply (or your Activity). It grows
 * out of the circle it was opened from and shrinks back into it.
 *
 * The keyboard is served too: arrows move, space pauses, Escape closes.
 */

/** Past this, letting go closes the viewer. */
const DISMISS_DISTANCE = 120;
/** How long a press has to last to be a pause rather than a tap. */
const HOLD_MS = 200;

export interface StoryViewerProps {
  /** Every group in rail order, so the queue can run past one author. */
  groups: StoryGroup[];
  /** Which circle was tapped. */
  startGroupIndex: number;
  /** Decides whose story shows Activity rather than a reply box. */
  currentUserId: string | undefined;
  onClose: () => void;
  /** Where the tapped circle was, so the viewer can grow out of it and shrink back. */
  origin?: DOMRect;
}

export function StoryViewer({
  groups,
  startGroupIndex,
  currentUserId,
  onClose,
  origin,
}: StoryViewerProps) {
  const { markSeen, setLiked, service, refresh, setAuthorMuted, notify } = useStories();
  const { conversations, service: chat } = useChat();
  const navigate = useNavigate();

  const player = useStoryPlayer({ groups, startGroupIndex, onClose });
  const { group, storyIndex, progressRef } = player;
  const story = group.stories[storyIndex];

  const rootRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);

  // A picture with a song on it stays up long enough to hear it (capped).
  const photoSound = story && story.kind === 'photo' ? soundLength(story.audio) : 0;
  const { reportDuration } = player;
  useEffect(() => {
    if (photoSound <= 0) return;
    reportDuration(Math.max(STORY_PHOTO_MS, Math.min(photoSound, MAX_STORY_SECONDS) * 1000));
  }, [photoSound, reportDuration, story?.id]);

  const [sheet, setSheet] = useState<'more' | 'send' | 'activity' | 'settings'>();
  const [typing, setTyping] = useState(false);
  /** A press held long enough to be a pause: the chrome steps aside. */
  const [held, setHeld] = useState(false);

  // Any sheet holds the story, as the sample's do.
  const { hold } = player;
  useEffect(() => (sheet ? hold() : undefined), [sheet, hold]);

  // ---- growing out of the ring, and back ------------------------------------
  const circle = (r: number) => {
    const o = origin!;
    return `circle(${r}px at ${o.left + o.width / 2}px ${o.top + o.height / 2}px)`;
  };
  useEffect(() => {
    const root = rootRef.current, face = faceRef.current;
    if (!root || !face || !origin || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const R = Math.hypot(innerWidth, innerHeight), at = `${origin.left + origin.width / 2}px ${origin.top + origin.height / 2}px`;
    const ease = { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' };
    root.animate([{ clipPath: circle(origin.width / 2) }, { clipPath: circle(R) }], ease);
    face.animate([{ transform: 'scale(.35)', transformOrigin: at }, { transform: 'scale(1)', transformOrigin: at }], ease);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    const root = rootRef.current, face = faceRef.current;
    if (!root || !face || !origin || matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    closingRef.current = true;
    const R = Math.hypot(innerWidth, innerHeight), at = `${origin.left + origin.width / 2}px ${origin.top + origin.height / 2}px`;
    const ease = { duration: 340, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' as const };
    face.animate([{ transform: face.style.transform || 'none', transformOrigin: at }, { transform: 'scale(.3)', transformOrigin: at }], ease);
    void root.animate([{ clipPath: circle(R) }, { clipPath: circle(origin.width / 2) }], ease).finished.catch(() => undefined).then(() => onClose());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, onClose]);
  const latestClose = useRef(requestClose);
  latestClose.current = requestClose;

  // Marked on display, keyed on the id - see StoryContext's note on why not the object.
  const storyId = story?.id;
  useEffect(() => {
    if (storyId) void markSeen(storyId);
  }, [storyId, markSeen]);

  const owned = story?.authorId === currentUserId;
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  useEffect(() => {
    setWatchers([]);
    if (!storyId || !owned) return;
    let live = true;
    service.listViewers(storyId).then((list) => { if (live) setWatchers(list); }).catch(() => undefined);
    return () => { live = false; };
  }, [storyId, owned, service]);

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    let spaceRelease: (() => void) | undefined;
    const typingIn = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
    };
    const onDown = (event: KeyboardEvent) => {
      if (typingIn(event)) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur();
        return;
      }
      if (event.key === 'Escape') latestClose.current();
      else if (event.key === 'ArrowRight') player.next();
      else if (event.key === 'ArrowLeft') player.previous();
      else if (event.key === ' ') {
        event.preventDefault();
        if (!event.repeat && !spaceRelease) spaceRelease = player.hold();
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === ' ') { spaceRelease?.(); spaceRelease = undefined; }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      spaceRelease?.();
    };
  }, [player]);

  // ---- one pointer surface: tap, hold, swipe ----------------------------------
  const gesture = useRef<
    | { x: number; y: number; at: number; release: () => void; axis?: 'x' | 'y'; dx: number; dy: number; holdTimer: number; held: boolean }
    | undefined
  >(undefined);
  const turning = useRef<1 | -1 | 0>(0);
  const width = () => faceRef.current?.clientWidth || innerWidth;

  // The cube: the face turns about the edge it shares with the next person's.
  const faceAt = (dx: number) => {
    const el = faceRef.current; if (!el) return;
    el.style.transformOrigin = dx < 0 ? 'right center' : 'left center';
    el.style.transform = `translateX(${dx}px) rotateY(${(-dx / width()) * 90}deg)`;
  };
  const turnOut = (dir: 1 | -1) => {
    const el = faceRef.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) { player.jumpGroup(dir); return; }
    turning.current = dir;
    el.style.transformOrigin = dir === 1 ? 'right center' : 'left center';
    void el.animate([{ transform: el.style.transform || 'none' }, { transform: `translateX(${-dir * width()}px) rotateY(${dir * 90}deg)` }],
      { duration: 280, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }).finished.catch(() => undefined).then(() => player.jumpGroup(dir));
  };
  // Whenever the person changes, the new face turns in.
  const lastGroup = useRef(player.groupIndex);
  useEffect(() => {
    const el = faceRef.current;
    if (player.groupIndex === lastGroup.current) return; // opening, not turning
    const dir = (player.groupIndex > lastGroup.current ? 1 : -1) as 1 | -1;
    lastGroup.current = player.groupIndex;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = '';
    turning.current = 0;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.style.transformOrigin = dir === 1 ? 'left center' : 'right center';
    el.animate([{ transform: `translateX(${dir * width()}px) rotateY(${-dir * 90}deg)` }, { transform: 'none' }],
      { duration: 420, easing: 'cubic-bezier(.3,.7,.2,1)' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.groupIndex]);

  // The chrome's own controls, a sticker's buttons and the slider's knob are not the story.
  const outside = (e: React.PointerEvent) => !!(e.target as HTMLElement).closest('[data-chrome], button, input, a, .sk-knob');

  const onPointerDown = (event: React.PointerEvent) => {
    if (turning.current || closingRef.current || outside(event)) return;
    const g = {
      x: event.clientX, y: event.clientY, at: performance.now(), dx: 0, dy: 0, held: false,
      // A finger on the story holds it, whatever the gesture turns out to be.
      release: player.hold(),
      holdTimer: window.setTimeout(() => { g.held = true; setHeld(true); }, HOLD_MS),
    };
    gesture.current = g;
    // Stickers keep their own taps; anywhere else the surface follows the finger.
    if (!(event.target as HTMLElement).closest('.sk')) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    g.dx = event.clientX - g.x; g.dy = event.clientY - g.y;
    if (!g.axis && Math.hypot(g.dx, g.dy) > 10) {
      g.axis = Math.abs(g.dx) > Math.abs(g.dy) ? 'x' : 'y';
      window.clearTimeout(g.holdTimer);
    }
    if (g.axis === 'x') {
      const edge = (g.dx > 0 && player.groupIndex === 0) || (g.dx < 0 && player.groupIndex === groups.length - 1) ? 0.2 : 1;
      faceAt(g.dx * edge);
    } else if (g.axis === 'y' && g.dy > 0) {
      const k = Math.min(1, g.dy / 500), face = faceRef.current, root = rootRef.current;
      if (face) face.style.transform = `translateY(${g.dy}px) scale(${1 - k * 0.35})`;
      if (root) root.style.background = `rgba(0,0,0,${1 - k})`;
    }
  };

  const endGesture = (event: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = undefined;
    window.clearTimeout(g.holdTimer);
    setHeld(false);
    g.release();
    const face = faceRef.current, root = rootRef.current;

    if (g.axis === 'x') {
      const dir = (g.dx < 0 ? 1 : -1) as 1 | -1;
      const room = dir === 1 ? player.groupIndex < groups.length - 1 : player.groupIndex > 0;
      if (Math.abs(g.dx) > width() * 0.25 && room) { turnOut(dir); return; }
      if (face) void face.animate([{ transform: face.style.transform || 'none' }, { transform: 'none' }], { duration: 300, easing: 'ease' }).finished.catch(() => undefined).then(() => { face.style.transform = ''; });
      return;
    }
    if (g.axis === 'y') {
      if (g.dy > DISMISS_DISTANCE) { requestClose(); return; }
      if (face) void face.animate([{ transform: face.style.transform || 'none' }, { transform: 'none' }], { duration: 300, easing: 'ease' }).finished.catch(() => undefined).then(() => { face.style.transform = ''; });
      if (root) root.style.background = '';
      // Up: your Activity, or the reply box on theirs.
      if (g.dy < -70) {
        if (owned) setSheet('activity');
        else rootRef.current?.querySelector<HTMLInputElement>('input[enterkeyhint="send"]')?.focus({ preventScroll: true });
      }
      return;
    }
    // A pause, or a tap on a sticker: neither is a tap on the story.
    if (g.held || (event.target as HTMLElement).closest('.sk')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX - bounds.left < bounds.width * 0.3) player.previous();
    else player.next();
  };

  if (!story) return null;

  // ---- actions ------------------------------------------------------------
  const storyUrl = publicAppUrl(`/profile/${story.authorUsername}`);
  const leaveTo = (path: string) => { onClose(); navigate(path); };

  const removeStory = async () => {
    try {
      await service.remove(story.id);
      notify('Story deleted', <Trash2 />);
      await refresh();
      if (group.stories.length <= 1) onClose();
    } catch {
      notify('That did not delete', <Trash2 />);
    }
  };
  const saveStory = () => {
    const link = document.createElement('a');
    link.href = story.mediaUrl;
    link.download = `pingo-story-${story.id}.${story.kind === 'video' ? 'mp4' : 'jpg'}`;
    link.rel = 'noopener';
    link.click();
    notify('Saved to your phone', <Download />);
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(storyUrl); notify('Link copied', <LinkIcon />); } catch { /* clipboard refused */ }
  };
  const mute = async () => {
    await setAuthorMuted(story.authorId, true);
    notify(`Muted ${group.authorName}'s story`, <BellOff />);
    onClose();
  };
  const messageWatcher = async (w: Watcher) => {
    const existing = conversations.find((c) => c.kind === 'direct' && c.participantIds.includes(w.userId));
    const id = existing?.id ?? (await chat.startDirectConversation(w.userId));
    leaveTo(`/chats/${id}`);
  };
  const insights = async () => {
    try {
      const n = await service.insights(story.id);
      notify(`${n.views} views · ${n.likes} likes · ${n.replies} replies`);
    } catch { /* nothing to show */ }
  };

  const chromeOff = held;
  const song = story.decor?.stickers.find((s) => s.type === 'music')?.d as { name?: string; artist?: string } | undefined;

  return (
    <Overlay onDismiss={requestClose}>
      <style>{VIEWER_CSS}</style>
      <div
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${group.authorName}'s story`}
        className={cn('fixed inset-0 z-1000 overflow-hidden bg-black select-none', !origin && 'animate-fade-in')}
        // A drag must never become the browser's own drag of a selection: that cancels the swipe.
        onDragStart={(e) => e.preventDefault()}
        style={{ perspective: '1100px' }}
      >
        {/* A phone's column on a wide screen; the whole screen on a phone. */}
        <div className="relative mx-auto h-full w-full max-w-[calc(100dvh*0.5)] [transform-style:preserve-3d]">
          <div
            ref={faceRef}
            className="absolute inset-0 overflow-hidden bg-black [backface-visibility:hidden]"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            style={{ touchAction: 'none' }}
          >
            {/* the picture, down to the bar */}
            <div className="absolute inset-x-0 top-0 bottom-16 overflow-hidden rounded-b-[14px] bg-[#111]">
              {story.kind === 'video' ? (
                <StoryVideo story={story} paused={player.paused} onDuration={player.reportDuration} hold={player.hold} />
              ) : (
                <StoryImage story={story} alt={story.caption ?? `Story by ${group.authorName}`} hold={player.hold} />
              )}
              <div className={cn('pointer-events-none absolute inset-x-0 top-0 z-[2] h-[120px] bg-gradient-to-b from-black/45 to-transparent transition-opacity duration-200', chromeOff && 'opacity-0')} />
              <div className={cn('absolute inset-0 z-[4] transition-opacity duration-200', typing && 'pointer-events-none opacity-0')}>
                <StoryStickerLayer story={story} hold={player.hold} onOpenProfile={(username) => leaveTo(`/profile/${username}`)} />
              </div>
              <StoryOverlay story={story} />
              {story.audio && story.audio.length > 0 && (
                <StorySound storyId={story.id} tracks={story.audio} paused={player.paused} />
              )}
            </div>

            <StoryProgress count={group.stories.length} index={storyIndex} progressRef={progressRef} hidden={chromeOff} />

            {/* who, when, the song, and the two buttons */}
            <div data-chrome className={cn('absolute top-[22px] right-1.5 left-3 z-[5] flex items-center gap-[9px] text-white transition-opacity duration-200', chromeOff && 'opacity-0')}>
              <Face src={group.authorAvatarUrl} name={group.authorName} />
              <div className="flex min-w-0 flex-col">
                <div className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold">
                  <span className="truncate">{owned ? 'Your story' : group.authorName}</span>
                  <span className="shrink-0 font-normal opacity-70">{ago(story.createdAt)}</span>
                  {story.audience === 'close' && (
                    <span className="inline-flex shrink-0 items-center gap-[3px] rounded-[5px] bg-close-friends px-1.5 py-0.5 text-[10.5px] font-bold whitespace-nowrap [&>svg]:size-[1em]"><Star />Close friends</span>
                  )}
                </div>
                {/* A story added from somebody's mention: theirs, credited under the name, as Instagram does. */}
                {story.decor?.from && (
                  <div className="flex max-w-[200px] items-center gap-[5px] text-[12px] opacity-[.92]">
                    <Repeat2 size={13} className="shrink-0" />
                    <span className="truncate">{story.decor.from.name}</span>
                  </div>
                )}
                {song?.name && (
                  <div className="flex max-w-[190px] items-center gap-[5px] overflow-hidden text-[12px] opacity-[.92]">
                    <Music2 size={12} className="shrink-0" />
                    <span className="sv-marquee whitespace-nowrap">{song.name} · {song.artist}</span>
                  </div>
                )}
              </div>
              <span className="flex-1" />
              <button type="button" aria-label="More" onClick={() => setSheet('more')} className="grid size-9 shrink-0 place-items-center [&>svg]:size-[22px]"><MoreHorizontal /></button>
              <button type="button" aria-label="Close" onClick={requestClose} className="grid size-9 shrink-0 place-items-center [&>svg]:size-[22px]"><X /></button>
            </div>

            {/* the foot: the reply box on theirs, Activity on yours */}
            <div data-chrome className={cn('absolute inset-x-0 bottom-0 z-[5] flex h-16 items-center gap-2.5 px-3 text-white transition-opacity duration-200', chromeOff && 'opacity-0')}>
              {owned ? (
                <>
                  <button type="button" onClick={() => setSheet('activity')} className="flex items-center gap-2 text-[13px] font-semibold">
                    {watchers.length > 0 && (
                      <span className="flex">
                        {watchers.slice(0, 3).map((w, i) => (
                          <Face key={w.userId} src={w.avatarUrl} name={w.displayName} className={cn('size-6 border-2 border-black', i > 0 && '-ml-2')} />
                        ))}
                      </span>
                    )}
                    Activity
                  </button>
                  <span className="flex-1" />
                  <button type="button" aria-label="Highlight" onClick={() => leaveTo('/stories/archive')} className="grid size-[38px] place-items-center [&>svg]:size-[26px]"><CirclePlus /></button>
                  <button type="button" aria-label="Send" onClick={() => setSheet('send')} className="grid size-[38px] place-items-center [&>svg]:size-[26px]"><Send /></button>
                  <button type="button" aria-label="More" onClick={() => setSheet('more')} className="grid size-[38px] place-items-center [&>svg]:size-[26px]"><MoreVertical /></button>
                </>
              ) : (
                <StoryActions
                  story={story}
                  liked={story.likedByMe}
                  onLike={(liked) => void setLiked(story.id, liked)}
                  onHold={player.hold}
                  onTyping={setTyping}
                  onSend={() => setSheet('send')}
                  overlayHost={faceRef.current}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {sheet === 'more' && (owned ? (
        <MyMenu
          onClose={() => setSheet(undefined)}
          onDelete={() => void removeStory()}
          onSave={saveStory}
          onHighlight={() => leaveTo('/stories/archive')}
          onSend={() => setSheet('send')}
          onSettings={() => setSheet('settings')}
        />
      ) : (
        <OtherMenu
          onClose={() => setSheet(undefined)}
          // Reporting lives on the profile, where the reasons already are.
          onReport={() => leaveTo(`/profile/${story.authorUsername}`)}
          onMute={() => void mute()}
          onAbout={() => leaveTo(`/profile/${story.authorUsername}`)}
          onCopy={() => void copyLink()}
        />
      ))}
      {sheet === 'send' && <SendStorySheet story={story} onClose={() => setSheet(undefined)} />}
      {sheet === 'activity' && (
        <ActivitySheet
          stories={group.stories}
          current={storyIndex}
          watchers={watchers}
          onPick={player.goTo}
          onCamera={() => leaveTo('/camera')}
          onInsights={() => void insights()}
          onSend={() => setSheet('send')}
          onSave={saveStory}
          onDelete={() => void removeStory()}
          onMessage={(w) => void messageWatcher(w)}
          onClose={() => setSheet(undefined)}
        />
      )}
      {sheet === 'settings' && <StoryPrivacySheet onClose={() => setSheet(undefined)} />}
    </Overlay>
  );
}

const VIEWER_CSS = `
@keyframes sv-fade { from { opacity: 0 } }
@keyframes sv-pop { 0% { transform: scale(.4) } 60% { transform: scale(1.3) } 100% { transform: scale(1) } }
@keyframes sv-marquee { 0%, 15% { transform: translateX(0) } 100% { transform: translateX(-60%) } }
@keyframes sv-spin { to { transform: rotate(360deg) } }
.sv-marquee { animation: sv-marquee 7s linear infinite; }
@media (prefers-reduced-motion: reduce) { .sv-marquee { animation: none; } }
`;

/** A face in the viewer: the photo, or the first letter. */
function Face({ src, name, className }: { src?: string | undefined; name: string; className?: string }) {
  return src
    ? <img src={src} alt="" className={cn('size-8 shrink-0 rounded-full object-cover', className)} />
    : <span className={cn('grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-[13px] font-bold text-white', className)}>{name[0]?.toUpperCase()}</span>;
}

/** Until the picture arrives: the sample's spinner, and the clock holds. */
function Spinner() {
  return <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-[6] -mt-[17px] -ml-[17px] size-[34px] rounded-full border-3 border-white/25 border-t-white" style={{ animation: 'sv-spin .8s linear infinite' }} />;
}

/**
 * A photo story, filling the frame. The clock is held from the first render
 * until the picture has decoded, so a slow one is never marked seen unseen.
 */
function StoryImage({ story, alt, hold }: { story: Story; alt: string; hold: () => () => void }) {
  const release = useRef<(() => void) | undefined>(undefined);
  const [ready, setReady] = useState(false);
  // Taken during render, not in an effect: an effect runs after paint, a frame too late.
  if (!release.current && !ready) release.current = hold();

  const done = useCallback(() => {
    setReady(true);
    release.current?.();
    release.current = undefined;
  }, []);

  useEffect(() => {
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
        onLoad={(event) => { void event.currentTarget.decode().catch(() => undefined).finally(done); }}
        onError={done}
        className="absolute inset-0 size-full object-cover select-none"
        style={story.decor?.filter ? { filter: story.decor.filter } : undefined}
      />
      {!ready && <Spinner />}
    </>
  );
}

/**
 * A video story, filling the frame and playing with its sound - opening a
 * story is a tap, which is what a browser asks before it plays sound. Where it
 * still refuses, the clip plays muted rather than not at all. A song laid over
 * it plays instead of the clip's own sound, as the sample's does.
 */
function StoryVideo({
  story,
  paused,
  onDuration,
  hold,
}: {
  story: Story;
  paused: boolean;
  onDuration: (ms: number) => void;
  hold: () => () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const echo = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number>();
  const [length, setLength] = useState(0);
  // A Boomerang plays forwards and back within the trim, on the viewer's clock.
  const boom = story.decor?.boom && story.decor.boom !== 'off' ? story.decor.boom : undefined;
  const from = length ? (story.videoEdit?.trimStart ?? 0) / length : 0;
  const to = length ? (story.videoEdit?.trimEnd ?? length) / length : 1;
  useBoomerang(ref, length ? boom : undefined, from, to, paused, echo);
  const [ready, setReady] = useState(false);
  const [clipMs, setClipMs] = useState(0);
  const release = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    setReady(false);
    release.current ??= hold();
    return () => {
      release.current?.();
      release.current = undefined;
    };
  }, [story.id, hold]);

  const done = useCallback(() => {
    setReady(true);
    release.current?.();
    release.current = undefined;
  }, []);

  const quiet = story.videoEdit?.muted === true || (story.audio?.length ?? 0) > 0;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (paused) { element.pause(); return; }
    element.play().catch(() => { element.muted = true; void element.play().catch(() => undefined); });
  }, [paused, story.id]);

  // Older clips were turned, cropped or drawn on as marks; those keep their frame.
  const edit = story.videoEdit;
  const overlay = edit?.overlay ?? [];
  const strokes = edit?.strokes ?? [];
  const framed = Boolean(edit?.rotate || edit?.crop || overlay.length > 0 || strokes.length > 0);
  const box = useContainBox(stage, framed && ratio ? pictureRatio(ratio, edit?.rotate ?? 0, edit?.crop) : undefined);
  const geometry = box ? videoGeometry(box, edit?.rotate ?? 0, edit?.crop) : undefined;
  const loops = soundLength(story.audio) * 1000 > clipMs + 150;

  const media = (
    <video
      ref={ref}
      key={story.id}
      src={story.mediaUrl}
      autoPlay
      playsInline
      muted={quiet}
      onLoadedMetadata={(event) => {
        const m = event.currentTarget;
        if (m.videoWidth > 0 && m.videoHeight > 0) setRatio(m.videoWidth / m.videoHeight);
        if (Number.isFinite(m.duration)) setLength(m.duration);
        const from = story.videoEdit?.trimStart ?? 0;
        if (from > 0) m.currentTime = from;
      }}
      onCanPlay={(event) => {
        const m = event.currentTarget;
        const from = story.videoEdit?.trimStart ?? 0;
        const to = story.videoEdit?.trimEnd ?? m.duration;
        const clip = Math.max(0, to - from) * 1000;
        setClipMs(clip);
        // There and back again takes twice as long, and twice that again slowed down.
        const shown = boom ? Math.min(15000, Math.max(3000, clip * (boom === 'slowmo' ? 4 : 2))) : clip;
        onDuration(Math.max(shown, soundLength(story.audio) * 1000));
        done();
      }}
      onError={done}
      onTimeUpdate={(event) => {
        if (boom) return;
        const m = event.currentTarget;
        const to = story.videoEdit?.trimEnd;
        if (to === undefined || m.currentTime < to) return;
        if (loops) m.currentTime = story.videoEdit?.trimStart ?? 0;
        else m.pause();
      }}
      onEnded={(event) => {
        if (!loops || boom) return;
        const m = event.currentTarget;
        m.currentTime = story.videoEdit?.trimStart ?? 0;
        void m.play().catch(() => undefined);
      }}
      className={cn('select-none', !geometry && 'absolute inset-0 size-full object-cover')}
      style={{
        ...(geometry ? geometry.video : {}),
        ...(story.decor?.filter ? { filter: story.decor.filter } : {}),
      }}
    />
  );

  return (
    <>
      <div ref={stage} className="pointer-events-none absolute inset-0 grid place-items-center">
        {geometry && box ? (
          <div className="relative overflow-hidden" style={{ width: box.width, height: box.height }}>
            <div style={geometry.picture}>{media}</div>
            <VideoOverlayLayer items={overlay} strokes={strokes} width={box.width} height={box.height} />
          </div>
        ) : (
          media
        )}
        {boom === 'echo' && !geometry && (
          <video ref={echo} src={story.mediaUrl} muted playsInline autoPlay className="absolute inset-0 size-full scale-[1.02] object-cover opacity-40 mix-blend-screen" />
        )}
      </div>
      {!ready && <Spinner />}
    </>
  );
}

function ago(createdAt: number): string {
  const minutes = Math.floor((Date.now() - createdAt) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
