import { useChat, useProfile } from '@pingo/core';
import { cn } from '@pingo/ui';
import {
  AudioLines,
  BadgeCheck,
  Brain,
  ChevronRight,
  Crown,
  ImageIcon,
  MessageCircle,
  MoreVertical,
  Phone,
  Share,
  Smile,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useConfirm } from '../../../components/ConfirmProvider.js';
import { profileLink } from '../../profile/ShareProfileSheet.js';
import { fetchAiPublicIdentity, type AiPublicIdentity } from '../ai-public.js';
import { AI_VOICES, useAiPrefs } from '../room/ai-prefs.js';
import { AiPanel } from '../room/ui.js';
import { AI_STATUSES, asStatus, personaLabel, personaSub, presetFor } from './ai-profile-model.js';
import { AvatarPage } from './AvatarPage.js';
import { EditProfilePage } from './EditProfilePage.js';
import { MemoryPage } from './MemoryPage.js';
import { AiFace, Card, NavRow, Sky, SplitPane, StatusDot, useIsWide } from './pastel.js';
import { PersonalityPage } from './PersonalityPage.js';
import { ProPage } from './ProPage.js';
import { VoicePage } from './VoicePage.js';

export type ProfilePageId = 'home' | 'edit' | 'avatar' | 'personality' | 'voice' | 'memory' | 'pro';

export const DEFAULT_TAGLINE = 'Your personal AI agent';
export const DEFAULT_BIO = 'Pingo is your personal AI agent. I can help you with daily tasks, answer questions, research, plan, create and do things for you across your apps.';

/**
 * PINGO AI's profile, as this person sees and shapes it: the face, the name,
 * how it talks, how it sounds on a call, what it remembers. Everything here
 * is saved to their `ai_profiles` row and read by the chat and call functions.
 *
 * On a phone it is a stack of pages, each one opened from the profile. On a
 * laptop it is one window in two panes: who Pingo is on the left, always in
 * view, and the section being changed on the right, at a reading width.
 */
