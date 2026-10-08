import { useEffect, useState, useSyncExternalStore } from 'react';

import * as api from './api.js';
import type { Kept } from './library.js';
import { musicSettings } from './settings.js';
import type { Song } from './types.js';

/**
 * Songs kept on the phone, to play with no internet.
 *
 * ## Straight from JioSaavn
 *
 * The audio comes from JioSaavn's own CDN (`aac.saavncdn.com`, which allows
 * any origin), the way a stream does, and is kept inside the app. Nothing of
 * ours sits in between, so a download costs PINGO nothing and is as fast as
 * the phone's connection. It plays only inside PINGO, as on Spotify or
 * JioSaavn: it is not an mp3 in the phone's Downloads folder.
 *
 * ## Where it lives
 *
 * Its own IndexedDB database, `pingo-music`, not the Cache API. Several parts
 * of the app clear every cache by design (the native shell on each launch, the
 * stale-build recovery, "Clear cached files" in Settings), and none of them
 * should take somebody's downloads with them. The cover is kept beside the
 * audio, so the offline screen is not a column of grey squares.
 *
 * What was downloaded (the song's details, size, quality) is a small list in
 * localStorage, read synchronously, so the app knows at launch, before any
 * database opens, whether there is anything to offer offline.
 */

export interface Downloaded {
  song: Song;
  bytes: number;
  kbps: string;
  at: number;
}

export interface Active {
  song: Song | Kept;
  /** 0 to 1, once the size is known. */
  progress: number;
  failed?: boolean;
}

interface State {
  done: Record<string, Downloaded>;
  active: Record<string, Active>;
}

export const META_KEY = 'pingo:music-downloads:v1';
const DB = 'pingo-music';
const STORE = 'files';

function loadMeta(): Record<string, Downloaded> {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as Record<string, Downloaded>;
  } catch {
    return {};
  }
}

let state: State = { done: typeof localStorage === 'undefined' ? {} : loadMeta(), active: {} };
const listeners = new Set<() => void>();
const waiting: string[] = [];
let running = 0;
const PARALLEL = 2;

function set(next: State) {
  const metaChanged = next.done !== state.done;
  state = next;
  if (metaChanged) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(state.done));
    } catch {
      // Full: the files are kept; the list catches up on the next change.
    }
  }
  listeners.forEach((l) => l());
}

/* ---------- the database ---------- */

let dbPromise: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = undefined;
  });
  return dbPromise;
}

interface Files {
  audio: Blob;
  cover?: Blob;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const readFiles = (id: string) => tx<Files | undefined>('readonly', (s) => s.get(id) as IDBRequest<Files | undefined>);

/* ---------- downloading ---------- */

/** Reads a response through, reporting how far it has got. */
async function readAll(res: Response, onProgress: (p: number) => void): Promise<Blob> {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  let told = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    // Every few percent, not every chunk: each report redraws the list.
    if (got / total - told >= 0.04) {
      told = got / total;
      onProgress(told);
    }
  }
  return new Blob(parts as BlobPart[], { type: res.headers.get('content-type') ?? 'audio/mp4' });
}

function setActive(id: string, change: Partial<Active>) {
  const cur = state.active[id];
  if (!cur) return;
  set({ ...state, active: { ...state.active, [id]: { ...cur, ...change } } });
}

async function fetchOne(id: string) {
  const job = state.active[id];
  if (!job) return;
  // A song from the library carries no address; look it up.
  const song = 'stream' in job.song && api.streamUrl(job.song) ? job.song : await api.song(id);
  if (!song) throw new Error('Not available');
  const want = musicSettings().download === 'high' ? 'high' : 'normal';
  const url = api.streamUrl(song, want);
  if (!url) throw new Error('Not available');
  const kbps = /_(\d+)\.mp4/.exec(url)?.[1] ?? '';
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const audio = await readAll(res, (p) => setActive(id, { progress: p }));
  const cover = song.image ? await fetch(song.image).then((r) => (r.ok ? r.blob() : undefined)).catch(() => undefined) : undefined;
  // Cancelled while it was on its way: nothing to keep.
  if (!state.active[id]) return;
  await tx('readwrite', (s) => s.put({ audio, ...(cover ? { cover } : {}) } satisfies Files, id));
  const { [id]: _, ...active } = state.active;
  set({ done: { ...state.done, [id]: { song, bytes: audio.size + (cover?.size ?? 0), kbps, at: Date.now() } }, active });
}

