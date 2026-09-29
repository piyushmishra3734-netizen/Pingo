import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { encodePcmToWavBlob } from '../../lib/audio/wav.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { decodeSound } from '../stories/story-audio.js';
import type { Song } from './sheets.js';

/**
 * Songs people upload themselves: the "Uploads" shelf.
 *
 * The catalogue behind For you, Trending, Hindi and Punjabi is JioSaavn's, and
 * it is mostly Indian music. Anything else - an English song, a remix, your
 * own recording - comes in here: pick a file from anywhere on the phone, name
 * it, and it is a song like any other in the chat, story, camera and profile
 * pickers, because they all read the same shelf.
 *
 * ## Audio as it is, video as its sound
 *
 * An audio file goes up untouched. A video goes through the same decoder the
 * story sound picker already uses, which reads only the audio track, and what
 * goes up is that sound - never the video. Anything the browser can decode but
 * the phone might not replay (or a file too big to send) takes the same path.
 *
 * ## Where it lives
 *
 * Cloudflare R2, through the `pingo-songs` Worker (workers/songs). The Worker
 * checks the Supabase session on every upload, and serves the file to anybody
 * holding its link - a song sent in a chat has to play for the person it was
 * sent to.
 */

const ENDPOINT = ((import.meta.env.VITE_SONGS_URL as string | undefined) ?? 'https://pingo-songs.dubesminecraft.workers.dev').replace(/\/$/, '');

/** Matches the Worker. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** The sound out of a video is kept to this long; a 22 kHz WAV of it stays under the size cap. */
const MAX_EXTRACT_SECONDS = 8 * 60;
const EXTRACT_RATE = 22_050;

/** Types the phone plays back as they are. Anything else is re-made as WAV first. */
const PLAYABLE = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac']);

/** An uploaded song, shaped like a catalogue song so every picker can use it. */
export interface UploadedSong extends Song {
  id: string;
  createdAt: number;
}

/** The file, ready to send: its bytes, what they are, how long they play. */
export interface PreparedSound {
  blob: Blob;
  type: string;
  secs: number;
  /** A starting name, from the file name. */
  suggestedName: string;
  /** True when the sound was taken out of a video. */
  fromVideo: boolean;
}

function demoMode(): boolean {
  try { return import.meta.env.DEV && localStorage.getItem('pingo:demo') === '1'; } catch { return false; }
}

async function token(): Promise<string> {
  const { data } = await getSupabaseClient().auth.getSession();
  const access = data.session?.access_token;
  if (!access) throw new Error('Sign in to PINGO to upload songs.');
  return access;
}

function nameFromFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 80) || 'My song';
}

/** How long an audio file plays, read by the browser without decoding all of it. */
function durationOf(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = (secs: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(secs) ? secs : 0); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = url;
  });
}

function mono(buffer: AudioBuffer, seconds: number): Float32Array {
  const length = Math.min(buffer.length, Math.floor(seconds * buffer.sampleRate));
  const out = new Float32Array(length);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) out[i] = out[i]! + data[i]!;
  }
  if (buffer.numberOfChannels > 1) for (let i = 0; i < length; i += 1) out[i] = out[i]! / buffer.numberOfChannels;
  return out;
}

/**
 * Turns whatever was picked into a song file.
 *
 * Throws a message worth showing when the file has no sound the browser can
 * read - a photo, a document, a video with no audio track.
 */
export async function prepareSound(file: File): Promise<PreparedSound> {
  const type = file.type.toLowerCase();
  const suggestedName = nameFromFile(file);
  if (PLAYABLE.has(type) && file.size <= MAX_UPLOAD_BYTES) {
    const secs = await durationOf(file);
    if (secs > 0) return { blob: file, type: type === 'audio/mp3' ? 'audio/mpeg' : type, secs, suggestedName, fromVideo: false };
  }
  // A video, an audio file the phone may not replay, or one too big: take its sound and make it a WAV.
  const { buffer } = await decodeSound(file);
  const seconds = Math.min(buffer.duration, MAX_EXTRACT_SECONDS);
  const blob = encodePcmToWavBlob(mono(buffer, seconds), buffer.sampleRate, EXTRACT_RATE);
  return { blob, type: 'audio/wav', secs: seconds, suggestedName, fromVideo: type.startsWith('video/') };
}

// ---- the shelf -----------------------------------------------------------------

let mine: UploadedSong[] | undefined;
let loading = false;
let loadError: string | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
let snapshot = { mine, loading, loadError };
const refreshSnapshot = () => { snapshot = { mine, loading, loadError }; emit(); };

/** Demo builds keep uploads in memory, as object URLs, so the screens can be looked at. */
const demoSongs: UploadedSong[] = [];