export function AiProfilePage({
  conversationId,
  onClose,
  onExit,
  onCall,
  onChanged,
  start = 'home',
}: {
  conversationId?: string | undefined;
  onClose: () => void;
  /** Close every PINGO AI panel and land in the chat (from inside the chat). */
  onExit?: (() => void) | undefined;
  /** Start a call with PINGO AI (from inside the chat). */
  onCall?: (() => void) | undefined;
  /** Something that changes how the chat looks (name, face) was saved. */
  onChanged?: (() => void) | undefined;
  start?: ProfilePageId;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { service } = useChat();
  const { profile } = useProfile();
  const { prefs, loaded, memoryCount } = useAiPrefs();
  const wide = useIsWide();
  const [page, setPage] = useState<ProfilePageId>(start);
  const [pub, setPub] = useState<AiPublicIdentity>();
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<string>();
  const noteTimer = useRef(0);

  useEffect(() => {
    void fetchAiPublicIdentity().then(setPub);
  }, []);

  const say = (text: string) => {
    setNote(text);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(undefined), 2200);
  };

  const premium = profile?.isPremium === true;
  const name = prefs.display_name?.trim() || 'Pingo AI';
  const tagline = prefs.tagline?.trim() || DEFAULT_TAGLINE;
  const bio = prefs.bio?.trim() || pub?.bio?.trim() || DEFAULT_BIO;
  const status = AI_STATUSES.find((s) => s.id === asStatus(prefs.status))!;
  const voice = AI_VOICES.find((v) => v.id === (prefs.voice ?? 'marin')) ?? AI_VOICES[0];
  const memorySub = !loaded
    ? 'Remembers your preferences, goals and important details'
    : prefs.memory_enabled === false
      ? 'Off. It saves nothing new.'
      : memoryCount
        ? `${memoryCount} ${memoryCount === 1 ? 'thing' : 'things'} it remembers about you`
        : 'Remembers your preferences, goals and important details';
  const freeFace = !prefs.avatar_url || prefs.avatar_url === '/ai/avatars/classic.webp';

  // On a laptop there is no profile page of its own: the sidebar is it, and the right pane opens on Profile.
  const shown: ProfilePageId = wide && page === 'home' ? 'edit' : page;
  const back = () => setPage('home');
  /** After a save: a phone goes back to the profile; a laptop stays where it is, the sidebar already shows the change. */
  const settle = (to: ProfilePageId = 'home') => {
    if (!wide) setPage(to);
  };

  const aiConversationId = async (): Promise<string> => conversationId ?? (await service.ensureAiConversation());

  const openChat = async () => {
    if (onExit) return onExit();
    try {
      const id = await aiConversationId();
      onClose();
      navigate(`/chats/${id}`);
    } catch {
      say("Couldn't open the chat. Try again.");
    }
  };

  const share = async () => {
    const link = profileLink(pub?.username ?? 'pingo_ai');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: name, text: `${name}: ${tagline}`, url: link });
        return;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      say('Link copied');
    } catch {
      say(link);
    }
  };

  const clearChat = async () => {
    if (!conversationId) return;
    if (!(await confirm({ title: 'Clear this chat?', description: 'Messages leave your side. The chat stays.', confirmLabel: 'Clear' }))) return;
    await service.clearConversations([conversationId]);
    say('Chat cleared');
  };

  const actions = [
    { label: 'Chat', icon: <MessageCircle size={wide ? 20 : 24} />, run: () => void openChat() },
    { label: 'Call', icon: <Phone size={wide ? 20 : 24} />, run: () => (onCall ? onCall() : void openChat()) },
    { label: 'Share', icon: <Share size={wide ? 20 : 24} />, run: () => void share() },
    { label: 'Customize', icon: <Sparkles size={wide ? 20 : 24} />, run: () => setPage('edit') },
  ];

  const sub =
    shown === 'edit' ? (
      <EditProfilePage
        pub={pub}
        aiConversationId={aiConversationId}
        onBack={back}
        onAvatar={() => setPage('avatar')}
        onSaved={() => {
          onChanged?.();
          say('Profile saved');
          settle();
        }}
      />
    ) : shown === 'avatar' ? (
      <AvatarPage
        premium={premium}
        onBack={() => setPage('edit')}
        onPro={() => setPage('pro')}
        onSaved={() => {
          onChanged?.();
          if (wide) say('Avatar updated');
          settle('edit');
        }}
      />
    ) : shown === 'personality' ? (
      <PersonalityPage
        onBack={back}
        onSaved={() => {
          say('Personality saved');
          settle();
        }}
      />
    ) : shown === 'voice' ? (
      <VoicePage onBack={back} />
    ) : shown === 'memory' ? (
      <MemoryPage onBack={back} />
    ) : shown === 'pro' ? (
      <ProPage premium={premium} onBack={back} />
    ) : null;

  const moreMenu = (
    <div className="relative">
      <button
        type="button"
        aria-label="More"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
        className="pp-card grid size-11 place-items-center rounded-full transition-colors active:scale-95 lg:hover:bg-[var(--pp-field)]"
      >
        <MoreVertical size={21} />
      </button>
      {menu && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-[1] cursor-default" onClick={() => setMenu(false)} />
          <div role="menu" className="pp-card absolute right-0 top-12 z-[2] w-52 py-1.5">
            {[
              { label: 'Edit profile', run: () => setPage('edit') },
              { label: 'Choose avatar', run: () => setPage('avatar') },
              { label: 'Personality', run: () => setPage('personality') },
              ...(conversationId ? [{ label: 'Clear chat', run: () => void clearChat() }] : []),
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  item.run();
                }}
                className="block w-full px-4 py-2.5 text-left text-[15.5px] font-medium active:bg-[var(--pp-field)] lg:hover:bg-[var(--pp-field)]"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const identity = (
    <div className="flex flex-col items-center text-center">
      <h2 className={cn('flex max-w-full items-center gap-1.5 font-extrabold tracking-[-0.02em]', wide ? 'mt-1 text-[24px]' : 'mt-2 text-[30px]')}>
        <span className="truncate">{name}</span>
        <BadgeCheck size={wide ? 22 : 26} className="shrink-0 fill-[var(--pp-accent)] text-[var(--pp-card)]" aria-label="PINGO AI" />
      </h2>
      <p className={cn('mt-0.5 text-[var(--pp-sub)]', wide ? 'text-[15px]' : 'text-[17px]')}>{tagline}</p>
      <button
        type="button"
        onClick={() => setPage('edit')}
        className="mt-2.5 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[14.5px] font-medium transition-[filter] lg:hover:brightness-95"
        style={{ color: status.id === 'online' ? '#16a34a' : status.id === 'away' ? '#b98500' : '#dc2626', background: `${status.dot}1f` }}
      >
        <StatusDot color={status.dot} />
        {status.label}
      </button>
    </div>
  );

  const toast = note && (
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-[5] flex justify-center px-6">
      <span className="max-w-full truncate rounded-full bg-[var(--pp-ink)] px-4 py-2 text-[14px] font-semibold text-[var(--pp-card)] shadow-lg">{note}</span>
    </div>
  );

  /* ---------- a laptop: two panes ---------- */
  if (wide) {
    const nav: { id: ProfilePageId; label: string; sub: string; icon: ReactNode }[] = [
      { id: 'edit', label: 'Profile', sub: 'Name, tagline, status and bio', icon: <UserRound size={20} /> },
      { id: 'avatar', label: 'Avatar', sub: presetFor(prefs.avatar_url)?.label ?? (prefs.avatar_url ? 'Your photo' : 'Classic'), icon: <ImageIcon size={20} /> },
      { id: 'personality', label: 'Personality', sub: personaLabel(prefs.personality), icon: <Smile size={20} /> },
      { id: 'voice', label: 'Voice', sub: voice.label, icon: <AudioLines size={20} /> },
      { id: 'memory', label: 'Memory', sub: prefs.memory_enabled === false ? 'Off' : `${memoryCount} saved`, icon: <Brain size={20} /> },
      { id: 'pro', label: 'Pingo Pro', sub: premium ? 'Active' : 'Not active', icon: <Crown size={20} /> },
    ];
    return (
      <AiPanel label={`${name} profile`} size="wide" onClose={onClose}>
        <div className="pingo-pastel relative flex h-full min-h-0">
          <aside className="relative flex w-[21.5rem] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-[var(--pp-line)]">
            <div className="relative h-[15rem] shrink-0">
              <Sky />
              <div className="absolute inset-x-0 top-0 z-[2] flex items-center justify-between px-5 pt-5">
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className="pp-card grid size-11 place-items-center rounded-full transition-colors active:scale-95 lg:hover:bg-[var(--pp-field)]"
                >
                  <X size={20} />
                </button>
                {moreMenu}
              </div>
              <button
                type="button"
                aria-label="Change avatar"
                title="Change avatar"
                onClick={() => setPage('avatar')}
                className="absolute bottom-0 left-1/2 z-[1] -translate-x-1/2 transition-transform hover:-translate-y-0.5"
              >
                <AiFace src={prefs.avatar_url} className={freeFace ? 'h-44 w-48' : 'size-36 ring-4 ring-[var(--pp-card)]'} />
              </button>
            </div>
            <div className="px-5 pb-6">
              {identity}
              <div className="mt-4 grid grid-cols-4 gap-2">
                {actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.run}
                    className="pp-card flex flex-col items-center gap-1.5 rounded-[16px] py-2.5 text-[12.5px] font-semibold transition-colors hover:bg-[var(--pp-field)] active:scale-[0.97]"
                  >
                    <span className="text-[var(--pp-accent)]">{a.icon}</span>
                    {a.label}
                  </button>
                ))}
              </div>
              <nav aria-label="Profile sections" className="mt-5 flex flex-col gap-1">
                {nav.map((n) => {
                  const on = shown === n.id;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      aria-current={on ? 'page' : undefined}
                      onClick={() => setPage(n.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors',
                        on ? 'bg-[var(--pp-card)] shadow-[var(--pp-shadow)]' : 'hover:bg-[var(--pp-card)]/60',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-9 shrink-0 place-items-center rounded-[11px]',
                          on ? 'bg-[var(--pp-accent)] text-[var(--pp-accent-ink)]' : 'bg-[var(--pp-accent-soft)] text-[var(--pp-accent)]',
                        )}
                      >
                        {n.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold leading-tight">{n.label}</span>
                        <span className="block truncate text-[13px] text-[var(--pp-sub)]">{n.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>
          <section className="pp-split relative flex min-w-0 flex-1 flex-col bg-[var(--pp-bg)]">
            <SplitPane.Provider value>{sub}</SplitPane.Provider>
          </section>
          {toast}
        </div>
      </AiPanel>
    );
  }

  /* ---------- a phone: the profile, then a page at a time ---------- */
  return (
    <AiPanel label={`${name} profile`} onClose={page === 'home' ? onClose : back}>
      <div className="pingo-pastel relative flex h-full min-h-0 flex-col">
        {sub ?? (
          <div className="relative flex-1 overflow-y-auto overscroll-contain pb-[max(1.75rem,env(safe-area-inset-bottom))]">
            {/* The hero: back, the menu, and the mascot on its clouds. */}
            <div className="relative h-[17.5rem]">
              <Sky />
              <div className="absolute inset-x-0 top-0 z-[2] flex items-center justify-between px-4 pt-[max(0.85rem,env(safe-area-inset-top))]">
                <button type="button" aria-label="Back" onClick={onClose} className="pp-card grid size-11 place-items-center rounded-full active:scale-95">
                  <ChevronRight size={22} className="rotate-180" />
                </button>
                {moreMenu}
              </div>
              <button
                type="button"
                aria-label="Change avatar"
                onClick={() => setPage('avatar')}
                className="absolute bottom-1 left-1/2 z-[1] -translate-x-1/2 active:scale-[0.98]"
              >
                <AiFace src={prefs.avatar_url} className={freeFace ? 'h-52 w-56' : 'size-44 ring-4 ring-[var(--pp-card)]'} />
              </button>
            </div>

            <div className="px-4">
              {identity}

              {/* What you can do with it, right now. */}
              <div className="mt-5 grid grid-cols-4 gap-2.5">
                {actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.run}
                    className="pp-card flex flex-col items-center gap-2 rounded-[18px] py-3.5 text-[14.5px] font-medium active:scale-[0.97]"
                  >
                    <span className="text-[var(--pp-accent)]">{a.icon}</span>
                    {a.label}
                  </button>
                ))}
              </div>

              <button type="button" onClick={() => setPage('edit')} className="pp-card mt-3 flex w-full items-start gap-3 px-4 py-4 text-left active:scale-[0.995]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-bold">About {name}</span>
                  <span className="mt-1 block text-[15px] leading-snug text-[var(--pp-sub)]">{bio}</span>
                </span>
                <ChevronRight size={20} className="mt-1 shrink-0 text-[var(--pp-sub)]" aria-hidden />
              </button>

              <div className="mt-3 flex flex-col gap-3">
                <Card>
                  <NavRow icon={<Smile size={26} />} title="Personality" sub={`${personaLabel(prefs.personality)}: ${personaSub(prefs.personality).toLowerCase()}`} onClick={() => setPage('personality')} />
                </Card>
                <Card>
                  <NavRow icon={<AudioLines size={26} />} title="Voice" sub={`${voice.label}${voice.id === 'marin' ? ' (Default)' : ''}`} onClick={() => setPage('voice')} />
                </Card>
                <Card>
                  <NavRow icon={<Brain size={26} />} title="Memory" sub={memorySub} onClick={() => setPage('memory')} />
                </Card>
                <button
                  type="button"
                  onClick={() => setPage('pro')}
                  className="pp-card flex w-full items-center gap-3 px-4 py-4 text-left active:scale-[0.995]"
                  style={{ background: 'var(--pp-pro)' }}
                >
                  <Crown size={30} className="shrink-0 fill-[var(--pp-gold)] text-[var(--pp-gold)]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-bold">Pingo Pro{premium ? ' · Active' : ''}</span>
                    <span className="mt-0.5 block text-[14.5px] leading-snug text-[var(--pp-sub)]">
                      Pro avatars and GIF covers
                    </span>
                  </span>
                  <ChevronRight size={20} className="shrink-0 text-[var(--pp-accent)]" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        )}
        {toast}
      </div>
    </AiPanel>
  );
}
