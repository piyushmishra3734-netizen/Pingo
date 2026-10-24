import type { SocialLink } from '@pingo/core';
import { PlayIcon, cn } from '@pingo/ui';
import { BadgeCheck, ChartNoAxesColumn, ExternalLink, Heart, MessageCircle, Repeat2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { assetUrl, useSocialPost, type SocialMedia, type SocialPost } from './useSocialPost.js';

/**
 * An X post or a pin, drawn as itself.
 *
 * Nothing here is an iframe: the post arrives as data and is laid out the way
 * the app lays it out - avatar, name, text with its mentions and hashtags,
 * pictures in their grid, the numbers underneath. A pin is its picture at its
 * own shape with the title under it.
 *
 * Text is built as nodes, never as HTML, so a post can only ever be text and
 * anchors. A video streams from the platform only once somebody taps it, which
 * is the same bargain the other video cards make about who learns what you read.
 */

const swallow = {
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
};

const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M` : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);

function when(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export interface SocialPostCardProps {
  link: SocialLink;
  /** Drawn alone, with no bubble around it. */
  bare?: boolean;
  spaced?: boolean;
}

export function SocialPostCard({ link, bare, spaced }: SocialPostCardProps) {
  const { post } = useSocialPost(link);
  const [zoom, setZoom] = useState<SocialMedia>();

  const shell = cn(
    'w-[min(21rem,78vw)] max-w-full overflow-hidden rounded-2xl border border-line bg-surface text-ink',
    bare ? 'shadow-sm' : spaced && 'mb-2',
  );

  if (post === undefined) return <Skeleton link={link} className={shell} />;
  if (post === null) return <Fallback link={link} className={shell} />;

  return (
    <div className={shell} {...swallow}>
      {post.platform === 'x' ? <XPost post={post} link={link} onZoom={setZoom} /> : <Pin post={post} link={link} onZoom={setZoom} />}
      {zoom && <Lightbox media={zoom} onClose={() => setZoom(undefined)} />}
    </div>
  );
}

/* ----------------------------------------------------------------- X */

function XPost({ post, link, onZoom }: { post: SocialPost; link: SocialLink; onZoom: (m: SocialMedia) => void }) {
  const stats = post.stats ?? {};
  const date = when(post.createdAt);
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <header className="flex items-center gap-2.5">
        <Avatar src={post.author?.avatar} name={post.author?.name ?? '?'} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex items-center gap-1">
            <span className="truncate text-[14.5px] font-semibold">{post.author?.name}</span>
            {post.author?.verified && <BadgeCheck size={15} className="shrink-0 fill-[#1d9bf0] text-white" aria-label="Verified" />}
          </span>
          {post.author?.handle && <span className="truncate text-caption text-text-secondary">@{post.author.handle}</span>}
        </span>
        <span aria-label="X" className="grid size-6 shrink-0 place-items-center rounded-md bg-black text-[13px] font-bold leading-none text-white">
          𝕏
        </span>
      </header>

      {post.text && <PostText text={post.text} className="text-[15px] leading-snug" />}

      {post.media.length > 0 && <MediaGrid media={post.media} onZoom={onZoom} />}

      {post.quote && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line p-2.5">
          {post.quote.author && (
            <span className="truncate text-caption">
              <span className="font-semibold">{post.quote.author.name}</span>
              {post.quote.author.handle && <span className="text-text-secondary"> @{post.quote.author.handle}</span>}
            </span>
          )}
          {post.quote.text && <PostText text={post.quote.text} className="line-clamp-5 text-[13.5px] leading-snug" />}
          {post.quote.media.length > 0 && <MediaGrid media={post.quote.media.slice(0, 1)} onZoom={onZoom} />}
        </div>
      )}

      <footer className="flex items-center justify-between gap-2 text-caption text-text-secondary">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {stats.replies !== undefined && <Stat icon={<MessageCircle size={14} aria-hidden />} n={stats.replies} />}
          {stats.reposts !== undefined && <Stat icon={<Repeat2 size={15} aria-hidden />} n={stats.reposts} />}
          {stats.likes !== undefined && <Stat icon={<Heart size={14} aria-hidden />} n={stats.likes} />}
          {stats.views !== undefined && stats.views > 0 && <Stat icon={<ChartNoAxesColumn size={14} aria-hidden />} n={stats.views} />}
          {date && <span className="text-text-tertiary">{date}</span>}
        </span>
        <OpenLink href={post.url || link.url} label="Open on X" />
      </footer>
    </div>
  );
}

function Stat({ icon, n }: { icon: ReactNode; n: number }) {
  return (
    <span className="flex items-center gap-1 tabular-nums">
      {icon}
      {compact(n)}
    </span>
  );
}

/** Mentions, hashtags and links coloured; everything else is plain text. */
function PostText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => text.split(/(https?:\/\/[^\s<>"']+|@[A-Za-z0-9_]{1,15}|#[\p{L}\p{N}_]+)/gu), [text]);
  return (
    <p className={cn('break-words whitespace-pre-wrap', className)}>
      {parts.map((part, i) =>
        part.startsWith('http') ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
            {part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 28)}
            {part.length > 36 ? '…' : ''}
          </a>
        ) : part.startsWith('@') || part.startsWith('#') ? (
          <span key={i} className="text-brand">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

function MediaGrid({ media, onZoom }: { media: SocialMedia[]; onZoom: (m: SocialMedia) => void }) {
  if (media.length === 1) {
    const only = media[0]!;
    const ratio = only.w && only.h ? Math.min(Math.max(only.w / only.h, 0.8), 1.91) : 16 / 10;
    return (
      <div className="overflow-hidden rounded-xl bg-hover" style={{ aspectRatio: String(ratio) }}>
        <Tile media={only} onZoom={onZoom} />
      </div>
    );
  }
  return (
    <div className={cn('grid gap-0.5 overflow-hidden rounded-xl', 'grid-cols-2', media.length > 2 && 'grid-rows-2')} style={{ aspectRatio: '16 / 10' }}>
      {media.map((m, i) => (
        <div key={i} className={cn('overflow-hidden bg-hover', media.length === 3 && i === 0 && 'row-span-2')}>
          <Tile media={m} onZoom={onZoom} />
        </div>
      ))}
    </div>
  );
}

/** A picture, a video or a GIF: tapping any of them opens it full screen. */
function Tile({ media, onZoom }: { media: SocialMedia; onZoom: (m: SocialMedia) => void }) {
  if (media.kind === 'photo') {
    return (
      <button type="button" aria-label="View picture" className="block size-full focus-ring" onClick={() => onZoom(media)}>
        <img src={assetUrl(media.src)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      </button>
    );
  }

  return (
    <button type="button" aria-label={media.kind === 'gif' ? 'Play GIF' : 'Play video'} className="relative block size-full focus-ring" onClick={() => onZoom(media)}>
      {media.poster && <img src={assetUrl(media.poster)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />}
      <span className="absolute inset-0 grid place-items-center bg-black/15">
        <span className="grid size-12 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
          <PlayIcon size={22} />
        </span>
      </span>
      {media.kind === 'gif' && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">GIF</span>}
    </button>
  );
}

/* ------------------------------------------------------------- Pinterest */

function Pin({ post, link, onZoom }: { post: SocialPost; link: SocialLink; onZoom: (m: SocialMedia) => void }) {
  const media = post.media[0];
  const ratio = media?.w && media.h ? Math.min(Math.max(media.w / media.h, 0.66), 1.6) : 3 / 4;
  return (
    <div className="flex flex-col">
      {media && (
        <div className="overflow-hidden bg-hover" style={{ aspectRatio: String(ratio) }}>
          <Tile media={media} onZoom={onZoom} />
        </div>
      )}
      <div className="flex flex-col gap-1 p-3">
        {post.title && <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{post.title}</p>}
        {post.text && <p className="line-clamp-2 text-caption text-text-secondary">{post.text}</p>}
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-[#e60023]" />
            <span className="truncate">{post.author?.name ?? 'Pinterest'}</span>
          </span>
          <OpenLink href={post.url || link.url} label="Open on Pinterest" />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Avatar({ src, name }: { src?: string | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img src={assetUrl(src)} alt="" onError={() => setFailed(true)} className="size-9 shrink-0 rounded-full bg-hover object-cover" />;
  }
  return (
    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-hover text-caption font-semibold text-text-secondary">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-caption font-medium text-brand hover:bg-brand/10 focus-ring">
      <ExternalLink size={13} aria-hidden />
      {label}
    </a>
  );
}

function Skeleton({ link, className }: { link: SocialLink; className: string }) {
  return (
    <div className={className} role="status" aria-label={link.platform === 'x' ? 'Loading post' : 'Loading pin'}>
      <div className="flex animate-pulse flex-col gap-3 p-3">
        <div className="flex items-center gap-2.5">
          <span className="size-9 rounded-full bg-hover" />
          <span className="flex flex-col gap-1.5">
            <span className="h-3 w-28 rounded bg-hover" />
            <span className="h-2.5 w-16 rounded bg-hover" />
          </span>
        </div>
        <span className="h-3 w-full rounded bg-hover" />
        <span className="h-3 w-2/3 rounded bg-hover" />
        {link.platform === 'pinterest' && <span className="aspect-[3/4] w-full rounded-xl bg-hover" />}
      </div>
    </div>
  );
}

/** The post could not be read: private, deleted, or the service is down. The link still works. */
function Fallback({ link, className }: { link: SocialLink; className: string }) {
  const name = link.platform === 'x' ? 'X post' : 'Pinterest pin';
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" {...swallow} className={cn(className, 'flex items-center gap-3 p-3 focus-ring')}>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-[14.5px] font-semibold">{name}</span>
        <span className="truncate text-caption text-text-secondary">Could not load a preview. Tap to open.</span>
      </span>
      <ExternalLink size={16} className="shrink-0 text-brand" aria-hidden />
    </a>
  );
}

function Lightbox({ media, onClose }: { media: SocialMedia; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={media.kind === 'photo' ? 'Picture' : 'Video'} className="fixed inset-0 z-[400] grid place-items-center bg-black/90 p-3 motion-safe:animate-panel-in" onClick={onClose}>
      <button type="button" aria-label="Close" className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] grid size-10 place-items-center rounded-full bg-white/15 text-white focus-ring" onClick={onClose}>
        <X size={20} aria-hidden />
      </button>
      {media.kind === 'photo' ? (
        <img src={assetUrl(media.src)} alt="" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
      ) : (
        <video
          src={media.src}
          poster={media.poster ? assetUrl(media.poster) : undefined}
          controls={media.kind === 'video'}
          loop={media.kind === 'gif'}
          muted={media.kind === 'gif'}
          autoPlay
          playsInline
          className="max-h-full max-w-full rounded-lg bg-black object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>,
    document.body,
  );
}
