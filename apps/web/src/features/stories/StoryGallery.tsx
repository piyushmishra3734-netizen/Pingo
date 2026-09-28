import { useAuth, useProfile, type ChatMediaItem } from '@pingo/core';
import { Camera, CloudOff, Images, LayoutTemplate, Music2, Radio, Settings, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { useStories } from './StoryContext.js';
import { deleteStoryDraft, useStoryDrafts, type StoryDraftRecord } from './story-drafts.js';

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
  const { session } = useAuth();
  const meId = session?.user.id;
  const { upload } = useStories();
  const drafts = useStoryDrafts(meId);
  const [opened, setOpened] = useState<StoryDraftRecord>();
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
          {drafts.length > 0 && (
            <section aria-label="Drafts" className="px-3.5 pb-3">
              <h2 className="flex items-center gap-1.5 pb-2 text-[13px] font-semibold text-white/70 [&>svg]:size-[14px]">
                <CloudOff />Didn't post · {drafts.length}
              </h2>
              <div className="scrollbar-none flex gap-2 overflow-x-auto">
                {drafts.map((d) => (
                  <button key={d.id} type="button" aria-label="Open draft" onClick={() => setOpened(d)} className="relative aspect-[9/16] w-[72px] shrink-0 overflow-hidden rounded-[10px] bg-media-sheet ring-1 ring-white/15">
                    <DraftThumb record={d} />
                  </button>
                ))}
              </div>
            </section>
          )}
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
      {opened && (
        <DraftSheet
          record={opened}
          onClose={() => setOpened(undefined)}
          onPost={() => { setOpened(undefined); onClose(); upload(opened.draft, undefined, opened.id); }}
          onDelete={() => { setOpened(undefined); if (meId) void deleteStoryDraft(meId, opened.id); }}
        />
      )}
    </Overlay>
  );
}

/** The draft's own picture, or the first frame of its clip. */
function DraftThumb({ record, className = 'size-full object-cover' }: { record: StoryDraftRecord; className?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(record.draft.media);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [record.draft.media]);
  if (!url) return null;
  return record.draft.kind === 'video'
    ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className={className} />
    : <img src={url} alt="" className={className} />;
}

/** One draft, large, with the two things to do with it. */
function DraftSheet({ record, onClose, onPost, onDelete }: { record: StoryDraftRecord; onClose: () => void; onPost: () => void; onDelete: () => void }) {
  const when = new Date(record.savedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <div role="dialog" aria-modal="true" aria-label="Draft" onClick={onClose} className="fixed inset-0 z-[1010] flex items-end justify-center bg-black/60 sm:items-center">
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-sm flex-col gap-4 rounded-t-[22px] bg-media-sheet px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white sm:rounded-[22px]">
        <div className="mx-auto aspect-[9/16] h-[min(46dvh,360px)] overflow-hidden rounded-[14px] bg-black">
          <DraftThumb record={record} className="size-full object-contain" />
        </div>
        <p className="text-center text-[13px] leading-snug text-white/60">
          This didn't post on {when}. It's saved on this phone until you post or delete it.
        </p>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onPost} className="bg-brand-gradient rounded-full py-3 text-[15px] font-semibold text-on-brand">
            {record.draft.audience === 'close' ? 'Post to close friends' : 'Post to your story'}
          </button>
          <button type="button" onClick={onDelete} className="flex items-center justify-center gap-1.5 rounded-full py-2.5 text-[15px] font-semibold text-danger [&>svg]:size-4">
            <Trash2 />Delete draft
          </button>
        </div>
      </div>
    </div>
  );
}
