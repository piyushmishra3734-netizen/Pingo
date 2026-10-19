import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TmdbMedia } from '../types.js';
import { TvMediaCard } from './TvMediaCard.js';

interface TvMediaRailProps {
  title: string;
  sub?: string;
  items: TmdbMedia[];
  onSelect: (media: TmdbMedia) => void;
  /** Kept so existing callers compile; rails are text-only now, like Hotstar's. */
  icon?: React.ReactNode;
  isTop10?: boolean;
}

export function TvMediaRail({ title, sub, items, onSelect, isTop10 = false }: TvMediaRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  if (!items || items.length === 0) return null;

  const shown = isTop10 ? items.slice(0, 10) : items;
  const scroll = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section aria-label={title} className="group/rail relative mt-7 first:mt-0">
      <div className="mb-2 flex items-end justify-between gap-3 px-4 md:px-10">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-tight text-white/95 md:text-[22px]">{title}</h2>
          {sub && <p className="mt-0.5 truncate text-xs text-text-secondary">{sub}</p>}
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover/rail:opacity-100 md:flex">
          <button type="button" aria-label="Scroll left" onClick={() => scroll(-1)} className="grid size-8 place-items-center rounded-full bg-white/10 text-ink transition hover:bg-white/20 active:scale-95">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Scroll right" onClick={() => scroll(1)} className="grid size-8 place-items-center rounded-full bg-white/10 text-ink transition hover:bg-white/20 active:scale-95">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex snap-x snap-proximity gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-1 md:gap-3.5 md:scroll-px-10 md:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shown.map((media, i) => {
          const key = `${media.media_type || 'm'}-${media.id}-${i}`;
          if (isTop10) {
            return (
              <div key={key} className="relative flex shrink-0 snap-start items-end">
                {/* The rank, hollow and bleeding off behind the poster: the Top 10 signature. */}
                <span
                  aria-hidden
                  className="pointer-events-none -mr-5 select-none text-[112px] font-black leading-[0.78] tracking-[-0.09em] md:-mr-7 md:text-[150px]"
                  style={{ color: 'transparent', WebkitTextStroke: '2px rgba(255,255,255,0.42)' }}
                >
                  {i + 1}
                </span>
                <div className="relative w-[104px] md:w-[138px]">
                  <TvMediaCard media={media} onSelect={onSelect} showTitle={false} />
                </div>
              </div>
            );
          }
          return (
            <div key={key} className="w-[108px] shrink-0 snap-start md:w-[150px]">
              <TvMediaCard media={media} onSelect={onSelect} showTitle={false} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
