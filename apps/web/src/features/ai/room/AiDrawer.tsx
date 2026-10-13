import { cn } from '@pingo/ui';
import {
  Check,
  ChevronRight,
  FileText,
  Folder,
  Globe,
  ImageIcon,
  LayoutGrid,
  Lightbulb,
  MessageCircle,
  Plus,
  SquarePen,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { AiIdeas } from '../AiIdeas.js';
import { useAiChats, useAiGoals, useAiLibrary } from '../ai-data.js';
import { PingoFlow } from '../flow/PingoFlow.js';
import { AiPanel, Group, PageHeader, Row } from './ui.js';

type View = 'menu' | 'ideas' | 'goals' | 'library' | 'apps';

/** "2m ago", "3h ago", "2d ago", then a date. */
function ago(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * PINGO AI's menu, as Muse lays it out: who it is at the top (opens its
 * settings), where to go (Chats, Ideas, Goals, Library, Connected apps), and
 * the chats you have had with it, newest first. The pencil starts a new one.
 */
export function AiDrawer({
  currentId,
  onClose,
  onSettings,
  onIdea,
}: {
  currentId: string;
  onClose: () => void;
  onSettings: () => void;
  /** An idea was picked: put its command in the composer. */
  onIdea: (text: string) => void;
}) {
  const navigate = useNavigate();
  const chats = useAiChats();
  const [view, setView] = useState<View>('menu');
  const [allRecents, setAllRecents] = useState(false);

  const open = (id: string) => {
    onClose();
    if (id !== currentId) navigate(`/chats/${id}`);
  };
  const newChat = async () => {
    try {
      const id = await chats.create();
      onClose();
      navigate(`/chats/${id}`);
    } catch {
      /* the hook keeps the error; the row stays */
    }
  };

  const recents = chats.chats.filter((c) => !c.main);
  const shown = allRecents ? recents : recents.slice(0, 8);
  const main = chats.chats.find((c) => c.main);

  if (view !== 'menu') {
    return (
      <AiPanel side="left" label="PINGO AI" onClose={onClose}>
        <PageHeader
          title={{ ideas: 'Ideas', goals: 'Goals', library: 'Library', apps: 'Connected apps' }[view]}
          onBack={() => setView('menu')}
        />
        <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
          {view === 'ideas' && (
            <div className="ai-room rounded-[28px] !bg-transparent">
              <AiIdeas
                onPick={(text) => {
                  onClose();
                  onIdea(text);
                }}
              />
            </div>
          )}
          {view === 'goals' && <GoalsView />}
          {view === 'library' && <LibraryView />}
          {view === 'apps' && <AppsView />}
        </div>
      </AiPanel>
    );
  }

  return (
    <AiPanel side="left" label="PINGO AI menu" onClose={onClose}>
      <div className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 place-items-center rounded-full text-ink active:scale-95">
          <X size={22} />
        </button>
        <button
          type="button"
          aria-label="New chat"
          onClick={() => void newChat()}
          className="grid size-11 place-items-center rounded-[14px] bg-surface text-ink shadow-sm ring-1 ring-line active:scale-95"
        >
          <SquarePen size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={onSettings} className="flex w-full items-center gap-3.5 px-5 py-3 text-left active:bg-hover">
          <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--room-plate)]">
            <PingoFlow face="happy" className="size-[60px]" label="Pingo" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[22px] font-semibold tracking-[-0.01em] text-ink">
              Pingo AI <ChevronRight size={20} className="text-text-tertiary" aria-hidden />
            </span>
            <span className="block text-[15px] text-text-secondary">Your personal AI agent</span>
          </span>
        </button>

        <nav aria-label="PINGO AI" className="mt-2 flex flex-col gap-0.5 px-3">
          <NavItem icon={<MessageCircle size={22} />} label="Chats" active onClick={() => main && open(main.id)} />
          <NavItem icon={<Lightbulb size={22} />} label="Ideas" onClick={() => setView('ideas')} />
          <NavItem icon={<Target size={22} />} label="Goals" onClick={() => setView('goals')} />
          <NavItem icon={<Folder size={22} />} label="Library" onClick={() => setView('library')} />
          <NavItem icon={<LayoutGrid size={22} />} label="Connected apps" onClick={() => setView('apps')} />
        </nav>

        <div className="mx-5 my-4 h-px bg-line" />

        <div className="flex items-center justify-between px-5 pb-1">
          <h2 className="text-[14px] font-medium text-text-secondary">Recents</h2>
          {recents.length > 8 && (
            <button type="button" onClick={() => setAllRecents((v) => !v)} className="text-[14px] font-semibold text-brand">
              {allRecents ? 'Show less' : 'See all'}
            </button>
          )}
        </div>

        <ul className="flex flex-col px-2">
          {shown.length === 0 && !chats.loading && (
            <li className="px-3 py-4 text-[14.5px] leading-snug text-text-secondary">
              Start a new chat with the pencil above. Each one keeps its own thread, and PINGO AI still remembers you across all of them.
            </li>
          )}
          {shown.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => open(chat.id)}
                className={cn('flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left active:bg-hover', chat.id === currentId && 'bg-brand/10')}
              >
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-surface text-text-secondary ring-1 ring-line">
                  <MessageCircle size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[16px] font-medium text-ink">{chat.title}</span>
                    <span className="shrink-0 text-[12.5px] text-text-tertiary">{ago(chat.updatedAt)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] text-text-secondary">{chat.snippet || 'No messages yet'}</span>
                    {chat.unreadCount > 0 && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-on-brand">{chat.unreadCount}</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </AiPanel>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn('flex h-[52px] w-full items-center gap-4 rounded-[16px] px-3 text-left active:bg-hover', active && 'bg-brand/10')}
    >
      <span className={cn('grid w-7 place-items-center', active ? 'text-brand' : 'text-ink')}>{icon}</span>
      <span className="text-[18px] font-medium text-ink">{label}</span>
    </button>
  );
}

