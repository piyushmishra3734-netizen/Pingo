import { useChat, type ProfileSong } from '@pingo/core';
import { Avatar, cn } from '@pingo/ui';
import { Loader2, Music2, Send, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Overlay } from '../../components/Overlay.js';
import { Sheet } from '../../components/Sheet.js';
import { ChatMusicPicker } from '../music/ChatMusicPicker.js';
import { ProfileSongCard } from '../music/ProfileSongCard.js';
import { CameraGlyph, CloseGlyph, MusicGlyph, QuestionGlyph } from './NoteIcons.js';
import {
  NOTE_BGS,
  NOTE_MAX,
  clampNote,
  clearNote,
  noteBg,
  noteLength,
  saveNote,
  timeLeft,
  type Note,
  type NoteAudience,
  type NoteBg,
} from './notes.js';

const PROMPTS = ['Ask me anything', 'Hot take:', 'Song of the day:', 'Currently:', 'Unpopular opinion:', 'Need recs:'];
const QUICK_EMOJI = ['😊', '😂', '🥹', '😎', '🔥', '💗', '🎧', '✨'];

/**
 * Notes are always dark, in either theme: they are drawn over the same dark
 * page the app uses at night (`--color-page` in dark mode), with its dark
 * surfaces, so they look like one thing with the story screens they start from.
 */
const DARK = {
  page: '#0c0d11',
  surface: '#16171d',
  sunken: '#1c1e25',
  ink: '#f4f5f9',
  muted: '#9a9dab',
  line: 'rgb(255 255 255 / 0.14)',
  pink: '#ff2d92',
} as const;

/** A bubble on the dark page: the chosen background, or the dark surface when none. */
function bubbleStyle(bg: NoteBg): React.CSSProperties {
  const look = noteBg(bg);
  return { background: look.bg || DARK.sunken, color: look.ink || DARK.ink };
}

/**
 * A tile under the face: a dark rounded rectangle with a hairline border and a
 * pink icon. When it is on, the border takes the icon's colour.
 */
function Tile({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="focus-ring grid h-[50px] w-[60px] place-items-center rounded-[16px] border transition-transform duration-150 active:scale-90"
      style={{ background: DARK.surface, borderColor: active ? DARK.pink : DARK.line, boxShadow: active ? `0 0 0 1px ${DARK.pink} inset` : undefined }}
    >
      {children}
    </button>
  );
}

