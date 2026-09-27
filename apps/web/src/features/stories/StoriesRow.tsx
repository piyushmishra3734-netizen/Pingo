import type { StoryGroup } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { Plus } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import type { LiveStream } from '../live/types.js';

/**
 * The story tray at the top of the chat list, the stories sample's
 * (`docs/handoff/stories-camera/sample/story.html`, `.tray`).
 *
 * People, not posts: five stories from one person are one circle. You come
 * first, then the rest in the order `StoryContext` decides (unseen first).
 *
 * | Ring | Means |
 * | --- | --- |
 * | The coloured sweep | unseen |
 * | Green | close friends only |
 * | Grey | seen |
 * | Dashes, turning | loading, or a story of yours going up |
 *
 * "Your story" is always there. With nothing posted it is your face and a blue
 * `+`; tapping it makes one. With a story up, the face opens it, the `+` makes
 * another, and a hold manages them.
 */

/** How long a press has to last to mean "manage this" rather than "open it". */
const HOLD_MS = 480;

export interface StoriesRowProps {
  groups: StoryGroup[];
  /** The signed-in user, so their own circle can lead and read "Your story". */
  currentUserId: string | undefined;
  currentUserName: string;
  currentUserAvatarUrl?: string;
  /** Live broadcasts lead the same tray, Instagram's order. Empty hides. */
  lives?: LiveStream[];
  /** Tapping a live circle. */
  onWatchLive?: (live: LiveStream) => void;
  /** Tapping your own live circle. */
  onOpenMyLive?: () => void;
  /** The second argument is where the circle was, so the viewer can grow from it. */
  onOpen: (group: StoryGroup, origin: DOMRect) => void;
  /** The `+`, or your circle with nothing posted. */
  onCreate: () => void;
  /** Holding your own circle. */
  onManageMine: () => void;
  /** A story of yours is on its way up: your ring turns to dashes and spins. */
  uploading?: boolean;
  /** Rendered right after your own circle - the Arcade sits there. */
  extra?: ReactNode;
}

