import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TmdbMedia } from '../types.js';
import { TvMediaCard } from './TvMediaCard.js';

interface TvMediaRailProps {
  title: string;
  sub?: string;
  items: TmdbMedia[];
  onSelect: (media: TmdbMedia) => void;
  icon?: React.ReactNode;
  isTop10?: boolean;
}

export function TvMediaRail({
  title,
  sub,
  items,
  onSelect,
  icon,
  isTop10 = false,
}: TvMediaRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!items || items.length === 0) return null;

  const displayItems = isTop10 ? items.slice(0, 10) : items;

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const offset = direction === 'left' ? -420 : 420;
    scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
  };

  return (
    <section className="relative my-4 flex flex-col group/rail">
      {/* Rail Header */}
      <div className="flex items-end justify-between px-4 pb-2 sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            {icon && <span className="text-brand">{icon}</span>}
            <h2 className="text-base font-bold tracking-tight text-ink sm:text-lg md:text-xl">
              {title}
            </h2>
          </div>
          {sub && (
            <p className="mt-0.5 text-xs text-text-secondary">{sub}</p>
          )}
        </div>

        {/* Desktop Arrow Controls */}
        <div className="hidden items-center gap-1 sm:flex opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100">
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => scroll('left')}
            className="grid size-8 place-items-center rounded-full bg-sunken/80 text-text-secondary backdrop-blur-sm transition-all hover:bg-surface hover:text-ink active:scale-95 shadow-sm"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => scroll('right')}
            className="grid size-8 place-items-center rounded-full bg-sunken/80 text-text-secondary backdrop-blur-sm transition-all hover:bg-surface hover:text-ink active:scale-95 shadow-sm"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Scrollable Rail */}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto px-4 pb-3 sm:px-6 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden items-end"
      >
        {displayItems.map((media, idx) => {
          const key = `${media.media_type || 'm'}-${media.id}-${idx}`;

          if (isTop10) {
            return (
              <div
                key={key}
                className="group relative flex shrink-0 items-end pl-1 select-none transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1 z-10"
              >
                {/* JioHotstar signature giant gradient outlined rank numeral */}
                <span
                  aria-hidden="true"
                  className="select-none font-black text-[108px] sm:text-[144px] md:text-[164px] leading-[0.7] -tracking-[8px] sm:-tracking-[11px] -mr-4 sm:-mr-6 z-0 pointer-events-none"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.32) 60%, rgba(255,255,255,0.05) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    WebkitTextStroke: '1.5px rgba(255,255,255,0.3)',
                    filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.85))',
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  }}
                >
                  {idx + 1}
                </span>

                <div className="relative z-10 w-28 sm:w-36 md:w-44 shrink-0 rounded-[14px] ring-2 ring-page shadow-xl overflow-hidden">
                  <TvMediaCard media={media} onSelect={onSelect} />
                </div>
              </div>
            );
          }

          return (
            <div
              key={key}
              className="w-28 shrink-0 sm:w-36 md:w-44 transition-transform duration-300 hover:scale-[1.03] hover:-translate-y-1"
            >
              <TvMediaCard media={media} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
