import { SearchField, cn } from '@pingo/ui';
import { Check, Pause, Play, Send, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { claimAudio } from '../../lib/audio-focus.js';

import { MUSIC_SHELVES, More, PlaylistRow, UPLOADS, useCatalogue } from './catalogue.js';
import type { Song } from './sheets.js';
import { UploadsShelf } from './UploadsShelf.js';

/**
 * The Music tab beside Emoji and Stickers: find a song, hear a bit of it, send
 * it. The same catalogue the story editor uses, drawn in the chat's own light
 * panel rather than the camera's dark one.
 */
export function ChatMusicPicker({ onSelect, pick = false }: { onSelect: (song: Song) => void; /** Choosing, not sending: a tick instead of the send arrow. */ pick?: boolean }) {
  const cat = useCatalogue();
  const { query, uploads } = cat;
  const list = cat.songs.items;
  const [previewing, setPreviewing] = useState<string>();
  const audio = useRef<HTMLAudioElement | undefined>(undefined);

  useEffect(() => () => { audio.current?.pause(); }, []);

  const preview = (song: Song) => {
    let a = audio.current;
    if (!a) {
      a = new Audio();
      // Paused from elsewhere - another song took the speaker - shows as paused here too.
      a.addEventListener('pause', () => setPreviewing(undefined));
      audio.current = a;
    }
    if (previewing === song.url) { a.pause(); setPreviewing(undefined); return; }
    a.src = song.url;
    /*
     * From the top. `start` is where a story's 15-second clip begins (30s in
     * by default) and has nothing to do with listening to a song in a chat,
     * which is why the preview here used to begin halfway through a verse.
     */
    a.currentTime = 0;
    claimAudio(a);
    void a.play().catch(() => setPreviewing(undefined));
    setPreviewing(song.url);
  };

  return (
    /*
     * Tall enough to browse. At a fixed 320px the search, the shelf chips and
     * the album/playlist row left room for about one and a half songs, so a
     * list of hundreds read as "only a couple of songs, and it will not scroll".
     */
    <div className="flex h-[min(560px,62dvh)] min-h-[320px] flex-col">
      <div className="px-2.5 pt-2.5">
        <SearchField value={query} onChange={(e) => cat.setQuery(e.target.value)} placeholder="Search music" aria-label="Search music" />
      </div>
      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-2.5 py-2">
        {MUSIC_SHELVES.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => cat.setShelf(s)}
            className={cn(
              'focus-ring flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-caption font-semibold transition-colors duration-instant',
              cat.shelf === s && (uploads || !query) ? 'bg-ink text-page' : 'bg-sunken text-text-secondary',
            )}
          >
            {s.src === UPLOADS && <Upload size={12} />}
            {s.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {uploads && (
          <UploadsShelf
            tone="light"
            query={query}
            {...(previewing ? { previewing } : {})}
            onPreview={preview}
            onSelect={(song) => { audio.current?.pause(); onSelect(song); }}
            actionIcon={pick ? <Check size={17} /> : <Send size={16} />}
            actionLabel={pick ? 'Choose' : 'Send'}
          />
        )}
        {!uploads && <PlaylistRow pager={cat.lists} tone="light" onOpen={cat.toggleOpen} {...(cat.open ? { open: cat.open } : {})} />}
        {!uploads && !list && <p className="py-8 text-center text-caption text-text-tertiary">Loading songs…</p>}
        {!uploads && list?.length === 0 && cat.songs.done && <p className="py-8 text-center text-caption text-text-tertiary">No songs found.</p>}
        {!uploads && list?.map((song) => (
          <div key={song.url} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-hover">
            <button type="button" onClick={() => preview(song)} aria-label={previewing === song.url ? `Stop ${song.name}` : `Play ${song.name}`} className="focus-ring relative size-11 shrink-0 overflow-hidden rounded-lg">
              {song.img && <img src={song.img} alt="" loading="lazy" className="size-full object-cover" />}
              <span className="absolute inset-0 grid place-items-center bg-black/30 text-white">
                {previewing === song.url ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
              </span>
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-ink">{song.name}</span>
              <span className="block truncate text-caption text-text-secondary">{song.artist}</span>
            </span>
            <button
              type="button"
              onClick={() => { audio.current?.pause(); onSelect(song); }}
              aria-label={`${pick ? 'Choose' : 'Send'} ${song.name}`}
              className="focus-ring grid size-9 shrink-0 place-items-center rounded-full bg-brand text-on-brand active:scale-95"
            >
              {pick ? <Check size={17} /> : <Send size={16} />}
            </button>
          </div>
        ))}
        {!uploads && <More pager={cat.songs} tone="light" />}
      </div>
    </div>
  );
}
