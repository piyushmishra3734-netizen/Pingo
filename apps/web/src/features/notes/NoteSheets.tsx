import { useChat, type ProfileSong } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { Music2, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Sheet } from '../../components/Sheet.js';
import { ChatMusicPicker } from '../music/ChatMusicPicker.js';
import { ProfileSongCard } from '../music/ProfileSongCard.js';
import { NOTE_MAX, clearNote, saveNote, type Note, type NoteAudience } from './notes.js';

/** Writing your note: words, a song, who sees it. Shown over the tray like Instagram's. */
export function NoteComposeSheet({
  mine,
  name,
  avatarUrl,
  userId,
  onClose,
}: {
  mine: Note | undefined;
  name: string;
  avatarUrl: string | undefined;
  userId: string | undefined;
  onClose: () => void;
}) {
  const [body, setBody] = useState(mine?.body ?? '');
  const [song, setSong] = useState<ProfileSong | undefined>(mine?.song);
  const [audience, setAudience] = useState<NoteAudience>(mine?.audience ?? 'friends');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const can = (body.trim().length > 0 || song) && !busy;

  const share = async () => {
    setBusy(true);
    const problem = await saveNote({ body, song, audience });
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  if (picking) {
    return (
      <Sheet title="Add a song" onClose={() => setPicking(false)}>
        <div className="-mx-2 mt-2">
          <ChatMusicPicker
            pick
            onSelect={(picked) => {
              setSong({ name: picked.name, artist: picked.artist, img: picked.img, url: picked.url, secs: picked.secs });
              setPicking(false);
            }}
          />
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="New note" description="Shown on your circle for 24 hours." onClose={onClose}>
      <div className="flex flex-col items-center gap-3 pt-2">
        {/* What it will look like: the face with the bubble above it. */}
        <div className="flex flex-col items-center">
          <div className="relative mb-1 max-w-[220px] min-w-[96px] rounded-[18px] bg-surface px-3.5 py-2 text-center text-[14px] leading-snug text-ink shadow-[0_4px_16px_-6px_rgb(16_17_20/0.3)] ring-1 ring-line">
            {song && (
              <span className="mb-0.5 flex items-center justify-center gap-1 text-[12px] font-semibold text-brand">
                <Music2 size={12} /> <span className="truncate">{song.name}</span>
              </span>
            )}
            <span className={cn('block break-words', !body && 'text-text-tertiary')}>{body || 'Share a thought…'}</span>
            <span aria-hidden className="absolute -bottom-[5px] left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-surface ring-1 ring-line" />
          </div>
          <span className="mt-2 block size-[72px] overflow-hidden rounded-full">
            {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : <Avatar name={name} id={userId} size="lg" className="!size-full" />}
          </span>
        </div>

        <label className="relative block w-full">
          <span className="sr-only">Note</span>
          <input
            autoFocus
            value={body}
            maxLength={NOTE_MAX}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Share a thought…"
            className="focus-ring h-12 w-full rounded-2xl bg-sunken px-4 pr-14 text-[16px] text-ink placeholder:text-text-tertiary"
          />
          <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[12px] text-text-tertiary tabular-nums">
            {body.length}/{NOTE_MAX}
          </span>
        </label>

        {song ? (
          <div className="flex w-full items-center gap-2">
            <ProfileSongCard song={song} className="min-w-0 flex-1" />
            <button type="button" aria-label="Remove song" onClick={() => setSong(undefined)} className="focus-ring grid size-10 shrink-0 place-items-center rounded-full bg-sunken text-text-secondary">
              <X size={18} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setPicking(true)} className="focus-ring flex h-12 w-full items-center gap-3 rounded-2xl bg-sunken px-3 text-left">
            <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-brand"><Music2 size={17} /></span>
            <span className="text-[15px] font-medium text-ink">Add a song</span>
          </button>
        )}

        <div role="radiogroup" aria-label="Who can see it" className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-sunken p-1">
          {(['friends', 'close'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={audience === value}
              onClick={() => setAudience(value)}
              className={cn(
                'focus-ring h-10 rounded-xl text-[14px] font-semibold transition-colors',
                audience === value ? 'bg-surface text-ink shadow-sm' : 'text-text-secondary',
              )}
            >
              {value === 'friends' ? 'Friends' : 'Close friends'}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="text-caption text-danger">{error}</p>}

        <button
          type="button"
          disabled={!can}
          onClick={() => void share()}
          className="focus-ring h-12 w-full rounded-2xl bg-brand text-[16px] font-bold text-on-brand transition-opacity disabled:opacity-40"
        >
          {mine ? 'Update note' : 'Share note'}
        </button>
        {mine && (
          <button
            type="button"
            onClick={() => { void clearNote(); onClose(); }}
            className="focus-ring flex h-10 items-center gap-2 text-[14px] font-semibold text-danger"
          >
            <Trash2 size={16} /> Delete note
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** Someone else's note: the words, the song to play, and a reply that lands in your chat with them. */
export function NoteViewSheet({ note, onClose }: { note: Note; onClose: () => void }) {
  const { service } = useChat();
  const navigate = useNavigate();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const conversationId = await (service as unknown as { startDirectConversation: (id: string) => Promise<string> }).startDirectConversation(note.userId);
      await service.sendMessage({ conversationId, body: `Replied to your note "${note.body || note.song?.name || ''}"\n${text}` });
      onClose();
      navigate(`/chats/${conversationId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={`${note.name}'s note`} onClose={onClose}>
      <div className="flex flex-col items-center gap-4 pt-2 pb-1">
        <div className="relative max-w-[260px] rounded-[20px] bg-surface px-4 py-2.5 text-center text-[16px] leading-snug text-ink shadow-[0_4px_16px_-6px_rgb(16_17_20/0.3)] ring-1 ring-line">
          {note.body || <span className="text-text-secondary">{note.song?.name}</span>}
          <span aria-hidden className="absolute -bottom-[5px] left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-surface ring-1 ring-line" />
        </div>
        <span className="block size-[76px] overflow-hidden rounded-full">
          {note.avatarUrl ? <img src={note.avatarUrl} alt="" className="size-full object-cover" /> : <Avatar name={note.name} id={note.userId} size="lg" className="!size-full" />}
        </span>
        {note.song && <ProfileSongCard song={note.song} className="w-full" />}
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(event) => { event.preventDefault(); void send(); }}
        >
          <input
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder={`Reply to ${note.name.split(' ')[0]}…`}
            className="focus-ring h-12 min-w-0 flex-1 rounded-full bg-sunken px-4 text-[16px] text-ink placeholder:text-text-tertiary"
          />
          <button type="submit" aria-label="Send reply" disabled={!reply.trim() || busy} className="focus-ring grid size-12 shrink-0 place-items-center rounded-full bg-brand text-on-brand disabled:opacity-40">
            <Send size={19} />
          </button>
        </form>
      </div>
    </Sheet>
  );
}
