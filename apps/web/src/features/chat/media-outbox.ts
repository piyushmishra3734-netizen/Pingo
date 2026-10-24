import type { ChatService, VideoEdit } from '@pingo/core';
import { useSyncExternalStore } from 'react';

import { STORE, localAll, localDelete, localSet } from '../../lib/local/db.js';

/**
 * Photos and videos on their way out, kept until they are sent.
 *
 * ## What was wrong
 *
 * The send page waited for every upload before it closed, so somebody with a
 * slow line sat watching it; and the uploads lived only in that page. Losing
 * the connection, or closing the app, mid-upload lost the photos with no
 * trace: not in the chat, not anywhere to try again.
 *
 * ## What this does
 *
 * Share writes the set here, bytes included, and the page closes at once. A
 * single runner sends the queue in order (oldest set first, each set's items
 * in order, so a set never lands shuffled) and deletes a set only once every
 * item in it has gone. The thread shows each set as it waits, sends or fails.
 *
 * - App closed or the line dropped mid-upload: the set is still here, and goes
 *   when the app is open and online again, from the item it stopped at.
 * - The server refused it, or it kept failing: it stays in the chat as
 *   "Not sent", with Retry and Delete, like Instagram.
 */

export interface MediaJobItem {
  kind: 'photo' | 'video';
  blob: Blob;
  name: string;
  edit?: VideoEdit;
}

export interface MediaJob {
  id: string;
  conversationId: string;
  items: MediaJobItem[];
  caption: string;
  viewOnce: boolean;
  createdAt: number;
  /** How many items have gone; a resumed set starts from here. */
  sent: number;
  state: 'queued' | 'sending' | 'failed';
  error?: string;
  attempts: number;
}

/** Tries before a set is shown as failed rather than retried on its own. */
const AUTO_TRIES = 3;

let jobs: MediaJob[] = [];
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
  jobs = [...jobs];
  listeners.forEach((l) => l());
};

async function save(job: MediaJob): Promise<void> {
  await localSet(STORE.mediaOutbox, job.id, job).catch(() => undefined);
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const stored = await localAll<MediaJob>(STORE.mediaOutbox).catch(() => [] as MediaJob[]);
  // A set that was mid-send when the app closed is simply queued again.
  const fresh = stored
    .filter((j) => j && Array.isArray(j.items))
    .map((j) => (j.state === 'sending' ? { ...j, state: 'queued' as const } : j));
  const known = new Set(jobs.map((j) => j.id));
  jobs = [...jobs, ...fresh.filter((j) => !known.has(j.id))].sort((a, b) => a.createdAt - b.createdAt);
  emit();
}

/** Queue a set from the send page. Resolves once its bytes are on disk. */
export async function queueMedia(input: Omit<MediaJob, 'id' | 'createdAt' | 'sent' | 'state' | 'attempts'>): Promise<MediaJob> {
  const job: MediaJob = { ...input, id: crypto.randomUUID(), createdAt: Date.now(), sent: 0, state: 'queued', attempts: 0 };
  jobs = [...jobs, job];
  emit();
  await save(job);
  void run();
  return job;
}

export function retryMedia(id: string): void {
  const job = jobs.find((j) => j.id === id);
  if (!job) return;
  Object.assign(job, { state: 'queued', attempts: 0 });
  delete job.error;
  emit();
  void save(job).then(() => run());
}

export function discardMedia(id: string): void {
  jobs = jobs.filter((j) => j.id !== id);
  emit();
  void localDelete(STORE.mediaOutbox, id).catch(() => undefined);
}

/* ---------- the runner ---------- */

let service: ChatService | undefined;
let running: Promise<void> | undefined;

/** Called once, by `MediaOutboxRunner`, with the signed-in session's service. */
export function startMediaOutbox(next: ChatService): () => void {
  service = next;
  void load().then(() => run());
  const online = () => void run();
  window.addEventListener('online', online);
  // Back from the background on a phone: try whatever is waiting.
  const visible = () => document.visibilityState === 'visible' && void run();
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('online', online);
    document.removeEventListener('visibilitychange', visible);
    if (service === next) service = undefined;
  };
}

function run(): Promise<void> {
  if (running) return running;
  /*
   * Cleared in `.finally`, not in a `finally` inside the async function: when
   * there is nothing to send the function returns without ever awaiting, so an
   * inner `finally` would run before `running` is even assigned, and the stale
   * promise would then block every later run.
   */
  running = (async () => {
    {
      for (;;) {
        const job = jobs.find((j) => j.state === 'queued');
        if (!job || !service) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        try {
          await sendJob(service, job);
        } catch {
          // Offline: everything waits for the 'online' event.
          return;
        }
      }
    }
  })().finally(() => {
    running = undefined;
  });
  return running;
}

async function sendJob(svc: ChatService, job: MediaJob): Promise<void> {
  job.state = 'sending';
  emit();
  try {
    for (let i = job.sent; i < job.items.length; i += 1) {
      const item = job.items[i]!;
      // The caption rides on the first, so a set of four does not repeat one sentence.
      const body = i === 0 ? job.caption : '';
      if (item.kind === 'photo') {
        await svc.sendMessage({
          conversationId: job.conversationId,
          body,
          quiet: true,
          photo: { image: item.blob, ...(job.viewOnce ? { viewLimit: 1 } : {}), },
        });
      } else {
        await svc.sendMessage({
          conversationId: job.conversationId,
          body,
          quiet: true,
          document: { file: new File([item.blob], item.name, { type: item.blob.type || 'video/mp4' }) },
          ...(item.edit ? { videoEdit: item.edit } : {}),
        });
      }
      job.sent = i + 1;
      emit();
      await save(job);
    }
    discardMedia(job.id);
  } catch (cause) {
    job.attempts += 1;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    // Offline is not a failure: it waits for the line. Anything else retries a few times, then says so.
    job.state = offline || job.attempts < AUTO_TRIES ? 'queued' : 'failed';
    job.error = cause instanceof Error ? cause.message : 'Could not send.';
    emit();
    await save(job);
    if (job.state === 'queued' && !offline) await new Promise((r) => setTimeout(r, 1500 * job.attempts));
    if (offline) throw new Error('offline');
  }
}

/* ---------- for the thread ---------- */

export function useMediaJobs(conversationId: string): MediaJob[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  if (!loaded) void load();
  return jobs.filter((j) => j.conversationId === conversationId);
}