/**
 * Writing your note: a dark full page, your face with the bubble above it
 * holding the words, a background to choose, who it is shared with, and the
 * music button. Share is top right. A note lasts 24 hours.
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
  const [bg, setBg] = useState<NoteBg>(mine?.bg ?? 'default');
  const [picking, setPicking] = useState(false);
  const [prompts, setPrompts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);

  const count = noteLength(body);
  const can = (body.trim().length > 0 || song) && !busy;

  const share = async () => {
    if (!can) return;
    setBusy(true);
    setError(undefined);
    const problem = await saveNote({ body, song, audience, bg });
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  const add = (text: string) => {
    setBody((current) => clampNote(current + text));
    field.current?.focus();
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
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New note"
        className="fixed inset-0 z-500 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
        style={{ background: DARK.page, color: DARK.ink }}
      >
        <header className="flex h-14 shrink-0 items-center justify-between px-3">
          <button type="button" aria-label="Close" onClick={onClose} className="focus-ring grid size-10 place-items-center rounded-full">
            <X size={24} />
          </button>
          <h2 className="text-[16px] font-bold">New note</h2>
          <button
            type="button"
            disabled={!can}
            onClick={() => void share()}
            className="focus-ring flex h-10 items-center gap-1.5 px-2 text-[16px] font-bold disabled:opacity-40"
            style={{ color: DARK.pink }}
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
            {busy ? 'Sharing' : 'Share'}
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center gap-6 overflow-y-auto px-6 pt-4 pb-10">
          <div className="flex flex-col items-center">
            {/* The bubble is the input: you type where it will be read, and the background is what the others will see. */}
            <div
              className="relative z-10 -mb-7 w-[min(280px,80vw)] rounded-[24px] rounded-bl-none px-5 py-4 text-center transition-colors duration-200"
              style={{ ...bubbleStyle(bg), border: `1px solid ${DARK.line}` }}
            >
              {song && (
                <button type="button" onClick={() => setPicking(true)} className="mb-1.5 flex w-full items-center justify-center gap-1.5 text-[13px] opacity-75">
                  <Music2 size={14} className="shrink-0" />
                  <span className="truncate">{song.name} · {song.artist}</span>
                </button>
              )}
              <textarea
                ref={field}
                autoFocus
                rows={3}
                value={body}
                onChange={(event) => setBody(clampNote(event.target.value.replace(/\n/g, ' ')))}
                placeholder="Share a thought…"
                aria-label="Note"
                className="font-note block w-full resize-none bg-transparent text-center text-[20px] font-medium leading-[1.25] outline-none placeholder:opacity-45"
              />
              <svg aria-hidden viewBox="0 0 18 10" className="absolute -bottom-[9px] left-0 h-[10px] w-[18px]" style={{ color: bubbleStyle(bg).background as string }}>
                <path d="M0 0 H18 C12.5 0 10 3.4 7 7.4 C5.2 9.8 1.6 9.8 0 6.4 Z" fill="currentColor" />
              </svg>
            </div>
            <span className="block size-[132px] overflow-hidden rounded-full" style={{ boxShadow: `0 0 0 1px ${DARK.line}` }}>
              {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : <Avatar name={name} id={userId} size="lg" className="!size-full" />}
            </span>
          </div>

          {/* How much is left: a count that turns pink when it is nearly gone. */}
          <p
            className="font-note -mt-3 text-[12.5px] tabular-nums"
            style={{ color: count >= NOTE_MAX - 10 ? DARK.pink : DARK.muted }}
            aria-live="polite"
          >
            {count}/{NOTE_MAX}
          </p>

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
            <div className="flex max-w-[330px] flex-wrap justify-center gap-2">
              {PROMPTS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => { setBody(clampNote(text + ' ')); setPrompts(false); field.current?.focus(); }}
                  className="font-note focus-ring h-9 rounded-full border px-3.5 text-[13.5px] font-semibold"
                  style={{ background: DARK.surface, borderColor: DARK.line }}
                >
                  {text}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-1.5" aria-label="Emoji">
              {QUICK_EMOJI.map((emoji) => (
                <button key={emoji} type="button" onClick={() => add(emoji)} className="focus-ring grid size-9 place-items-center rounded-full text-[20px] active:scale-90" style={{ background: DARK.surface }}>
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {/* Backgrounds: a quiet tint over the dark surface, shown as it will look. */}
          <div role="radiogroup" aria-label="Background" className="flex items-center gap-3">
            {NOTE_BGS.map((preset) => {
              const on = preset.id === bg;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={preset.label}
                  onClick={() => setBg(preset.id)}
                  className="focus-ring grid size-8 place-items-center rounded-full transition-transform duration-150 active:scale-90"
                  style={{ background: preset.bg || DARK.sunken, boxShadow: on ? `0 0 0 2px ${DARK.page}, 0 0 0 4px ${DARK.pink}` : `0 0 0 1px ${DARK.line}` }}
                />
              );
            })}
          </div>

          {/* Who sees it. */}
          <div className="flex w-[min(300px,86vw)] flex-col items-center gap-2">
            <div role="radiogroup" aria-label="Who can see this note" className="grid w-full grid-cols-2 rounded-full p-1" style={{ background: DARK.surface, border: `1px solid ${DARK.line}` }}>
              {([['friends', 'Friends'], ['close', 'Close friends']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={audience === id}
                  onClick={() => setAudience(id)}
                  className="focus-ring h-9 rounded-full text-[13.5px] font-semibold transition-colors duration-150"
                  style={audience === id ? { background: DARK.sunken, color: DARK.ink } : { color: DARK.muted }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="font-note text-center text-[12.5px]" style={{ color: DARK.muted }}>
              {audience === 'friends' ? 'Friends you follow back' : 'Only your close friends'} · gone after 24 hours
            </p>
          </div>

          {error && <p role="alert" className="max-w-[300px] text-center text-[13.5px] text-danger">{error}</p>}

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
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());

  // The time left counts down while it is open, and a note that ends meanwhile closes itself.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (note.expiresAt <= now) onClose();
  }, [note.expiresAt, now, onClose]);

  const send = async () => {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const conversationId = await (service as unknown as { startDirectConversation: (id: string) => Promise<string> }).startDirectConversation(note.userId);
      await service.sendMessage({ conversationId, body: `Replied to your note "${note.body || note.song?.name || ''}"\n${text}` });
      onClose();
      navigate(`/chats/${conversationId}`);
    } catch {
      setError('That did not send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onDismiss={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${note.name}'s note`} onClick={onClose} className="fixed inset-0 z-500 flex items-end justify-center bg-black/65 sm:items-center">
        <div
          onClick={(event) => event.stopPropagation()}
          className="flex w-full max-w-sm flex-col items-center gap-4 rounded-t-[24px] px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[24px]"
          style={{ background: DARK.page, color: DARK.ink, border: `1px solid ${DARK.line}` }}
        >
          <span aria-hidden className="h-1 w-9 rounded-full" style={{ background: DARK.line }} />
          <div className="flex w-full items-center justify-between">
            <h2 className="text-[15px] font-bold">{note.name}</h2>
            <span className="text-[12.5px]" style={{ color: DARK.muted }}>{timeLeft(note.expiresAt, now)}</span>
          </div>

          <div className="relative max-w-[280px] rounded-[24px] rounded-bl-none px-5 py-3.5 text-center text-[17px] leading-snug" style={{ ...bubbleStyle(note.bg), border: `1px solid ${DARK.line}` }}>
            {note.body || <span className="opacity-70">{note.song?.name}</span>}
            <svg aria-hidden viewBox="0 0 18 10" className="absolute -bottom-[9px] left-0 h-[10px] w-[18px]" style={{ color: bubbleStyle(note.bg).background as string }}>
              <path d="M0 0 H18 C12.5 0 10 3.4 7 7.4 C5.2 9.8 1.6 9.8 0 6.4 Z" fill="currentColor" />
            </svg>
          </div>
          <span className="block size-[88px] overflow-hidden rounded-full" style={{ boxShadow: `0 0 0 1px ${DARK.line}` }}>
            {note.avatarUrl ? <img src={note.avatarUrl} alt="" className="size-full object-cover" /> : <Avatar name={note.name} id={note.userId} size="lg" className="!size-full" />}
          </span>
          {note.song && <ProfileSongCard song={note.song} className="w-full" />}

          <form className="flex w-full items-center gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder={`Reply to ${note.name.split(' ')[0]}…`}
              aria-label="Reply"
              className="focus-ring h-12 min-w-0 flex-1 rounded-full px-4 text-[16px] placeholder:opacity-45"
              style={{ background: DARK.surface, border: `1px solid ${DARK.line}`, color: DARK.ink }}
            />
            <button
              type="submit"
              aria-label="Send reply"
              disabled={!reply.trim() || busy}
              className={cn('focus-ring grid size-12 shrink-0 place-items-center rounded-full text-white transition-opacity disabled:opacity-40')}
              style={{ background: DARK.pink }}
            >
              {busy ? <Loader2 size={19} className="animate-spin" /> : <Send size={19} />}
            </button>
          </form>
          {error && <p role="alert" className="text-center text-[13px] text-danger">{error}</p>}
        </div>
      </div>
    </Overlay>
  );
}
