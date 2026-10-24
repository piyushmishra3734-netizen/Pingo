import { useChat, type ProfileSong } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { Music2, Send, Smile, Star, Trash2, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import { Sheet } from '../../components/Sheet.js';
import { ChatMusicPicker } from '../music/ChatMusicPicker.js';
import { ProfileSongCard } from '../music/ProfileSongCard.js';
import { NOTE_MAX, clearNote, saveNote, type Note, type NoteAudience } from './notes.js';

const QUICK_EMOJI = ['😊', '😂', '🥹', '😍', '😎', '🥳', '😴', '😩', '❤️', '🔥', '✨', '🎧', '🌧️', '☕', '🎲', '🙏'];

/** A square outlined tile with a brand-coloured icon, as under the face in Instagram's composer. */
function Tile({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'focus-ring grid size-[56px] place-items-center rounded-[18px] border text-brand transition-transform active:scale-90',
        active ? 'border-brand bg-brand-soft' : 'border-line bg-surface',
      )}
    >
      {children}
    </button>
  );
}

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
  const [emojis, setEmojis] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const can = (body.trim().length > 0 || song) && !busy;
  const who = audience === 'friends' ? 'friends' : 'close friends';

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

        <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6 pb-20">
          <div className="flex flex-col items-center">
            {/*
              The bubble is the input: you type where it will be read. It rests on
              the top of the face and its tail points down into it, the way the
              reference draws it.
            */}
            <div className="relative z-10 -mb-7 w-[min(260px,78vw)] rounded-[24px] bg-surface px-5 py-4 text-center shadow-[0_2px_16px_rgb(16_17_20/0.22)]">
              {song && (
                <button type="button" onClick={() => setPicking(true)} className="mb-1.5 flex w-full items-center justify-center gap-1.5 text-[13px] text-text-secondary">
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
                className="block w-full resize-none bg-transparent text-center text-[21px] leading-[1.25] text-ink outline-none placeholder:text-text-tertiary"
              />
              {/* The flick at the lower left: a corner of the bubble running down to a point. */}
              <span aria-hidden className="absolute -bottom-[9px] left-[22px] h-[14px] w-[16px] bg-surface" style={{ clipPath: 'polygon(0 100%, 100% 0, 100% 100%)', filter: 'drop-shadow(0 3px 3px rgb(16 17 20 / 0.08))' }} />
            </div>
            <span className="block size-[168px] overflow-hidden rounded-full ring-1 ring-line">
              {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : <Avatar name={name} id={userId} size="lg" className="!size-full" />}
            </span>
          </div>

          {/* Three tiles under the face: the song, who sees it, a quick emoji. */}
          <div className="flex items-center gap-4">
            <Tile label={song ? 'Remove song' : 'Add a song'} onClick={() => (song ? setSong(undefined) : setPicking(true))}>
              {song ? <X size={22} /> : <Music2 size={22} />}
            </Tile>
            <Tile label={`Shared with ${who}`} onClick={() => setAudience((a) => (a === 'friends' ? 'close' : 'friends'))} active={audience === 'close'}>
              {audience === 'close' ? <Star size={22} fill="currentColor" /> : <Users size={22} />}
            </Tile>
            <Tile label="Add an emoji" onClick={() => setEmojis((v) => !v)} active={emojis}>
              <Smile size={22} />
            </Tile>
          </div>

          {emojis && (
            <div className="-mt-3 flex max-w-[320px] flex-wrap justify-center gap-1">
              {QUICK_EMOJI.map((e) => (
                <button key={e} type="button" aria-label={`Add ${e}`} onClick={() => setBody((b) => (b + e).slice(0, NOTE_MAX))} className="focus-ring grid size-10 place-items-center rounded-xl text-[22px] active:scale-90">
                  {e}
                </button>
              ))}
            </div>
          )}

          <p className="text-[13px] text-text-tertiary">
            <span className="tabular-nums">{body.length}/{NOTE_MAX}</span> · Shared with {who} for 24 hours
          </p>
          {error && <p role="alert" className="text-caption text-danger">{error}</p>}

          {mine && (
            <button type="button" onClick={() => { void clearNote(); onClose(); }} className="focus-ring flex items-center gap-1.5 text-[14px] font-semibold text-danger">
              <Trash2 size={16} /> Delete note
            </button>
          )}
        </div>
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