function pump() {
  while (running < PARALLEL && waiting.length) {
    const id = waiting.shift()!;
    running++;
    // One quiet retry: a dropped connection mid-file is the usual failure.
    fetchOne(id)
      .catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => fetchOne(id)))
      .catch((e: unknown) => {
        console.warn('[music] download failed', id, e);
        setActive(id, { failed: true });
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

/** Downloads these songs, skipping any already here or on the way. */
export function download(songs: (Song | Kept)[]) {
  const fresh = songs.filter((s) => !state.done[s.id] && !state.active[s.id]);
  if (!fresh.length) return 0;
  const active = { ...state.active };
  for (const s of fresh) {
    active[s.id] = { song: s, progress: 0 };
    waiting.push(s.id);
  }
  set({ ...state, active });
  // Ask the browser not to clear these under storage pressure. It may say no.
  void navigator.storage?.persist?.().catch(() => false);
  pump();
  return fresh.length;
}

/** Tries a failed download again. */
export function retry(id: string) {
  const job = state.active[id];
  if (!job?.failed) return;
  setActive(id, { failed: false, progress: 0 });
  waiting.push(id);
  pump();
}

/** Stops waiting for a download that has not finished, or forgets one that failed. */
export function cancel(id: string) {
  const i = waiting.indexOf(id);
  if (i >= 0) waiting.splice(i, 1);
  if (!state.active[id]) return;
  const { [id]: _, ...active } = state.active;
  set({ ...state, active });
}

export async function remove(id: string) {
  cancel(id);
  forgetUrls(id);
  if (state.done[id]) {
    const { [id]: _, ...done } = state.done;
    set({ ...state, done });
  }
  await tx('readwrite', (s) => s.delete(id)).catch(() => undefined);
}

export async function removeAll() {
  waiting.length = 0;
  for (const id of Object.keys(urls)) forgetUrls(id);
  set({ done: {}, active: {} });
  await tx('readwrite', (s) => s.clear()).catch(() => undefined);
}

/* ---------- playing ---------- */

/** Object URLs handed out, one per file, so the same song is not read twice. */
const urls: Record<string, { audio?: string; cover?: string }> = {};
function forgetUrls(id: string) {
  const u = urls[id];
  if (u?.audio) URL.revokeObjectURL(u.audio);
  if (u?.cover) URL.revokeObjectURL(u.cover);
  delete urls[id];
}

async function urlsFor(id: string) {
  if (!state.done[id]) return undefined;
  if (urls[id]) return urls[id];
  const files = await readFiles(id).catch(() => undefined);
  if (!files) return undefined;
  urls[id] = { audio: URL.createObjectURL(files.audio), ...(files.cover ? { cover: URL.createObjectURL(files.cover) } : {}) };
  return urls[id];
}

/** An address the player can play this song from, with no network, if it is downloaded. */
export async function localAudio(id: string): Promise<string | undefined> {
  return (await urlsFor(id))?.audio;
}

export async function localCover(id: string): Promise<string | undefined> {
  return (await urlsFor(id))?.cover;
}

/* ---------- reading ---------- */

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snap = () => state;

export function useDownloads(): State {
  return useSyncExternalStore(subscribe, snap, snap);
}

export const isDownloaded = (id: string) => !!state.done[id];
export const downloadedSongs = () => Object.values(state.done).sort((a, b) => b.at - a.at);
export const totalBytes = (s: State = state) => Object.values(s.done).reduce((n, d) => n + d.bytes, 0);

/** Whether this phone has anything to play offline. Cheap enough for the first frame. */
export function hasDownloads(): boolean {
  try {
    return Object.keys(JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as object).length > 0;
  } catch {
    return false;
  }
}

/**
 * The cover to show for a song: the kept copy once it is downloaded, which
 * draws with no network; the remote one until then.
 */
export function useCover(id: string | undefined, remote: string | undefined): string | undefined {
  const done = useDownloads().done;
  const has = !!id && !!done[id];
  const [local, setLocal] = useState<{ id: string; url?: string }>();
  useEffect(() => {
    if (!has || !id) return undefined;
    let live = true;
    void localCover(id).then((url) => live && setLocal({ id, ...(url ? { url } : {}) }));
    return () => {
      live = false;
    };
  }, [has, id]);
  return (has && local?.id === id && local.url) || remote;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
