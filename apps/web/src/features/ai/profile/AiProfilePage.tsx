import { useChat, useProfile } from '@pingo/core';
import { cn } from '@pingo/ui';
import {
  AudioLines,
  BadgeCheck,
  Brain,
  ChevronRight,
  Crown,
  MessageCircle,
  MoreVertical,
  Phone,
  Share,
  Smile,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useConfirm } from '../../../components/ConfirmProvider.js';
import { profileLink } from '../../profile/ShareProfileSheet.js';
import { fetchAiPublicIdentity, type AiPublicIdentity } from '../ai-public.js';
import { AI_VOICES, useAiPrefs } from '../room/ai-prefs.js';
import { AiPanel } from '../room/ui.js';
import { AI_STATUSES, asStatus, personaLabel, personaSub } from './ai-profile-model.js';
import { AvatarPage } from './AvatarPage.js';
import { EditProfilePage } from './EditProfilePage.js';
import { MemoryPage } from './MemoryPage.js';
import { AiFace, Card, NavRow, Sky, StatusDot } from './pastel.js';
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
    setMenu(false);
    if (!conversationId) return;
    if (!(await confirm({ title: 'Clear this chat?', description: 'Messages leave your side. The chat stays.', confirmLabel: 'Clear' }))) return;
    await service.clearConversations([conversationId]);
    say('Chat cleared');
  };

  const back = () => setPage('home');
  const sub =
    page === 'edit' ? (
      <EditProfilePage
        pub={pub}
        aiConversationId={aiConversationId}
        onBack={back}
        onAvatar={() => setPage('avatar')}
        onSaved={() => {
          onChanged?.();
          say('Profile saved');
          back();
        }}
      />
    ) : page === 'avatar' ? (
      <AvatarPage
        premium={premium}
        onBack={() => setPage('edit')}
        onPro={() => setPage('pro')}
        onSaved={() => {
          onChanged?.();
          setPage('edit');
        }}
      />
    ) : page === 'personality' ? (
      <PersonalityPage onBack={back} onSaved={() => { say('Personality saved'); back(); }} />
    ) : page === 'voice' ? (
      <VoicePage onBack={back} />
    ) : page === 'memory' ? (
      <MemoryPage onBack={back} />
    ) : page === 'pro' ? (
      <ProPage premium={premium} onBack={back} />
    ) : null;

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
                <div className="relative">
                  <button
                    type="button"
                    aria-label="More"
                    aria-expanded={menu}
                    onClick={() => setMenu((m) => !m)}
                    className="pp-card grid size-11 place-items-center rounded-full active:scale-95"
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
                            className="block w-full px-4 py-2.5 text-left text-[15.5px] font-medium active:bg-[var(--pp-field)]"
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-label="Change avatar"
                onClick={() => setPage('avatar')}
                className="absolute bottom-1 left-1/2 z-[1] -translate-x-1/2 active:scale-[0.98]"
              >
                <AiFace src={prefs.avatar_url} className={prefs.avatar_url && prefs.avatar_url !== '/ai/avatars/classic.webp' ? 'size-44 ring-4 ring-[var(--pp-card)]' : 'h-52 w-56'} />
              </button>
            </div>

            <div className="px-4">
              <div className="flex flex-col items-center text-center">
                <h2 className="mt-2 flex items-center gap-1.5 text-[30px] font-extrabold tracking-[-0.02em]">
                  <span className="truncate">{name}</span>
                  <BadgeCheck size={26} className="shrink-0 fill-[var(--pp-accent)] text-[var(--pp-card)]" aria-label="PINGO AI" />
                </h2>
                <p className="mt-0.5 text-[17px] text-[var(--pp-sub)]">{tagline}</p>
                <button
                  type="button"
                  onClick={() => setPage('edit')}
                  className="mt-2.5 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[15px] font-medium"
                  style={{ color: status.id === 'online' ? '#16a34a' : status.id === 'away' ? '#b98500' : '#dc2626', background: `${status.dot}1f` }}
                >
                  <StatusDot color={status.dot} />
                  {status.label}
                </button>
              </div>

              {/* What you can do with it, right now. */}
              <div className="mt-5 grid grid-cols-4 gap-2.5">
                {[
                  { label: 'Chat', icon: <MessageCircle size={24} />, run: () => void openChat() },
                  {
                    label: 'Call',
                    icon: <Phone size={24} />,
                    run: () => {
                      if (onCall) onCall();
                      else void openChat();
                    },
                  },
                  { label: 'Share', icon: <Share size={24} />, run: () => void share() },
                  { label: 'Customize', icon: <Sparkles size={24} />, run: () => setPage('edit') },
                ].map((a) => (
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
                  <NavRow
                    icon={<Brain size={26} />}
                    title="Memory"
                    sub={
                      !loaded
                        ? 'Remembers your preferences, goals and important details'
                        : prefs.memory_enabled === false
                          ? 'Off. It saves nothing new.'
                          : memoryCount
                            ? `${memoryCount} ${memoryCount === 1 ? 'thing' : 'things'} it remembers about you`
                            : 'Remembers your preferences, goals and important details'
                    }
                    onClick={() => setPage('memory')}
                  />
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
                      {premium ? 'Pro avatars, HD photos and videos, GIF covers' : 'Pro avatars, HD photos and videos, and more'}
                    </span>
                  </span>
                  <ChevronRight size={20} className="shrink-0 text-[var(--pp-accent)]" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        )}
        {note && (
          <div role="status" className="pointer-events-none absolute inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-[5] flex justify-center px-6">
            <span className={cn('max-w-full truncate rounded-full bg-[var(--pp-ink)] px-4 py-2 text-[14px] font-semibold text-[var(--pp-card)] shadow-lg')}>{note}</span>
          </div>
        )}
      </div>
    </AiPanel>
  );
}
