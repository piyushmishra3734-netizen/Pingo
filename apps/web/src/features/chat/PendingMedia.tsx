import { cn } from '@pingo/ui';
import { CloudOff, Loader2, Play, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { discardMedia, retryMedia, useMediaJobs, type MediaJob } from './media-outbox.js';

/**
 * Photos and videos still on their way, at the foot of the thread: what is
 * left of each set, and whether it is sending, waiting for a connection, or
 * failed (with Retry and Delete), like Instagram's.
 */
export function PendingMedia({ conversationId }: { conversationId: string }) {
  const jobs = useMediaJobs(conversationId);
  if (!jobs.length) return null;
  return (
    <div className="mt-1 flex flex-col items-end gap-2">
      {jobs.map((job) => (
        <PendingSet key={job.id} job={job} />
      ))}
    </div>
  );
}

function PendingSet({ job }: { job: MediaJob }) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const left = job.items.slice(job.sent);
  const urls = useMemo(() => left.map((item) => URL.createObjectURL(item.blob)), [job.id, job.sent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const failed = job.state === 'failed';
  const waiting = !failed && !online;
  const status = failed
    ? 'Not sent'
    : waiting
      ? 'Waiting for connection'
      : job.items.length > 1
        ? `Sending ${Math.min(job.sent + 1, job.items.length)} of ${job.items.length}`
        : 'Sending';

  return (
    <div className="flex max-w-[76%] flex-col items-end gap-1.5">
      <div className={cn('grid gap-1 overflow-hidden rounded-[18px]', left.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {left.slice(0, 4).map((item, i) => (
          <div key={i} className="relative size-32 overflow-hidden rounded-[14px] bg-surface">
            {item.kind === 'photo' ? (
              <img src={urls[i]} alt="" className={cn('size-full object-cover', !failed && 'opacity-80')} />
            ) : (
              <>
                <video src={urls[i]} muted playsInline preload="metadata" className={cn('size-full object-cover', !failed && 'opacity-80')} />
                <Play size={22} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 fill-white text-white drop-shadow" />
              </>
            )}
            {i === 3 && left.length > 4 && (
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-[20px] font-semibold text-white">+{left.length - 4}</span>
            )}
            {!failed && i === 0 && (
              <span className="absolute inset-0 grid place-items-center bg-black/20">
                {waiting ? <CloudOff size={24} className="text-white" /> : <Loader2 size={26} className="animate-spin text-white" />}
              </span>
            )}
          </div>
        ))}
      </div>
      {job.caption && <p className="max-w-full rounded-[16px] bg-brand/80 px-3 py-1.5 text-[15px] text-on-brand">{job.caption}</p>}
      <div className="flex items-center gap-2 text-caption">
        <span className={cn(failed ? 'font-semibold text-danger' : 'text-text-tertiary')} role="status">
          {status}
        </span>
        {failed && (
          <>
            <button type="button" onClick={() => retryMedia(job.id)} className="flex items-center gap-1 rounded-full bg-brand px-3 py-1 font-semibold text-on-brand active:scale-95">
              <RotateCw size={13} /> Retry
            </button>
            <button type="button" aria-label="Delete" onClick={() => discardMedia(job.id)} className="grid size-7 place-items-center rounded-full bg-surface text-text-secondary active:scale-95">
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
