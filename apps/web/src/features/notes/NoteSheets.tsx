import { useChat, type ProfileSong } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { ChevronDown, Music2, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import { Sheet } from '../../components/Sheet.js';
import { ChatMusicPicker } from '../music/ChatMusicPicker.js';
import { ProfileSongCard } from '../music/ProfileSongCard.js';
import { NOTE_MAX, clearNote, saveNote, type Note, type NoteAudience } from './notes.js';

/**
 * Writing your note, as Instagram's "New note" page: a full page, your face in
 * the middle with the bubble above it holding the words, who it is shared with
 * underneath, and the music button at the bottom. Share is top right.
 */
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
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const can = (body.trim().length > 0 || song) && !busy;
  const who = audience === 'friends' ? 'Friends you follow back' : 'Close friends';

  const share = async () => {
    if (!can) return;
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
    <Overlay onDismiss={onClose}>
      <div className="fixed inset-0 z-500 flex flex-col bg-page pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <header className="flex h-14 shrink-0 items-center justify-between px-3">
          <button type="button" aria-label="Close" onClick={onClose} className="focus-ring grid size-10 place-items-center rounded-full text-ink">
            <X size={24} />
          </button>
          <h2 className="text-[16px] font-bold text-ink">New note</h2>
          <button
            type="button"
            disabled={!can}
            onClick={() => void share()}
            className="focus-ring h-10 px-2 text-[16px] font-bold text-brand disabled:opacity-40"
          >
            Share
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-16">
          <div className="flex flex-col items-center">
            {/* The bubble is the input: you type where it will be read. */}
            <div className="relative mb-2 w-[min(250px,76vw)] rounded-[26px] bg-surface px-5 py-3.5 text-center shadow-[0_2px_14px_rgb(16_17_20/0.2)]">
              {song && (
                <button type="button" onClick={() => setPicking(true)} className="mb-1 flex w-full items-center justify-center gap-1.5 text-[13px] text-text-secondary">
                  <Music2 size={14} className="shrink-0" />
                  <span className="truncate">{song.name} · {song.artist}</span>
                </button>
              )}
              <textarea
                autoFocus
                rows={2}
                value={body}
                maxLength={NOTE_MAX}
                onChange={(event) => setBody(event.target.value.replace(/\n/g, ' '))}
                placeholder="Share a thought..."
                aria-label="Note"
                className="block w-full resize-none bg-transparent text-center text-[17px] leading-snug text-ink outline-none placeholder:text-text-tertiary"
              />
              <span aria-hidden className="absolute -bottom-[4px] left-[28px] size-[12px] rounded-full bg-surface shadow-[0_1px_4px_rgb(16_17_20/0.2)]" />
              <span aria-hidden className="absolute -bottom-[13px] left-[18px] size-[6px] rounded-full bg-surface shadow-[0_1px_4px_rgb(16_17_20/0.2)]" />
            </div>
            <span className="mt-3 block size-[104px] overflow-hidden rounded-full">
              {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : <Avatar name={name} id={userId} size="lg" className="!size-full" />}
            </span>
          </div>

          <p className="text-[13px] text-text-tertiary tabular-nums">{body.length}/{NOTE_MAX}</p>

          <button type="button" onClick={() => setChoosing((v) => !v)} className="focus-ring flex items-center gap-1 text-[14px] font-semibold text-text-secondary">
            Shared with {who} <ChevronDown size={16} className={cn('transition-transform', choosing && 'rotate-180')} />
          </button>
          {choosing && (
            <div role="radiogroup" aria-label="Who can see it" className="-mt-3 w-full max-w-[300px] overflow-hidden rounded-2xl bg-sunken">
              {(['friends', 'close'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={audience === value}
                  onClick={() => { setAudience(value); setChoosing(false); }}
                  className="focus-ring flex h-12 w-full items-center justify-between px-4 text-[15px] text-ink"
                >
                  {value === 'friends' ? 'Friends you follow back' : 'Close friends'}
                  <span className={cn('size-5 rounded-full border-2', audience === value ? 'border-brand bg-brand shadow-[inset_0_0_0_3px_var(--color-page)]' : 'border-text-tertiary')} />
                </button>
              ))}
            </div>
          )}

          {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        </div>

        <footer className="flex shrink-0 flex-col items-center gap-3 pb-6">
          <button
            type="button"
            onClick={() => (song ? setSong(undefined) : setPicking(true))}
            className="focus-ring flex flex-col items-center gap-1.5"
          >
            <span className="grid size-14 place-items-center rounded-full bg-sunken text-ink">
              {song ? <X size={24} /> : <Music2 size={24} />}
            </span>
            <span className="text-[12px] font-semibold text-text-secondary">{song ? 'Remove song' : 'Music'}</span>
          </button>
          {mine && (
            <button type="button" onClick={() => { void clearNote(); onClose(); }} className="focus-ring flex items-center gap-1.5 text-[14px] font-semibold text-danger">
              <Trash2 size={16} /> Delete note
            </button>
          )}
        </footer>
      </div>
    </Overlay>
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
        <div className="relative max-w-[260px] rounded-[24px] bg-surface px-5 py-3 text-center text-[16px] leading-snug text-ink shadow-[0_2px_14px_rgb(16_17_20/0.2)]">
          {note.body || <span className="text-text-secondary">{note.song?.name}</span>}
          <span aria-hidden className="absolute -bottom-[4px] left-[26px] size-[11px] rounded-full bg-surface shadow-[0_1px_4px_rgb(16_17_20/0.2)]" />
          <span aria-hidden className="absolute -bottom-[12px] left-[17px] size-[6px] rounded-full bg-surface shadow-[0_1px_4px_rgb(16_17_20/0.2)]" />
        </div>
        <span className="block size-[88px] overflow-hidden rounded-full">
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
