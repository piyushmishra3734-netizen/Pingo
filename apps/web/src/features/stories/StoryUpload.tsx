import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Posting a story, Instagram's way: the editor closes the moment you share, the
 * picture shrinks into your own circle on the stories row, and that circle's
 * ring spins until the upload is done.
 */

/** Where the editor's frame was, and what to fly out of it. */
export interface StoryFrom {
  rect: DOMRect;
  /** A still of the story. A photo's own file is used when this is absent. */
  poster?: string;
  /** A video's look, which travels as data rather than pixels. */
  filter?: string;
}

/** Your own circle on the stories row, if it is on screen. */
export function myRing(): HTMLElement | undefined {
  const ring = document.querySelector<HTMLElement>('[data-story-ring="me"]');
  if (!ring) return undefined;
  const r = ring.getBoundingClientRect();
  const visible = r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  return visible ? ring : undefined;
}

/**
 * The picture flies from the editor's frame into your ring.
 *
 * Plain DOM rather than React: it outlives the editor it starts in, which is
 * unmounting underneath it on the same tap. Resolves when it has landed, or
 * soon after when there is no ring to land in (posting from the camera).
 */
export async function flyToRing(from: StoryFrom, media?: Blob): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Posting from a profile goes home first; give the stories row a moment to draw.
  let ring = myRing();
  for (let t = 0; !ring && t < 12; t += 1) { await new Promise((r) => setTimeout(r, 50)); ring = myRing(); }
  if (!ring) return;
  const own = !from.poster && media ? URL.createObjectURL(media) : undefined;
  const src = from.poster ?? own;

  const fly = document.createElement('div');
  Object.assign(fly.style, {
    position: 'fixed', zIndex: '1200', overflow: 'hidden', pointerEvents: 'none', borderRadius: '16px', background: '#1c1c1e',
    left: `${from.rect.left}px`, top: `${from.rect.top}px`, width: `${from.rect.width}px`, height: `${from.rect.height}px`,
    transition: 'all .55s cubic-bezier(.5,0,.2,1)',
  });
  if (src) {
    const img = document.createElement('img');
    img.src = src; img.alt = '';
    Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: from.filter || '' });
    fly.append(img);
  }
  document.body.append(fly);
  await new Promise((r) => setTimeout(r, 30));
  const r = ring.getBoundingClientRect();
  Object.assign(fly.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '50%', opacity: '.4' });
  await new Promise((res) => setTimeout(res, 560));
  fly.remove();
  if (own) URL.revokeObjectURL(own);
}

export interface UploadNote {
  at: number;
  ok: boolean;
  text: string;
  /** Defaults to a tick, or a warning when `ok` is false. */
  icon?: ReactNode;
  retry?: () => void;
}

/** "Shared to your story", or what went wrong and a way to try again. Rises in, as the sample's does. */
export function UploadToast({ note, onDone }: { note: UploadNote; onDone?: () => void }) {
  return (
    <div
      role="status"
      className={`fixed bottom-[100px] left-1/2 z-[1300] flex -translate-x-1/2 items-center gap-2 rounded-[12px] bg-white/10 px-4 py-[11px] text-[14px] font-semibold whitespace-nowrap text-white [&>svg]:size-4 ${note.retry ? '' : 'pointer-events-none'}`}
      style={{ animation: 'story-toast-in .3s' }}
    >
      <style>{'@keyframes story-toast-in { from { opacity: 0; translate: 0 20px } }'}</style>
      {note.icon ?? (note.ok ? <CircleCheck /> : <CircleAlert className="text-danger" />)}
      {note.text}
      {note.retry && (
        <button type="button" onClick={() => { onDone?.(); note.retry?.(); }} className="ml-1 font-bold text-media-accent">
          Retry
        </button>
      )}
    </div>
  );
}
