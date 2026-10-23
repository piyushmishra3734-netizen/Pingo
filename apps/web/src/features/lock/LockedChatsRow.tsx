import { ChevronRight, Lock } from 'lucide-react';

/**
 * The one row that stands for every locked chat, at the top of the chat list.
 *
 * It says how many and nothing else: no names, no previews, no unread count.
 * Whoever glances at the list learns that something is locked, not what.
 */
export function LockedChatsRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors duration-instant ease-standard hover:bg-hover active:bg-pressed focus-ring"
    >
      <span className="grid size-[3.25rem] shrink-0 place-items-center rounded-full bg-hover text-ink">
        <Lock size={22} strokeWidth={1.8} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold leading-tight text-ink">Locked chats</span>
        <span className="block text-[13.5px] leading-snug text-text-secondary">
          {count} {count === 1 ? 'chat' : 'chats'}, behind your PIN
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-text-tertiary" aria-hidden />
    </button>
  );
}
