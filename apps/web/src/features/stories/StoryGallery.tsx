import { useProfile, type ChatMediaItem } from '@pingo/core';
import { Camera, Images, LayoutTemplate, Music2, Radio, Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';

/**
 * "Add to story", the stories sample's gallery (`.gal`): a black screen, the
 * camera first, then pictures to start from, in tall tiles three across.
 *
 * A web page cannot read the phone's camera roll, so the tile after the camera
 * opens it, and the rest are photos from your own chats - pictures you already
 * have. Templates starts a story on colour, Music starts it with a song, and
 * Collage picks several at once.
 */
export function StoryGallery({ onClose, onCamera, onGallery, onPick, onTemplate, onMusic, onCollage, onLive, onSettings }: {
  onClose: () => void;
  onCamera: () => void;
  /** The phone's own picker, one picture or clip. */
  onGallery: () => void;
  /** A photo from a chat. */
  onPick: (url: string) => void;
  onTemplate: () => void;
  onMusic: () => void;
  onCollage: () => void;
  /** Going live starts here too, when it is offered. */
  onLive?: () => void;
  onSettings: () => void;
}) {
  const { service } = useProfile();
  const [photos, setPhotos] = useState<ChatMediaItem[]>([]);
  useEffect(() => {
    let live = true;
    service.listChatMedia(60).then((list) => { if (live) setPhotos(list); }).catch(() => undefined);
    return () => { live = false; };
  }, [service]);

  const tab = 'inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-white/10 px-3 py-[7px] text-[13px] font-semibold [&>svg]:size-[14px]';
  return (
    <Overlay onDismiss={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Add to story" className="fixed inset-0 z-1000 flex flex-col bg-black text-white" style={{ animation: 'gal-up .3s cubic-bezier(.2,.8,.2,1)' }}>
        <style>{'@keyframes gal-up { from { transform: translateY(40px); opacity: 0 } }'}</style>
        <div className="mx-auto flex h-full w-full max-w-[calc(100dvh*0.5)] flex-col">
          <header className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5 text-[17px] font-bold">
            <button type="button" aria-label="Close" onClick={onClose} className="grid size-6 place-items-center [&>svg]:size-[22px]"><X /></button>
            <span>Add to story</span>
            <span className="flex-1" />
            <button type="button" aria-label="Story settings" onClick={onSettings} className="grid size-6 place-items-center [&>svg]:size-5"><Settings /></button>
          </header>
          <div className="scrollbar-none flex gap-2 overflow-x-auto px-3.5 pb-2.5">
            <button type="button" onClick={onTemplate} className={tab}><LayoutTemplate />Templates</button>
            <button type="button" onClick={onMusic} className={tab}><Music2 />Music</button>
            <button type="button" onClick={onCollage} className={tab}><Images />Collage</button>
            {onLive && <button type="button" onClick={onLive} className={tab}><Radio className="text-danger" />Live</button>}
          </div>
          <div className="scrollbar-none grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-0.5 overflow-y-auto">
            {/* Named, not just drawn: two dark tiles with a glyph each read as something still loading. */}
            <button type="button" onClick={onCamera} className="flex aspect-[9/16] flex-col items-center justify-center gap-2 bg-media-sheet text-[13px] font-semibold active:bg-white/10 [&>svg]:size-[30px]"><Camera />Camera</button>
            <button type="button" onClick={onGallery} className="flex aspect-[9/16] flex-col items-center justify-center gap-2 bg-media-sheet text-[13px] font-semibold active:bg-white/10 [&>svg]:size-[30px]"><Images />Your photos</button>
            {photos.length === 0 && (
              /*
               * Without this the rest of the screen was plain black, which looks
               * like a gallery that failed to load rather than one with nothing
               * in it yet.
               */
              <p className="col-span-3 px-6 pt-8 text-center text-[13px] leading-relaxed text-white/55">
                Photos you share in chats show up here, ready to add to your story.
              </p>
            )}
            {photos.map((p) => (
              <button key={p.id} type="button" onClick={() => onPick(p.url)} className="relative aspect-[9/16] overflow-hidden bg-media-sheet">
                <img src={p.url} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
