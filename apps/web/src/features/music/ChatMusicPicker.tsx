import { SearchField, cn } from '@pingo/ui';
import { Pause, Play, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { MUSIC_TABS, fetchSongs, type Song } from './sheets.js';

/**
 * The Music tab beside Emoji and Stickers: find a song, hear a bit of it, send
 * it. The same catalogue the story editor uses, drawn in the chat's own light
 * panel rather than the camera's dark one.
 */
export function ChatMusicPicker({ onSelect }: { onSelect: (song: Song) => void }) {
  const [shelf, setShelf] = useState('');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Song[]>();
  const [previewing, setPreviewing] = useState<string>();
  const audio = useRef<HTMLAudioElement | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const wanted = query.trim() || shelf;
    setList(undefined);
    const timer = window.setTimeout(() => {
      void fetchSongs(wanted).then((songs) => { if (live) setList(songs); });
    }, query ? 350 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, shelf]);

  useEffect(() => () => { audio.current?.pause(); }, []);

  const preview = (song: Song) => {
    const a = (audio.current ??= new Audio());
    if (previewing === song.url) { a.pause(); setPreviewing(undefined); return; }
    a.src = song.url;
    a.currentTime = song.start;
    void a.play().catch(() => setPreviewing(undefined));
    setPreviewing(song.url);
  };

  return (
    <div className="flex h-[320px] flex-col">
      <div className="px-2.5 pt-2.5">
        <SearchField value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search music" aria-label="Search music" />
      </div>
      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-2.5 py-2">
        {MUSIC_TABS.map(([label, value]) => (
          <button
            key={label}
            type="button"
            onClick={() => { setQuery(''); setShelf(value); }}
            className={cn(
              'focus-ring shrink-0 rounded-full px-3 py-1 text-caption font-semibold transition-colors duration-instant',
              !query && shelf === value ? 'bg-ink text-page' : 'bg-sunken text-text-secondary',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {!list && <p className="py-8 text-center text-caption text-text-tertiary">Loading songs…</p>}
        {list?.length === 0 && <p className="py-8 text-center text-caption text-text-tertiary">No songs found.</p>}
        {list?.map((song) => (
          <div key={song.url} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-hover">
            <button type="button" onClick={() => preview(song)} aria-label={previewing === song.url ? `Stop ${song.name}` : `Play ${song.name}`} className="focus-ring relative size-11 shrink-0 overflow-hidden rounded-lg">
              {song.img && <img src={song.img} alt="" className="size-full object-cover" />}
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
              aria-label={`Send ${song.name}`}
              className="focus-ring grid size-9 shrink-0 place-items-center rounded-full bg-brand text-on-brand active:scale-95"
            >
              <Send size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