function GoalsView() {
  const goals = useAiGoals();
  const [draft, setDraft] = useState('');
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    void goals.add(title).catch(() => setDraft(title));
  };
  const open = goals.goals.filter((g) => !g.done);
  const done = goals.goals.filter((g) => g.done);
  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex items-center gap-2 rounded-[18px] bg-surface p-1.5 pl-4 ring-1 ring-line"
      >
        <label htmlFor="ai-goal" className="sr-only">
          New goal
        </label>
        <input
          id="ai-goal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a goal, like learning tennis"
          maxLength={120}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-text-tertiary"
        />
        <button type="submit" aria-label="Add goal" disabled={!draft.trim()} className="grid size-10 place-items-center rounded-full bg-brand text-on-brand disabled:opacity-40">
          <Plus size={20} />
        </button>
      </form>
      <p className="px-1 text-[13.5px] leading-snug text-text-secondary">You can also tell PINGO AI in the chat: "add a goal to save ₹5,000 this month".</p>
      {goals.goals.length === 0 && !goals.loading && <p className="px-1 text-[15px] text-text-secondary">No goals yet.</p>}
      {open.length > 0 && <GoalList items={open} goals={goals} />}
      {done.length > 0 && (
        <Group title="Done">
          <GoalList items={done} goals={goals} bare />
        </Group>
      )}
    </div>
  );
}

function GoalList({ items, goals, bare }: { items: ReturnType<typeof useAiGoals>['goals']; goals: ReturnType<typeof useAiGoals>; bare?: boolean }) {
  const list = (
    <ul>
      {items.map((g, i) => (
        <li key={g.id} className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-line')}>
          <button
            type="button"
            role="checkbox"
            aria-checked={g.done}
            aria-label={g.title}
            onClick={() => void goals.setDone(g.id, !g.done)}
            className={cn('grid size-6 shrink-0 place-items-center rounded-[7px] border-2', g.done ? 'border-text-tertiary bg-text-tertiary text-surface' : 'border-line-strong')}
          >
            {g.done && <Check size={15} strokeWidth={3} />}
          </button>
          <span className={cn('min-w-0 flex-1 text-[16px]', g.done ? 'text-text-tertiary line-through' : 'text-ink')}>{g.title}</span>
          <button type="button" aria-label={`Delete ${g.title}`} onClick={() => void goals.remove(g.id)} className="grid size-9 place-items-center rounded-full text-text-tertiary active:bg-hover">
            <Trash2 size={17} />
          </button>
        </li>
      ))}
    </ul>
  );
  return bare ? list : <div className="overflow-hidden rounded-[20px] bg-surface ring-1 ring-line">{list}</div>;
}

function LibraryView() {
  const navigate = useNavigate();
  const lib = useAiLibrary();
  const pictures = lib.items.filter((i) => i.kind !== 'file' && i.url);
  const files = lib.items.filter((i) => i.kind === 'file');
  if (!lib.loading && lib.items.length === 0) {
    return <p className="px-1 text-[15px] leading-snug text-text-secondary">Pictures PINGO AI makes for you and the photos and files you send it show up here.</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      {pictures.length > 0 && (
        <Group title="Pictures">
          <div className="grid grid-cols-3 gap-0.5">
            {pictures.map((p) => (
              <button key={p.messageId} type="button" onClick={() => navigate(`/chats/${p.conversationId}`)} className="relative aspect-square overflow-hidden bg-page">
                <img src={p.url} alt={p.kind === 'image' ? 'Made by PINGO AI' : 'Photo you sent'} loading="lazy" className="size-full object-cover" />
                {p.kind === 'image' && (
                  <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-black/55 text-white" aria-hidden>
                    <ImageIcon size={11} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </Group>
      )}
      {files.length > 0 && (
        <Group title="Files">
          {files.map((f) => (
            <Row
              key={f.messageId}
              icon={<FileText size={21} />}
              title={f.name ?? 'File'}
              sub={ago(f.createdAt)}
              onClick={() => navigate(`/chats/${f.conversationId}`)}
            />
          ))}
        </Group>
      )}
      {lib.hasMore && (
        <button type="button" onClick={() => void lib.loadMore()} disabled={lib.loadingMore} className="room-card-button">
          {lib.loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

/** What PINGO AI can reach today. Each is live; nothing here is a promise. */
function AppsView() {
  return (
    <div className="flex flex-col gap-5">
      <Group footer="These are on for every chat with PINGO AI. More apps will show up here as they are added.">
        <Row icon={<Globe size={21} />} title="Web" sub="Searches the web live and shows its sources" end={<Live />} />
        <Row icon={<ImageIcon size={21} />} title="Image creation" sub="Makes and edits pictures for you" end={<Live />} />
        <Row icon={<FileText size={21} />} title="Files and photos" sub="Reads the photos, PDFs and documents you send" end={<Live />} />
      </Group>
    </div>
  );
}

function Live() {
  return <span className="rounded-full bg-[#22c55e]/15 px-2.5 py-1 text-[12.5px] font-semibold text-[#15803d]">On</span>;
}
