import { ArrowRight, Play, Shuffle, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { useMusicPlayer } from '../player.js';
import * as downloads from '../saavn/downloads.js';
import * as playback from '../saavn/playback.js';
import { MiniPlayer } from './MiniPlayer.js';
import { NowPlaying } from './NowPlaying.js';
import { SongRow, plural, useCoverTone, useOffline } from './parts.js';

/**
 * What PINGO opens to with no internet, when there are songs on the phone:
 * YouTube's way, the downloads first.
 *
 * Chats still open from here (they are kept on the phone too), but a person
 * opening an app on a train with no signal mostly wants something to listen
 * to, and this is the one part of PINGO that works fully offline. So it is
 * offered first, with the way into the rest of the app one tap away.
 *
 * Nothing here touches the network. The songs, their covers and their details
 * all come from the phone (`saavn/downloads.ts`), and the player plays the
 * kept file.
 */
export default function OfflineMusic({ onClose }: { onClose: () => void }) {
  const dl = downloads.useDownloads();
  const offline = useOffline();
  const player = useMusicPlayer();
  const queue = playback.useQueue();
  const current = playback.Q.current(queue);
  const now = current && player.song ? current : undefined;
  const tone = useCoverTone(downloads.useCover(now?.id, now?.image)) ?? '112,104,136';
  const [np, setNp] = useState(false);
  const [toastText, setToastText] = useState<string>();
  const songs = Object.values(dl.done)
    .sort((a, b) => b.at - a.at)
    .map((d) => d.song);
  const source = { kind: 'list' as const, label: 'Downloads' };

  const toast = useCallback((t: string) => setToastText(t), []);
  useEffect(() => {
    if (!toastText) return undefined;
    const t = window.setTimeout(() => setToastText(undefined), 1900);
    return () => window.clearTimeout(t);
  }, [toastText]);

  return (
    <div
      role="dialog"
      aria-label="Your downloads"
      style={{ '--pm-tone': tone } as CSSProperties}
      className="fixed inset-0 z-[600] flex flex-col overflow-clip bg-surface text-ink"
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-[rgba(var(--pm-tone),0.16)] to-transparent" />

      <header className="relative flex shrink-0 items-center gap-2 px-[18px] pb-2 pt-[max(14px,env(safe-area-inset-top))]">
        <img src="/pingo-mark.svg" alt="" className="size-6" draggable={false} />
        <span className="text-[19px] font-medium tracking-[-0.01em]">
          pingo <span className="font-normal text-text-secondary">music</span>
        </span>
        <button type="button" onClick={onClose} className="ml-auto flex h-9 items-center gap-1 rounded-full px-3 text-[13.5px] font-medium text-text-secondary active:bg-sunken">
          Open PINGO
          <ArrowRight size={16} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-32">
        <div className="mx-[18px] mt-3 flex items-center gap-3.5 rounded-2xl bg-sunken p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface">
            {offline ? <WifiOff size={21} className="text-text-secondary" /> : <Wifi size={21} className="text-[rgb(var(--pm-tone))]" />}
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[15.5px] font-semibold">{offline ? "You're offline" : "You're back online"}</b>
            <small className="block text-[13px] leading-snug text-text-secondary">
              {offline ? 'Your downloads still play. Everything else waits for the internet.' : 'Everything in PINGO works again.'}
            </small>
          </span>
          {!offline && (
            <button type="button" onClick={onClose} className="h-9 shrink-0 rounded-full bg-ink px-3.5 text-[13.5px] font-semibold text-page">
              Continue
            </button>
          )}
        </div>

        <div className="mx-[18px] mt-7 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">Downloads</h1>
            <p className="text-[13px] text-text-secondary">
              {plural(songs.length, 'song', 'songs')} · {downloads.formatBytes(downloads.totalBytes(dl))}
            </p>
          </div>
          <button
            type="button"
            aria-label="Shuffle"
            disabled={!songs.length}
            onClick={() => {
              if (!playback.isShuffling()) playback.toggleShuffle();
              playback.playList(songs, Math.floor(Math.random() * songs.length), source);
            }}
            className="grid size-11 place-items-center rounded-full bg-sunken disabled:opacity-40"
          >
            <Shuffle size={20} />
          </button>
          <button
            type="button"
            disabled={!songs.length}
            onClick={() => playback.playList(songs, 0, source)}
            className="flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14.5px] font-semibold text-page disabled:opacity-40"
          >
            <Play size={18} className="fill-current" />
            Play
          </button>
        </div>

        <div className="mt-3 px-2">
          {songs.map((s, i) => (
            <SongRow key={s.id} song={s} now={s.id === now?.id} paused={!player.playing} onPlay={() => (s.id === now?.id ? playback.toggleCurrent() : playback.playList(songs, i, source))} />
          ))}
        </div>
      </div>

      {toastText && (
        <div role="status" className="pointer-events-none absolute inset-x-0 bottom-[92px] z-20 flex justify-center">
          <span className="animate-[pm-toast_1900ms_var(--ease-standard)_both] rounded-full bg-ink px-4 py-2 text-[13.5px] font-medium text-page shadow-lg">{toastText}</span>
        </div>
      )}

      {now && <MiniPlayer song={now} onOpen={() => setNp(true)} toast={toast} />}
      <NowPlaying open={np} onClose={() => setNp(false)} toast={toast} />
    </div>
  );
}