function fromServer(row: { id: string; name: string; artist: string; url: string; secs: number; createdAt: number }): UploadedSong {
  return { id: row.id, name: row.name, artist: row.artist, img: '', url: row.url, secs: row.secs, start: 0, createdAt: row.createdAt };
}

export async function loadMySongs(force = false): Promise<void> {
  if (loading || (mine && !force)) return;
  loading = true; loadError = undefined; refreshSnapshot();
  try {
    if (demoMode()) {
      mine = [...demoSongs];
    } else {
      const res = await fetch(`${ENDPOINT}/mine`, { headers: { authorization: `Bearer ${await token()}` } });
      const body = (await res.json().catch(() => ({}))) as { songs?: Parameters<typeof fromServer>[0][]; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load your songs.');
      mine = (body.songs ?? []).map(fromServer);
    }
  } catch (cause) {
    loadError = cause instanceof Error ? cause.message : 'Could not load your songs.';
  } finally {
    loading = false; refreshSnapshot();
  }
}

/**
 * Sends a prepared song up. `onProgress` gets 0-1 while the bytes go.
 *
 * XHR rather than fetch: fetch still has no upload progress, and a 20 MB song
 * on a phone connection with no bar looks exactly like a frozen app.
 */
export async function uploadSong(
  prepared: PreparedSound,
  details: { name: string; artist: string },
  onProgress?: (fraction: number) => void,
): Promise<UploadedSong> {
  const name = details.name.trim().slice(0, 80);
  const artist = details.artist.trim().slice(0, 80);
  if (!name) throw new Error('Give the song a name.');
  if (prepared.blob.size > MAX_UPLOAD_BYTES) throw new Error('That file is too big. Songs can be up to 25 MB.');

  let song: UploadedSong;
  if (demoMode()) {
    for (let p = 0; p <= 1; p += 0.25) { onProgress?.(p); await new Promise((r) => setTimeout(r, 120)); }
    song = { id: `demo-${Date.now()}`, name, artist, img: '', url: URL.createObjectURL(prepared.blob), secs: prepared.secs, start: 0, createdAt: Date.now() };
    demoSongs.unshift(song);
  } else {
    const q = new URLSearchParams({ name, artist, secs: String(Math.round(prepared.secs)), type: prepared.type });
    const auth = await token();
    const row = await new Promise<Parameters<typeof fromServer>[0]>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${ENDPOINT}/upload?${q.toString()}`);
      xhr.setRequestHeader('authorization', `Bearer ${auth}`);
      xhr.setRequestHeader('content-type', prepared.type);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
      xhr.onload = () => {
        let body: { song?: Parameters<typeof fromServer>[0]; error?: string } = {};
        try { body = JSON.parse(xhr.responseText) as typeof body; } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && body.song) resolve(body.song);
        else reject(new Error(body.error ?? 'The upload did not finish. Try again.'));
      };
      xhr.onerror = () => reject(new Error('No connection. The song did not upload.'));
      xhr.send(prepared.blob);
    });
    song = fromServer(row);
  }
  mine = [song, ...(mine ?? [])];
  refreshSnapshot();
  return song;
}

export async function deleteSong(id: string): Promise<void> {
  if (demoMode()) {
    const i = demoSongs.findIndex((s) => s.id === id);
    if (i >= 0) demoSongs.splice(i, 1);
  } else {
    const res = await fetch(`${ENDPOINT}/song/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${await token()}` } });
    if (!res.ok) throw new Error('Could not delete that song.');
  }
  mine = (mine ?? []).filter((s) => s.id !== id);
  refreshSnapshot();
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Your uploads, loaded the first time a picker opens the shelf. */
export function useMySongs() {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  useEffect(() => { void loadMySongs(); }, []);
  const retry = useCallback(() => void loadMySongs(true), []);
  return { ...state, retry };
}

/** The pick-name-upload flow's own state, shared by the light and dark pickers. */
export function useSongUpload() {
  const [prepared, setPrepared] = useState<PreparedSound>();
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();

  const pick = async (file: File) => {
    setError(undefined);
    setPreparing(true);
    try {
      setPrepared(await prepareSound(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That file has no sound PINGO can use.');
    } finally {
      setPreparing(false);
    }
  };

  const send = async (details: { name: string; artist: string }) => {
    if (!prepared) return undefined;
    setError(undefined);
    setProgress(0);
    try {
      const song = await uploadSong(prepared, details, setProgress);
      setPrepared(undefined);
      return song;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The upload did not finish. Try again.');
      return undefined;
    } finally {
      setProgress(undefined);
    }
  };

  const cancel = () => { setPrepared(undefined); setError(undefined); };
  return { prepared, preparing, progress, error, pick, send, cancel };
}
