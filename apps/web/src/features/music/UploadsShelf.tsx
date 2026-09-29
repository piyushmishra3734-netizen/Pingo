import { cn } from '@pingo/ui';
import { AudioLines, Clapperboard, Music2, Pause, Play, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { fmt, type Song } from './sheets.js';
import { deleteSong, useMySongs, useSongUpload } from './uploads.js';

/**
 * The "Uploads" shelf: your own songs, and the way to add one.
 *
 * Drawn in two tones - the chat's light panel and the camera's dark sheet -
 * because the same shelf sits in both, and a song uploaded from one is there
 * in the other.
 *
 * Adding one is: pick any audio or video from the phone, name it, upload. A
 * video's sound is taken out on the phone first; only the sound goes up.
 */

type Tone = 'light' | 'dark';

const look = {
  light: {
    row: 'hover:bg-hover',
    title: 'text-ink',
    sub: 'text-text-secondary',
    faint: 'text-text-tertiary',
    tile: 'bg-brand-soft text-brand',
    addRow: 'border border-dashed border-line-strong hover:bg-hover',
    field: 'h-11 w-full rounded-xl bg-sunken px-3.5 text-body text-ink outline-none placeholder:text-text-tertiary focus:ring-2 focus:ring-brand/40',
    primary: 'bg-brand text-on-brand',
    secondary: 'bg-sunken text-ink',
    card: 'bg-surface ring-1 ring-line',
    danger: 'text-text-tertiary hover:text-danger',
    error: 'text-danger',
  },
  dark: {
    row: 'active:bg-white/5',
    title: 'text-white',
    sub: 'text-white/55',
    faint: 'text-white/45',
    tile: 'bg-white/10 text-white',
    addRow: 'border border-dashed border-white/25 active:bg-white/5',
    field: 'h-11 w-full rounded-xl bg-media-field px-3.5 text-[15px] text-white outline-none placeholder:text-white/40',
    primary: 'bg-media-accent text-on-media-accent',
    secondary: 'bg-white/10 text-white',
    card: 'bg-white/5',
    danger: 'text-white/45 active:text-white',
    error: 'text-red-300',
  },
} satisfies Record<Tone, Record<string, string>>;

export function UploadsShelf({
  tone,
  query,
  previewing,
  onPreview,
  onSelect,
  actionIcon,
  actionLabel,
}: {
  tone: Tone;
  /** The search box, filtering your uploads by name. */
  query: string;
  /** The url playing as a preview, if any. */
  previewing?: string;
  onPreview: (song: Song) => void;
  onSelect: (song: Song) => void;
  actionIcon: ReactNode;
  actionLabel: string;
}) {
  const t = look[tone];
  const { mine, loading, loadError, retry } = useMySongs();
  const upload = useSongUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [removing, setRemoving] = useState<string>();

  // A fresh file brings its own name to start from.
  useEffect(() => {
    if (upload.prepared) { setName(upload.prepared.suggestedName); setArtist(''); }
  }, [upload.prepared]);

  const term = query.trim().toLowerCase();
  const list = (mine ?? []).filter((s) => !term || s.name.toLowerCase().includes(term) || s.artist.toLowerCase().includes(term));

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="audio/*,video/*"
      className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload.pick(f); }}
    />
  );

  // ---- naming the song, after a file is picked ------------------------------
  if (upload.prepared) {
    const busy = upload.progress !== undefined;
    return (
      <div className={cn('mx-1.5 my-1 flex flex-col gap-3 rounded-2xl p-3.5', t.card)}>
        <div className="flex items-center gap-3">
          <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', t.tile)}>
            {upload.prepared.fromVideo ? <Clapperboard size={20} /> : <AudioLines size={20} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block text-[15px] font-semibold', t.title)}>Name your song</span>
            <span className={cn('block text-[12.5px]', t.sub)}>
              {upload.prepared.fromVideo ? 'Sound from your video' : 'Audio file'} · {fmt(upload.prepared.secs)}
            </span>
          </span>
          {!busy && (
            <button type="button" aria-label="Cancel" onClick={upload.cancel} className={cn('grid size-8 place-items-center rounded-full', t.danger)}>
              <X size={18} />
            </button>
          )}
        </div>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} placeholder="Song name" aria-label="Song name" autoFocus disabled={busy} className={t.field} />
        <input value={artist} onChange={(e) => setArtist(e.target.value.slice(0, 80))} placeholder="Artist (optional)" aria-label="Artist" disabled={busy} className={t.field} />
        {upload.error && <p role="alert" className={cn('text-[12.5px]', t.error)}>{upload.error}</p>}
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void upload.send({ name, artist })}
          className={cn('relative h-11 overflow-hidden rounded-xl text-[15px] font-bold disabled:opacity-60', t.primary)}
        >
          {busy && <span aria-hidden className="absolute inset-y-0 left-0 bg-white/25 transition-[width] duration-200" style={{ width: `${Math.round((upload.progress ?? 0) * 100)}%` }} />}
          <span className="relative">{busy ? `Uploading ${Math.round((upload.progress ?? 0) * 100)}%` : 'Upload song'}</span>
        </button>
      </div>
    );
  }

  // ---- the shelf -------------------------------------------------------------
  return (
    <div className="flex flex-col">
      {input}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={upload.preparing}
        className={cn('mx-1.5 my-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors disabled:opacity-60', t.addRow)}
      >
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', t.tile)}>
          {upload.preparing ? <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-current/30 border-t-current" /> : <Upload size={20} />}
        </span>
        <span className="min-w-0">
          <span className={cn('block text-[15px] font-semibold', t.title)}>{upload.preparing ? 'Getting the sound ready…' : 'Upload a song'}</span>
          <span className={cn('block text-[12.5px]', t.sub)}>Any audio or video from your phone</span>
        </span>
      </button>
      {upload.error && <p role="alert" className={cn('px-3.5 pb-1 text-[12.5px]', t.error)}>{upload.error}</p>}

      {loading && !mine && <p className={cn('py-6 text-center text-[13px]', t.faint)}>Loading your songs…</p>}
      {loadError && !mine && (
        <p className={cn('py-6 text-center text-[13px]', t.faint)}>
          {loadError} <button type="button" onClick={retry} className="font-semibold underline">Try again</button>
        </p>
      )}
      {mine && list.length === 0 && (
        <p className={cn('px-6 py-6 text-center text-[13px]', t.faint)}>
          {term ? 'None of your songs match.' : 'Songs you upload show up here, ready for chats, stories and your profile.'}
        </p>
      )}

      {list.map((song) => (
        <div key={song.id} className={cn('flex items-center gap-2.5 rounded-xl px-1.5 py-1.5', t.row)}>
          <button
            type="button"
            onClick={() => onPreview(song)}
            aria-label={previewing === song.url ? `Stop ${song.name}` : `Play ${song.name}`}
            className={cn('relative grid size-11 shrink-0 place-items-center rounded-lg', t.tile)}
          >
            {previewing === song.url ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <span className="min-w-0 flex-1">
            <span className={cn('flex items-center gap-1.5 truncate text-[14.5px] font-medium', t.title)}>
              <Music2 size={12} className="shrink-0 opacity-60" />
              <span className="truncate">{song.name}</span>
            </span>
            <span className={cn('block truncate text-[12.5px]', t.sub)}>{[song.artist, song.secs ? fmt(song.secs) : ''].filter(Boolean).join(' · ') || 'Your upload'}</span>
          </span>
          <button
            type="button"
            aria-label={`Delete ${song.name}`}
            disabled={removing === song.id}
            onClick={() => { setRemoving(song.id); void deleteSong(song.id).catch(() => undefined).finally(() => setRemoving(undefined)); }}
            className={cn('grid size-8 shrink-0 place-items-center rounded-full disabled:opacity-40', t.danger)}
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            onClick={() => onSelect(song)}
            aria-label={`${actionLabel} ${song.name}`}
            className={cn('grid size-9 shrink-0 place-items-center rounded-full active:scale-95', t.primary)}
          >
            {actionIcon}
          </button>
        </div>
      ))}
    </div>
  );
}
