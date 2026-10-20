import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Cloud,
  ExternalLink,
  Globe,
  Link2,
  Play,
  Server,
  Sparkles,
} from 'lucide-react';
import { cn } from '@pingo/ui';

const ICONS = [Play, Server, Cloud, Globe, Link2];

export interface SourceMenuItem {
  id: string;
  name: string;
  /** ready = proven, reachable = answered, other = nothing, undefined = still checking. */
  status?: string;
  badge?: string;
}

interface TvSourceMenuProps {
  items: SourceMenuItem[];
  activeId: string;
  autoMode: boolean;
  onAuto: () => void;
  onPick: (id: string) => void;
  hiddenCount: number;
  showAll: boolean;
  onToggleAll: () => void;
  openUrl: string;
  openName: string;
}

/** The source switcher, sitting on the video's top-right corner. */
export function TvSourceMenu({
  items,
  activeId,
  autoMode,
  onAuto,
  onPick,
  hiddenCount,
  showAll,
  onToggleAll,
  openUrl,
  openName,
}: TvSourceMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const activeIndex = items.findIndex((i) => i.id === activeId);

  return (
    <div ref={rootRef} className="absolute right-3 top-3 z-30 text-sm">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow-lg ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/75 active:scale-95"
      >
        {autoMode ? <Sparkles className="size-3.5" /> : <Server className="size-3.5" />}
        <span>Source</span>
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 max-w-[80vw] overflow-hidden rounded-xl bg-[#14161d]/95 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl animate-fadeIn"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={autoMode}
            onClick={() => {
              onAuto();
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-white transition hover:bg-white/10"
          >
            <Sparkles className="size-4 shrink-0 text-white/80" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">Auto (Best)</span>
              {autoMode && activeIndex >= 0 && (
                <span className="block text-[11px] text-white/50">Playing Source {activeIndex + 1}</span>
              )}
            </span>
            {autoMode && <Check className="size-4 shrink-0" />}
          </button>

          <div className="my-1 h-px bg-white/10" />

          <div className="max-h-56 overflow-y-auto [scrollbar-width:thin]">
            {items.map((item, index) => {
              const Icon = ICONS[index % ICONS.length]!;
              const active = !autoMode && item.id === activeId;
              const dot =
                item.status === 'ready'
                  ? 'bg-emerald-400'
                  : item.status === 'reachable'
                    ? 'bg-amber-400'
                    : item.status
                      ? 'bg-white/25'
                      : 'bg-white/15 animate-pulse';
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    onPick(item.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-white transition hover:bg-white/10"
                >
                  <Icon className="size-4 shrink-0 text-white/80" />
                  <span className="flex-1 text-[13px] font-medium">Source {index + 1}</span>
                  {item.badge && (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white/70">
                      {item.badge}
                    </span>
                  )}
                  <span className={cn('size-1.5 shrink-0 rounded-full', dot)} aria-hidden />
                  {active && <Check className="size-4 shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="my-1 h-px bg-white/10" />
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={onToggleAll}
              className="w-full rounded-lg px-3 py-2 text-left text-[12px] text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              {showAll ? 'Only working sources' : `Show ${hiddenCount} not working`}
            </button>
          )}
          {/* Some frames load and show nothing, and nothing cross-origin can
              detect that: the viewer needs a way out that is not "give up". */}
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <ExternalLink className="size-3.5" />
            Open on {openName}
          </a>
        </div>
      )}
    </div>
  );
}
