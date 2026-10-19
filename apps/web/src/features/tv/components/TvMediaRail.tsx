import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TmdbMedia } from '../types.js';
import { TvMediaCard } from './TvMediaCard.js';

interface TvMediaRailProps {
  title: string;
  items: TmdbMedia[];
  onSelect: (media: TmdbMedia) => void;
  icon?: React.ReactNode;
}

export function TvMediaRail({ title, items, onSelect, icon }: TvMediaRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!items || items.length === 0) return null;

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const offset = direction === 'left' ? -380 : 380;
    scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
  };

  return (
    <section className="relative my-4 flex flex-col">
      {/* Rail Header */}
      <div className="flex items-center justify-between px-4 pb-2">
        <div className="flex items-center gap-2">
          {icon && <span className="text-brand">{icon}</span>}
          <h2 className="text-base font-bold tracking-tight text-ink sm:text-lg">{title}</h2>
        </div>

        {/* Desktop Arrow Controls */}
        <div className="hidden items-center gap-1 sm:flex">
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => scroll('left')}
            className="grid size-7 place-items-center rounded-full bg-sunken text-text-secondary transition-colors hover:bg-line hover:text-ink active:scale-95"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => scroll('right')}
            className="grid size-7 place-items-center rounded-full bg-sunken text-text-secondary transition-colors hover:bg-line hover:text-ink active:scale-95"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Tray */}
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto px-4 pb-3 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((media) => (
          <div key={`${media.media_type || 'm'}-${media.id}`} className="w-28 shrink-0 sm:w-36 md:w-44">
            <TvMediaCard media={media} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </section>
  );
}
