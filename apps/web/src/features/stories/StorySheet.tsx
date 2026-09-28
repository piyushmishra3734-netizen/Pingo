import { cn } from '@pingo/ui';
import { Search } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

import { Overlay } from '../../components/Overlay.js';

/**
 * The stories sample's bottom sheet: dark over a story, white over a post.
 *
 * One at a time, a grab handle that drags it away, and a scrim that closes it.
 * Rows, search and body are the sample's `.row`, `.ssearch` and `.sbody`.
 */
const Close = createContext<() => void>(() => undefined);
/** Closes the sheet it is called in, with its slide. */
export const useSheetClose = () => useContext(Close);

export function StorySheet({ dark = true, title, onClose, children, className, z = 1100 }: {
  dark?: boolean;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  z?: number;
}) {
  const [closing, setClosing] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | undefined>(undefined);
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 250);
  }, [onClose]);

  const grab = {
    onPointerDown: (e: React.PointerEvent) => { drag.current = { y: e.clientY, dy: 0 }; e.currentTarget.setPointerCapture(e.pointerId); if (sheet.current) sheet.current.style.transition = 'none'; },
    onPointerMove: (e: React.PointerEvent) => { const d = drag.current; if (!d || !sheet.current) return; d.dy = Math.max(0, e.clientY - d.y); sheet.current.style.transform = `translateY(${d.dy}px)`; },
    onPointerUp: () => { const d = drag.current; drag.current = undefined; if (!sheet.current) return; sheet.current.style.transition = ''; sheet.current.style.transform = ''; if (d && d.dy > 90) close(); },
  };

  return (
    <Overlay onDismiss={close}>
      <Close.Provider value={close}>
        <div className="fixed inset-0" style={{ zIndex: z }} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <style>{'@keyframes ss-up { from { transform: translateY(105%) } } @keyframes ss-fade { from { opacity: 0 } }'}</style>
          <div className="absolute inset-0 bg-black/45 transition-opacity duration-[250ms]" style={{ opacity: closing ? 0 : 1, animation: 'ss-fade .25s' }} onClick={close} />
          <div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            className={cn('absolute inset-x-0 bottom-0 mx-auto flex max-h-[86%] max-w-[560px] flex-col rounded-t-[18px] transition-transform duration-[340ms] ease-[cubic-bezier(.2,.8,.2,1)]',
              dark ? 'bg-media-sheet text-white' : 'bg-white text-[#111]', className)}
            style={{ transform: closing ? 'translateY(105%)' : undefined, animation: 'ss-up .34s cubic-bezier(.2,.8,.2,1)' }}
          >
            <div {...grab} className={cn('relative mx-auto mt-2 mb-2.5 h-1 w-[38px] shrink-0 touch-none rounded-sm before:absolute before:-inset-x-6 before:-inset-y-3 before:content-[""]', dark ? 'bg-white/25' : 'bg-[#c7c7cc]')} />
            {title && <h3 {...grab} className="touch-none px-4 pb-2.5 text-center text-[16px] font-bold">{title}</h3>}
            {children}
          </div>
        </div>
      </Close.Provider>
    </Overlay>
  );
}

/** The sheet's search field. */
export function SheetSearch({ dark = true, value, onChange, placeholder = 'Search', autoFocus, onEnter }: {
  dark?: boolean; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
  /** Return picks the first result. */
  onEnter?: () => void;
}) {
  return (
    <label className={cn('mx-3.5 mb-3 flex h-[38px] shrink-0 items-center gap-2 rounded-[10px] px-3 text-[#8e8e8e]', dark ? 'bg-media-field' : 'bg-[#efefef]')}>
      <Search size={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} enterKeyHint={onEnter ? 'done' : undefined}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
        className={cn('min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#8e8e8e]', dark ? 'text-white' : 'text-[#111]')} />
    </label>
  );
}

/** The sheet's scrolling body. */
export function SheetBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('scrollbar-none min-h-0 overflow-y-auto px-3.5 pb-6', className)}>{children}</div>;
}

/**
 * A menu: the rows sit together in one rounded group, each an icon and its
 * name side by side, a hairline between them. `danger` turns the whole row red.
 */
export function MenuGroup({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-[14px] bg-media-field [&>button+button]:border-t [&>button+button]:border-white/[.08]">{children}</div>;
}

export function MenuRow({ icon, label, danger, onClick }: { icon: ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex h-[52px] w-full items-center gap-3.5 px-4 text-left transition-colors active:bg-white/[.06]', danger ? 'text-danger' : 'text-white')}>
      <span className="grid size-6 shrink-0 place-items-center [&>svg]:size-[22px] [&>svg]:stroke-[1.8]">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{label}</span>
    </button>
  );
}

/** A person row: face, name over handle, and whatever sits at the end. */
export function PersonRow({ avatar, name, sub, end, badge, subTone = '#8e8e8e' }: {
  avatar?: string; name: string; sub?: string; end?: ReactNode; badge?: ReactNode; subTone?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-[9px]">
      <span className="relative shrink-0">
        {avatar ? <img src={avatar} alt="" className="size-11 rounded-full object-cover" /> : <span className="grid size-11 place-items-center rounded-full bg-media-field font-bold text-white">{name[0]?.toUpperCase()}</span>}
        {badge}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px]">{name}</b>
        {sub && <span className="block truncate text-[13px]" style={{ color: subTone }}>{sub}</span>}
      </span>
      {end}
    </div>
  );
}

/** The sample's blue Send, which reads Sent once used. */
export function SendButton({ sent, onClick, label = 'Send', sentLabel = 'Sent' }: { sent: boolean; onClick: () => void; label?: string; sentLabel?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={sent}
      className={cn('shrink-0 rounded-[8px] px-4 py-[7px] text-[13.5px] font-bold', sent ? 'bg-[#efefef] text-[#111]' : 'bg-media-accent text-on-media-accent')}>
      {sent ? sentLabel : label}
    </button>
  );
}