export function StoriesRow({
  groups,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  lives = [],
  onWatchLive,
  onOpenMyLive,
  onOpen,
  onCreate,
  onManageMine,
  uploading = false,
  extra,
}: StoriesRowProps) {
  const mine = groups.find((group) => group.authorId === currentUserId);
  const others = groups.filter((group) => group.authorId !== currentUserId);
  const myLive = lives.find((live) => live.hostId === currentUserId);
  const liveOthers = lives.filter((live) => live.hostId !== currentUserId);

  /*
   * Instagram's dashed ring turns while the first story loads, then the viewer
   * grows out of the circle - never a blank viewer waiting on the network.
   */
  const [loading, setLoading] = useState<string>();
  const open = async (group: StoryGroup, el: HTMLElement) => {
    if (loading) return;
    setLoading(group.authorId);
    const first = group.stories.find((s) => !s.seen) ?? group.stories[0];
    const ready = first?.kind === 'photo'
      ? new Promise<void>((r) => { const i = new Image(); i.onload = i.onerror = () => r(); i.src = first.mediaUrl; })
      : Promise.resolve();
    await Promise.race([ready, new Promise((r) => setTimeout(r, 1000))]);
    await new Promise((r) => setTimeout(r, 260));
    setLoading(undefined);
    onOpen(group, (el.querySelector('[data-ring]') ?? el).getBoundingClientRect());
  };

  return (
    <div>
      <h2 className="sr-only">Stories</h2>
      <ul className="scrollbar-none flex gap-3.5 overflow-x-auto overscroll-x-contain px-3 pt-1.5 pb-3" aria-label="Stories">
        {(myLive || liveOthers.length > 0) && <LiveHaloStyle />}
        {myLive && (
          <li key={`live-${myLive.id}`}>
            <button type="button" onClick={onOpenMyLive} aria-label="Your live video, tap to open" className="focus-ring block rounded-full">
              <LiveCircle name="You" id={myLive.hostId} avatarUrl={myLive.hostAvatarUrl} label="You" />
            </button>
          </li>
        )}
        {liveOthers.map((live) => (
          <li key={`live-${live.id}`}>
            <button type="button" onClick={() => onWatchLive?.(live)} aria-label={`${live.hostName} is live, tap to watch`} className="focus-ring block rounded-full">
              <LiveCircle name={live.hostName} id={live.hostId} avatarUrl={live.hostAvatarUrl} label={live.hostName.split(' ')[0] ?? live.hostName} />
            </button>
          </li>
        ))}
        <li>
          <MyCircle
            group={mine}
            name={currentUserName}
            userId={currentUserId}
            avatarUrl={currentUserAvatarUrl}
            onOpen={(el) => mine && void open(mine, el)}
            onCreate={onCreate}
            onManage={onManageMine}
            state={uploading || loading === currentUserId ? 'loading' : !mine ? 'none' : mine.allSeen ? 'seen' : 'unseen'}
          />
        </li>
        {extra && <li>{extra}</li>}

        {others.map((group) => (
          <li key={group.authorId}>
            <button
              type="button"
              onClick={(event) => void open(group, event.currentTarget)}
              aria-label={`${group.authorName}'s story, ${group.stories.length} ${group.stories.length === 1 ? 'item' : 'items'}, ${
                group.allSeen ? 'already seen' : 'not seen yet'}${group.closeFriends ? ', close friends' : ''}`}
              className="focus-ring flex w-[74px] shrink-0 flex-col items-center gap-[5px] rounded-[12px] text-[12px] text-ink"
            >
              <Ring state={loading === group.authorId ? 'loading' : group.allSeen ? 'seen' : group.closeFriends ? 'cf' : 'unseen'}>
                <RingFace name={group.authorName} id={group.authorId} src={group.authorAvatarUrl} />
              </Ring>
              <span className="w-full truncate text-center">{group.authorUsername || group.authorName}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type RingState = 'unseen' | 'cf' | 'seen' | 'none' | 'loading';

/**
 * The sample's `.ring`: 70px, the band as a padded background, the face inside
 * a white edge. Loading is the same sweep, cut into turning dashes.
 */
function Ring({ state, mine, children }: { state: RingState; mine?: boolean; children: ReactNode }) {
  return (
    <span
      data-ring
      {...(mine ? { 'data-story-ring': 'me' } : {})}
      className={cn('relative grid size-[70px] shrink-0 place-items-center rounded-full', state === 'seen' ? 'p-[2px]' : 'p-[3px]')}
      style={state === 'unseen' ? { background: RING } : state === 'cf' ? { background: '#1fc15e' } : state === 'seen' ? { background: '#dbdbdb' } : undefined}
    >
      {state === 'loading' && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background: RING,
            WebkitMask: 'repeating-conic-gradient(#000 0 8deg, transparent 8deg 14deg), radial-gradient(circle, transparent 31px, #000 32px)',
            WebkitMaskComposite: 'source-in',
            mask: 'repeating-conic-gradient(#000 0 8deg, transparent 8deg 14deg) intersect, radial-gradient(circle, transparent 31px, #000 32px)',
            animation: 'tray-spin 1.1s linear infinite',
          }}
        />
      )}
      {children}
      <style>{'@keyframes tray-spin { to { transform: rotate(360deg) } }'}</style>
    </span>
  );
}
/** The sample's ring colours, swept round from the lower left. */
const RING = 'conic-gradient(from 210deg, #e0559b, #ff9a5a, #ffcc4d, #ff9a5a, #8b5dff, #e0559b)';

function RingFace({ name, id, src }: { name: string; id: string | undefined; src?: string | undefined }) {
  return (
    <span className="relative block size-full overflow-hidden rounded-full border-[3px] border-page bg-page">
      {src
        ? <img src={src} alt="" className="block size-full rounded-full object-cover" draggable={false} />
        : <Avatar name={name} id={id} size="lg" className="!size-full" />}
    </span>
  );
}

/**
 * Your own circle: open it, start one, or manage what is there. The hold is
 * only offered when there is something to manage.
 */
function MyCircle({
  group,
  name,
  userId,
  avatarUrl,
  onOpen,
  onCreate,
  onManage,
  state,
}: {
  group: StoryGroup | undefined;
  name: string;
  userId: string | undefined;
  avatarUrl?: string;
  onOpen: (el: HTMLElement) => void;
  onCreate: () => void;
  onManage: () => void;
  state: RingState;
}) {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  return (
    <span className="relative flex w-[74px] shrink-0 flex-col items-center gap-[5px] text-[12px] text-ink">
      <button
        type="button"
        onPointerDown={(event) => {
          if (!group) return;
          held.current = false;
          origin.current = { x: event.clientX, y: event.clientY };
          timer.current = window.setTimeout(() => { held.current = true; onManage(); navigator.vibrate?.(8); }, HOLD_MS);
        }}
        onPointerMove={(event) => {
          // A hold that drifts is the rail being scrolled.
          if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) clear();
        }}
        onPointerUp={clear}
        onPointerCancel={clear}
        onContextMenu={(event) => { if (group) event.preventDefault(); }}
        onClick={(event) => {
          clear();
          if (held.current) { held.current = false; return; }
          if (group) onOpen(event.currentTarget);
          else onCreate();
        }}
        aria-busy={state === 'loading' || undefined}
        aria-label={group ? `Your story, ${group.stories.length} ${group.stories.length === 1 ? 'item' : 'items'}. Tap to view, hold to manage.` : 'Add to your story'}
        className="focus-ring block rounded-full"
      >
        <Ring state={state} mine>
          <RingFace name={name} id={userId} src={avatarUrl} />
        </Ring>
      </button>
      {/* The sample's blue +: its own control once a story is up, part of the circle before. */}
      <button
        type="button"
        onClick={onCreate}
        aria-label={group ? 'Add another story' : 'Add to your story'}
        tabIndex={group ? 0 : -1}
        className="absolute top-12 left-[50px] grid size-[22px] place-items-center rounded-full bg-[#0a84ff] text-white shadow-[0_0_0_3px_var(--color-page,#fff)] after:absolute after:-inset-2 after:content-['']"
      >
        <Plus size={14} strokeWidth={3} />
      </button>
      <span className="w-full truncate text-center">Your story</span>
    </span>
  );
}

/** A live circle inside the tray: red band, breathing halo, LIVE pinned to the bottom. */
function LiveCircle({ name, id, avatarUrl, label }: { name: string; id: string | undefined; avatarUrl?: string; label: string }) {
  return (
    <span className="flex w-[74px] shrink-0 flex-col items-center gap-[5px] text-[12px] text-ink">
      <span className="relative">
        <span aria-hidden className="live-halo absolute -inset-[3px] rounded-full bg-danger/60" style={{ animation: 'live-halo 2.2s ease-in-out infinite' }} />
        <span className="relative grid size-[70px] place-items-center rounded-full bg-danger p-[3px]">
          <RingFace name={name} id={id} src={avatarUrl} />
        </span>
        <span aria-hidden className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md bg-danger px-1.5 py-px text-[0.5625rem] font-bold tracking-wide text-white">LIVE</span>
      </span>
      <span className="w-full truncate text-center">{label}</span>
    </span>
  );
}

/** The breathing halo. Silent under reduced motion. */
function LiveHaloStyle() {
  return (
    <style>{`@keyframes live-halo { 0% { opacity: 0.85; transform: scale(1); } 45% { opacity: 0; transform: scale(1.28); } 55% { opacity: 0; transform: scale(0.96); } 100% { opacity: 0.85; transform: scale(1); } } @media (prefers-reduced-motion: reduce) { .live-halo { animation: none !important; opacity: 0.5 !important; } }`}</style>
  );
}
