import { useChat, type ProfileSong } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { Music2, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import { Sheet } from '../../components/Sheet.js';
import { ChatMusicPicker } from '../music/ChatMusicPicker.js';
import { ProfileSongCard } from '../music/ProfileSongCard.js';
import { CameraGlyph, CloseGlyph, MusicGlyph, QuestionGlyph } from './NoteIcons.js';
import { NOTE_MAX, clearNote, saveNote, type Note, type NoteAudience } from './notes.js';

const PROMPTS = ['Ask me anything', 'Hot take:', 'Song of the day:', 'Currently:', 'Unpopular opinion:', 'Need recs:'];

/**
 * A tile under the face, as Instagram draws them: a dark rounded rectangle with a
 * hairline border and a pink icon. The same dark in either theme; when it is on,
 * the border takes the icon's colour.
 */
function Tile({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="focus-ring grid h-[50px] w-[60px] place-items-center rounded-[16px] border bg-[#14161c] transition-transform duration-150 active:scale-90"
      style={{ borderColor: active ? '#ff2d92' : 'rgb(255 255 255 / 0.14)', boxShadow: active ? '0 0 0 1px #ff2d92 inset' : undefined }}
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
  onCamera,
}: {
  mine: Note | undefined;
  name: string;
  avatarUrl: string | undefined;
  userId: string | undefined;
  onClose: () => void;
  /** The camera tile: leaves for the story camera. */
  onCamera?: () => void;
}) {
  const [body, setBody] = useState(mine?.body ?? '');
  const [song, setSong] = useState<ProfileSong | undefined>(mine?.song);
  const [audience, setAudience] = useState<NoteAudience>(mine?.audience ?? 'friends');
  const [picking, setPicking] = useState(false);
  const [prompts, setPrompts] = useState(false);
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
            <div className="relative z-10 -mb-7 w-[min(260px,78vw)] rounded-[24px] rounded-bl-none bg-surface px-5 py-4 text-center shadow-[0_2px_16px_rgb(16_17_20/0.22)]">
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
                className="font-note block w-full resize-none bg-transparent text-center text-[21px] font-medium leading-[1.25] text-ink outline-none placeholder:text-text-tertiary"
              />
              {/* The foot: the bubble's lower-left corner runs a little lower and ends in a rounded point, as in the reference. */}
              <svg aria-hidden viewBox="0 0 18 10" className="absolute -bottom-[9px] left-0 h-[10px] w-[18px] text-surface">
                <path d="M0 0 H18 C12.5 0 10 3.4 7 7.4 C5.2 9.8 1.6 9.8 0 6.4 Z" fill="currentColor" />
              </svg>
            </div>
            <span className="block size-[168px] overflow-hidden rounded-full ring-1 ring-line">
              {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : <Avatar name={name} id={userId} size="lg" className="!size-full" />}
            </span>
          </div>

          {/* The three tiles under the face, as in the reference: the song, a prompt, the camera. */}
          <div className="flex items-center gap-3.5">
            <Tile label={song ? 'Remove song' : 'Add a song'} onClick={() => (song ? setSong(undefined) : setPicking(true))}>
              {song ? <CloseGlyph /> : <MusicGlyph />}
            </Tile>
            <Tile label="Add a prompt" onClick={() => setPrompts((v) => !v)} active={prompts}>
              <QuestionGlyph />
            </Tile>
            {onCamera && (
              <Tile label="Open the camera" onClick={() => { onClose(); onCamera(); }}>
                <CameraGlyph />
              </Tile>
            )}
          </div>

          {prompts ? (
            <div className="-mt-2 flex max-w-[330px] flex-wrap justify-center gap-2">
              {PROMPTS.map((text) => (
                <button key={text} type="button" onClick={() => { setBody((text + ' ').slice(0, NOTE_MAX)); setPrompts(false); }} className="font-note focus-ring h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink active:scale-95">
                  {text}
                </button>
              ))}
            </div>
          ) : (
            /* How much to write: a short line is the point, and the room left is always in view. */
            <div className="font-note -mt-2 flex w-[min(260px,78vw)] flex-col items-center gap-2">
              <span className="h-[3px] w-full overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full transition-[width,background-color] duration-150" style={{ width: `${Math.min(100, (body.length / NOTE_MAX) * 100)}%`, background: body.length >= NOTE_MAX - 8 ? '#ff3b5c' : 'linear-gradient(90deg, #ff3d71, #ff2d92)' }} />
              </span>
              <span className="text-[12.5px] text-text-tertiary">
                {body.length === 0 ? 'A line or two is plenty.' : body.length >= NOTE_MAX ? 'That is the limit.' : `${NOTE_MAX - body.length} left`}
              </span>
            </div>
          )}

          <button type="button" onClick={() => setAudience((a) => (a === 'friends' ? 'close' : 'friends'))} className="font-note focus-ring -mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary">
            Shared with {audience === 'friends' ? 'friends you follow back' : 'close friends'}
            <span className="text-brand">Change</span>
          </button>
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
          <svg aria-hidden viewBox="0 0 18 10" className="absolute -bottom-[9px] left-0 h-[10px] w-[18px] text-surface"><path d="M0 0 H18 C12.5 0 10 3.4 7 7.4 C5.2 9.8 1.6 9.8 0 6.4 Z" fill="currentColor" /></svg>
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
