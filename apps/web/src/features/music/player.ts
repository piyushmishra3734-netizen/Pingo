import { useSyncExternalStore } from 'react';
import { claimAudio } from '../../lib/audio-focus.js';
import { clearNowPlaying, showNowPlaying, type ControlAction } from '../native/media-controls.js';

import type { SharedSong } from './song-share.js';

/**
 * The one music player, for the whole app - Telegram's way.
 *
 * A song started from a card in a chat keeps playing when you leave the chat,
 * open settings, or look at a profile, and it stops only when you stop it. So
 * the audio cannot belong to the card that started it: the card goes away with
 * its screen. It lives here, once, and the cards, the bar at the top and the
 * phone's lock-screen controls are all views of it.
 */

export interface PlayerState {
  song?: SharedSong;
  playing: boolean;
  loading: boolean;
  failed: boolean;
  /** Seconds in. */
  at: number;
  /** Seconds long, once known; the length the song was sent with before that. */
  length: number;
  speed: number;
}

let state: PlayerState = { playing: false, loading: false, failed: false, at: 0, length: 0, speed: 1 };

/**
 * A queue driving the player (PINGO Music, `saavn/playback.ts`), when there is
 * one. Without it a song plays once and stops, as a song card in a chat does;
 * with it the end of a song moves the queue on, and the phone's next and
 * previous buttons work.
 */
export interface QueueControls {
  next(auto: boolean): void;
  prev(): void;
}
let queue: QueueControls | undefined;
export function setQueueControls(controls: QueueControls | undefined) {
  queue = controls;
  // The phone's Next button comes and goes with the queue.
  if (state.song) { mediaSession(state.song); syncPhone(); }
}
const listeners = new Set<() => void>();
let audio: HTMLAudioElement | undefined;

function set(changes: Partial<PlayerState>) {
  state = { ...state, ...changes };
  listeners.forEach((fn) => fn());
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'auto';
  a.addEventListener('timeupdate', () => set({ at: a.currentTime }));
  a.addEventListener('loadedmetadata', () => { if (Number.isFinite(a.duration)) set({ length: a.duration }); syncPhone(); });
  a.addEventListener('playing', () => { set({ playing: true, loading: false, failed: false }); syncPhone(); });
  a.addEventListener('waiting', () => set({ loading: true }));
  a.addEventListener('pause', () => { set({ playing: false }); syncPhone(); });
  a.addEventListener('seeked', syncPhone);
  a.addEventListener('ratechange', syncPhone);
  a.addEventListener('ended', () => {
    if (queue) { queue.next(true); return; }
    a.currentTime = 0;
    set({ playing: false, at: 0 });
  });
  a.addEventListener('error', () => { if (a.src) set({ playing: false, loading: false, failed: true }); });
  audio = a;
  return a;
}

/** A press on the phone's player (Android app), handed to the same controls as the screen's. */
function onPhoneAction(action: ControlAction, positionMs?: number) {
  if (action === 'play') void musicPlayer.resume();
  else if (action === 'pause') musicPlayer.pause();
  else if (action === 'next') queue?.next(false);
  else if (action === 'prev') { if (queue) queue.prev(); else musicPlayer.seek(0); }
  else if (action === 'stop') musicPlayer.close();
  else if (action === 'seek' && positionMs !== undefined) musicPlayer.seek(positionMs / 1000);
}

/**
 * Tells the phone where the song is: play or pause, how far in, how long.
 *
 * Called on the moments that change it (play, pause, seek, speed, length
 * known), not on every tick: the phone runs the clock itself from the
 * position and speed. Without this the browser's player had no seek bar and
 * could show Play while the song was playing.
 */
function syncPhone() {
  const song = state.song;
  if (!song) return;
  const a = audio;
  const at = a ? a.currentTime : state.at;
  const length = a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : state.length;
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (session) {
    try {
      session.playbackState = state.playing ? 'playing' : 'paused';
      if (length > 0) session.setPositionState({ duration: length, position: Math.min(at, length), playbackRate: state.speed });
    } catch {
      // An older browser without position state: the rest still works.
    }
  }
  showNowPlaying(
    {
      title: song.name,
      artist: song.artist,
      artwork: song.img,
      playing: state.playing,
      positionMs: Math.round(at * 1000),
      durationMs: Math.round(length * 1000),
      speed: state.speed,
      hasNext: Boolean(queue),
      hasPrev: true,
    },
    onPhoneAction,
  );
}

/** The phone's own controls - lock screen, notification shade, headphones. */
function mediaSession(song: SharedSong) {
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!session) return;
  try {
    session.metadata = new MediaMetadata({
      title: song.name,
      artist: song.artist,
      album: 'PINGO Music',
      ...(song.img ? { artwork: [96, 192, 256, 512].map((n) => ({ src: song.img, sizes: `${n}x${n}` })) } : {}),
    });
    session.setActionHandler('play', () => { void musicPlayer.resume(); });
    session.setActionHandler('pause', () => musicPlayer.pause());
    session.setActionHandler('seekbackward', () => musicPlayer.seek(state.at - 10));
    session.setActionHandler('seekforward', () => musicPlayer.seek(state.at + 10));
    session.setActionHandler('seekto', (d) => { if (d.seekTime !== undefined) musicPlayer.seek(d.seekTime); });
    session.setActionHandler('stop', () => musicPlayer.close());
    session.setActionHandler('nexttrack', queue ? () => queue?.next(false) : null);
    session.setActionHandler('previoustrack', () => { if (queue) queue.prev(); else musicPlayer.seek(0); });
  } catch {
    // Some browsers know the API but not every action. The in-app controls still work.
  }
}

export const musicPlayer = {
  /** Plays this song, from where it was if it is already the one loaded. */
  play(song: SharedSong) {
    const a = element();
    if (state.song?.url !== song.url) {
      a.src = song.url;
      a.currentTime = 0;
      set({ song, at: 0, length: song.secs, failed: false });
      mediaSession(song);
    }
    return musicPlayer.resume();
  },
  async resume() {
    const a = element();
    if (!state.song) return;
    set({ loading: true, failed: false });
    a.playbackRate = state.speed;
    try {
      claimAudio(a);
      await a.play();
    } catch {
      set({ loading: false, failed: true });
    }
  },
  pause() {
    audio?.pause();
  },
  toggle(song: SharedSong) {
    if (state.song?.url === song.url && state.playing) musicPlayer.pause();
    else void musicPlayer.play(song);
  },
  seek(to: number) {
    const a = element();
    const t = Math.min(Math.max(0, to), state.length || a.duration || 0);
    a.currentTime = t;
    set({ at: t });
  },
  setSpeed(speed: number) {
    if (audio) audio.playbackRate = speed;
    set({ speed });
  },
  /** Stops and forgets the song - the bar at the top goes with it. */
  close() {
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    set({ song: undefined, playing: false, loading: false, failed: false, at: 0, length: 0 });
    if (typeof navigator !== 'undefined' && navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
    clearNowPlaying();
  },
};

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => state;

/** For code outside React (the queue) that has to follow the player. */
export const watchPlayer = subscribe;
export const playerState = snapshot;

export function useMusicPlayer(): PlayerState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
