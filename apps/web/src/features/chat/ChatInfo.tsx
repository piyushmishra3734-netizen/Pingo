import {
  formatMuteUntil,
  formatPresence,
  useChat,
  useProfile,
  type Conversation,
  type Message,
  type Profile,
  type User,
} from '@pingo/core';
import { Avatar, ChevronLeftIcon, cn } from '@pingo/ui';
import {
  AtSign,
  AudioLines,
  Ban,
  Bell,
  BellOff,
  Briefcase,
  ChevronRight,
  FileText,
  Image as ImageGlyph,
  Link2,
  LogOut,
  MapPin,
  Phone,
  Play,
  Search,
  Timer,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';

import { useConfirm } from '../../components/ConfirmProvider.js';
import { AchievementMark } from '../achievements/AchievementArt.js';
import { useAchievements } from '../achievements/useAchievements.js';
import { MuteSheet } from '../conversations/MuteSheet.js';
import { useConversationActions } from '../conversations/useConversationActions.js';
import { useUnmuteConfirm } from '../conversations/useUnmuteConfirm.js';
import { disappearingLabel } from './ConversationMenu.js';
import { collectSharedMedia } from './shared-media.js';

/**
 * What opens when the name at the top of a chat is tapped: the person, or the
 * group, and everything you can do about this conversation.
 *
 * Telegram's arrangement. The chat header carries only back, the name and the
 * face; calling, searching, the media, the wallpaper and the rest live here,
 * one tap away, instead of as a row of icons on every screen of every chat.
 * The long tail - pin, favourite, lists, archive, clear, delete - stays in the
 * conversation menu, which this page carries in its top corner.
 *
 * Rendered into `body` rather than inside the thread. The thread sits on the
 * wallpaper and a dark wallpaper flips every colour under it to white; this is
 * a plain page and must read like one whatever the chat looks like.
 */
export interface ChatInfoProps {
  conversation: Conversation;
  /** The other person in a direct chat. */
  partner?: User;
  /** Everyone in the conversation, you included. */
  members: User[];
  isGroup: boolean;
  messages: readonly Message[];
  /** The line under the name, already decided by the thread: presence, or the network. */
  status: { text: string; live: boolean; busy: boolean };
  canCall: boolean;
  /** The conversation menu, trigger and all, for the corner. */
  menu: ReactNode;
  onClose: () => void;
  onSearch: () => void;
  onCall: (kind: 'voice' | 'video') => void;
  onManageGroup: () => void;
  onDisappearing: () => void;
  onJump: (messageId: string) => void;
}

export function ChatInfo(props: ChatInfoProps) {
  return createPortal(<ChatInfoPage {...props} />, document.body);
}

function ChatInfoPage({
  conversation,
  partner,
  members,
  isGroup,
  messages,
  status,
  canCall,
  menu,
  onClose,
  onSearch,
  onCall,
  onManageGroup,
  onDisappearing,
  onJump,
}: ChatInfoProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const confirmUnmute = useUnmuteConfirm();
  const actions = useConversationActions();
  const { service: profiles } = useProfile();
  const { service: chat, currentUser } = useChat();
  const achievements = useAchievements([partner?.id]);

  // Their profile, for the cover and the lines under the bio. Seeded from cache.
  const [person, setPerson] = useState<Profile | null | undefined>(() =>
    partner ? profiles.peek?.(partner.handle) : undefined,
  );
  const [inCommon, setInCommon] = useState<number>();
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!partner) return;
    let live = true;
    void profiles.find(partner.handle).then((p) => live && setPerson(p)).catch(() => undefined);
    void profiles.mutualFriends(partner.id).then((m) => live && setInCommon(m.total)).catch(() => undefined);
    void profiles.isBlocked(partner.id).then((b) => live && setBlocked(b)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [profiles, partner]);

  const [muting, setMuting] = useState(false);
  const toggleMute = () => {
    if (!conversation.muted) {
      setMuting(true);
      return;
    }
    void (async () => {
      if (await confirmUnmute(1, conversation.title)) await actions.mute([conversation.id], null);
    })();
  };

  const toggleBlock = async () => {
    if (!partner) return;
    const next = !blocked;
    const go = await confirm(
      next
        ? {
            title: `Block ${partner.name}?`,
            description:
              'They will not be able to call you or see your stories, and you will stop being friends. They are not told.',
            confirmLabel: 'Block',
          }
        : {
            title: `Unblock ${partner.name}?`,
            description: 'They will be able to message you again. Being friends is not restored.',
            tone: 'normal',
            confirmLabel: 'Unblock',
          },
    );
    if (!go) return;
    setBlocked(next);
    try {
      await profiles.setBlocked(partner.id, next);
    } catch {
      setBlocked(!next);
    }
  };

  const leave = async () => {
    const go = await confirm({
      title: `Leave ${conversation.title}?`,
      description: 'You will stop receiving its messages. Somebody in it can add you back.',
      confirmLabel: 'Leave',
    });
    if (!go) return;
    try {
      await chat.leaveGroup(conversation.id);
      onClose();
      navigate('/chats');
    } catch {
      // Still a member; nothing changed on screen.
    }
  };

  const online = members.filter((m) => m.id !== currentUser?.id && m.presence.state === 'online').length;
  const roster = useMemo(
    () =>
      [...members].sort((a, b) => {
        if (a.id === currentUser?.id) return -1;
        if (b.id === currentUser?.id) return 1;
        return Number(b.presence.state === 'online') - Number(a.presence.state === 'online');
      }),
    [members, currentUser?.id],
  );

  const cover = isGroup ? conversation.coverUrl : person?.bannerUrl;
  const bio = isGroup ? conversation.description : person?.bio ?? partner?.bio;
  const name = isGroup ? conversation.title : partner?.name ?? conversation.title;

  const hero = (
    <article className="overflow-hidden rounded-[28px] bg-surface">
      <div
        className="h-[120px] bg-brand-wash bg-cover bg-center [mask-image:linear-gradient(#000_40%,transparent)]"
        style={cover ? { backgroundImage: `url(${cover})` } : undefined}
      />
      <div className="relative -mt-11 px-[18px] pb-[18px]">
        <span className="inline-flex rounded-full ring-[3px] ring-surface">
          <Avatar
            name={name}
            id={partner?.id ?? conversation.id}
            src={partner?.avatarUrl ?? conversation.avatarUrl}
            size="hero"
          />
        </span>
        <h2 className="mt-2.5 flex items-center gap-1.5 text-[23px] font-bold leading-tight tracking-[-0.03em] text-ink">
          <span className="min-w-0 truncate">{name}</span>
          {partner && <AchievementMark achievement={achievements.lead(partner.id)} />}
        </h2>
        <p
          className={cn(
            'mt-0.5 flex items-center gap-1.5 text-[13.5px] font-semibold',
            status.live ? 'text-brand' : 'text-text-secondary',
          )}
        >
          {status.busy && (
            <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
          )}
          {isGroup && !status.busy ? `${members.length} members, ${online} online` : status.text}
        </p>
        {bio && <p className="mt-2 line-clamp-3 text-[14.5px] leading-snug text-text-secondary">{bio}</p>}
        {partner && (
          <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-text-secondary">
            <Fact icon={<AtSign size={14} />}>{partner.handle}</Fact>
            {person?.work && <Fact icon={<Briefcase size={14} />}>{person.work}</Fact>}
            {person?.location && <Fact icon={<MapPin size={14} />}>{person.location}</Fact>}
          </div>
        )}
      </div>
    </article>
  );

  return (
    <div
      className={cn(
        'fixed inset-0 z-[300] flex flex-col bg-page text-ink',
        // A panel on the right on a wide screen, the whole screen on a phone.
        'lg:left-auto lg:w-[26rem] lg:border-l lg:border-line lg:shadow-2xl',
        'animate-panel-in',
      )}
      role="dialog"
      aria-label={`${name}, info`}
    >
      <div className="flex shrink-0 items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to the chat"
          className="focus-ring grid size-10 place-items-center rounded-full bg-surface text-ink active:scale-[0.94]"
        >
          <ChevronLeftIcon size={22} />
        </button>
        <div className="grid size-10 place-items-center rounded-full bg-surface">{menu}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-10 [&>*]:flex-none">
        {partner ? (
          <Link to={`/profile/${partner.handle}`} className="focus-ring rounded-[28px]">
            {hero}
          </Link>
        ) : (
          hero
        )}

        <div className="grid grid-cols-4 gap-2">
          <Tile icon={conversation.muted ? <Bell size={21} /> : <BellOff size={21} />} onClick={toggleMute}>
            {conversation.muted ? 'Unmute' : 'Mute'}
          </Tile>
          <Tile icon={<Search size={21} />} onClick={onSearch}>
            Search
          </Tile>
          {isGroup ? (
            <>
              <Tile icon={<AudioLines size={21} />} onClick={() => onCall('voice')} dim={!canCall}>
                Voice chat
              </Tile>
              <Tile icon={<UserPlus size={21} />} onClick={onManageGroup}>
                Add
              </Tile>
            </>
          ) : (
            <>
              <Tile icon={<Phone size={21} />} onClick={() => onCall('voice')} dim={!canCall}>
                Call
              </Tile>
              <Tile icon={<Video size={21} />} onClick={() => onCall('video')} dim={!canCall}>
                Video
              </Tile>
            </>
          )}
        </div>

        {isGroup && (
          <section className="rounded-[28px] bg-surface p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-body font-semibold text-ink">{members.length} members</h3>
              <span className="text-caption text-text-secondary">{online} online</span>
            </div>
            <button type="button" onClick={onManageGroup} className="flex w-full items-center gap-3 py-2 text-left">
              <span className="grid size-10 place-items-center rounded-full bg-brand/15 text-brand">
                <UserPlus size={19} />
              </span>
              <span className="text-body font-semibold text-brand">Add members</span>
            </button>
            {roster.map((m) => (
              <div key={m.id} className="flex items-center gap-3 border-t border-line py-2">
                <Avatar name={m.name} id={m.id} src={m.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {m.id === currentUser?.id ? 'You' : m.name}
                  </span>
                  <span
                    className={cn(
                      'block truncate text-[12.5px]',
                      m.presence.state === 'online' ? 'text-brand' : 'text-text-secondary',
                    )}
                  >
                    {m.presence.state === 'online' ? 'online' : formatPresence(m)}
                  </span>
                </span>
                {conversation.adminIds?.includes(m.id) && (
                  <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-bold text-brand">admin</span>
                )}
              </div>
            ))}
          </section>
        )}

        <Shared messages={messages} onOpen={(id) => { onClose(); onJump(id); }} />

        <section className="rounded-[28px] bg-surface px-4 py-1">
          {partner && (
            <Row icon={<Users size={19} />} onClick={() => navigate(`/profile/${partner.handle}`)} value={inCommon ? String(inCommon) : undefined}>
              Friends in common
            </Row>
          )}
          <Row
            icon={<ImageGlyph size={19} />}
            onClick={() => navigate(`/settings/wallpaper?c=${encodeURIComponent(conversation.id)}`)}
          >
            Wallpaper
          </Row>
          <Row
            icon={<Timer size={19} />}
            onClick={onDisappearing}
            value={conversation.disappearSeconds ? disappearingLabel(conversation.disappearSeconds) : 'Off'}
          >
            Disappearing messages
          </Row>
          {conversation.muted && formatMuteUntil(conversation.mutedUntil) && (
            <Row icon={<BellOff size={19} />} onClick={toggleMute} value={formatMuteUntil(conversation.mutedUntil)}>
              Muted
            </Row>
          )}
          {partner ? (
            <Row icon={<Ban size={19} />} onClick={() => void toggleBlock()} danger>
              {blocked ? `Unblock ${partner.name.split(' ')[0]}` : `Block ${partner.name.split(' ')[0]}`}
            </Row>
          ) : (
            isGroup && (
              <Row icon={<LogOut size={19} />} onClick={() => void leave()} danger>
                Leave group
              </Row>
            )
          )}
        </section>
      </div>

      {muting && (
        <MuteSheet
          count={1}
          onCancel={() => setMuting(false)}
          onChoose={(ms) => {
            setMuting(false);
            void actions.mute([conversation.id], ms);
          }}
        />
      )}
    </div>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-text-tertiary">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

function Tile({ icon, onClick, dim = false, children }: { icon: ReactNode; onClick: () => void; dim?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'focus-ring flex h-[66px] flex-col items-center justify-center gap-1 rounded-[20px] bg-surface',
        'text-[12px] font-semibold transition-transform duration-instant active:scale-[0.96]',
        dim ? 'text-text-tertiary' : 'text-brand',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Row({
  icon,
  onClick,
  value,
  danger = false,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  value?: string | undefined;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 border-t border-line py-3 text-left text-[15px] font-medium first:border-t-0',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      <span className={danger ? 'text-danger' : 'text-text-secondary'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {value && <span className="text-[13.5px] text-text-secondary">{value}</span>}
      {!danger && <ChevronRight size={16} className="text-text-tertiary" />}
    </button>
  );
}

/** Media, links and files from the messages already loaded, as three tabs. */
function Shared({ messages, onOpen }: { messages: readonly Message[]; onOpen: (messageId: string) => void }) {
  const found = useMemo(() => collectSharedMedia(messages), [messages]);
  const [tab, setTab] = useState<'media' | 'links' | 'files'>('media');
  const tabs = [
    ['media', 'Media'],
    ['links', 'Links'],
    ['files', 'Files'],
  ] as const;

  return (
    <section className="rounded-[28px] bg-surface p-4">
      <div className="mb-2.5 flex gap-1 rounded-full bg-sunken p-[3px]">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'h-8 flex-1 rounded-full text-[13px] font-semibold transition-colors duration-instant',
              tab === id ? 'bg-brand text-on-brand' : 'text-text-secondary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'media' &&
        (found.media.length ? (
          <div className="grid grid-cols-3 gap-[3px] overflow-hidden rounded-2xl">
            {found.media.slice(0, 9).map((item) => (
              <button
                key={item.messageId + (item.url ?? '')}
                type="button"
                onClick={() => onOpen(item.messageId)}
                className="relative aspect-square bg-sunken"
              >
                {item.url && item.kind === 'image' && (
                  <img src={item.url} alt="" loading="lazy" className="size-full object-cover" />
                )}
                {item.kind === 'video' && (
                  <span className="absolute inset-0 grid place-items-center text-text-secondary">
                    <Play size={20} />
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <Empty>No photos or videos yet</Empty>
        ))}

      {tab === 'links' &&
        (found.links.length ? (
          found.links.slice(0, 8).map((link) => (
            <button
              key={link.messageId + link.href}
              type="button"
              onClick={() => onOpen(link.messageId)}
              className="flex w-full items-center gap-3 border-t border-line py-2.5 text-left first:border-t-0"
            >
              <Link2 size={18} className="shrink-0 text-text-secondary" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-brand">{link.value}</span>
            </button>
          ))
        ) : (
          <Empty>No links yet</Empty>
        ))}

      {tab === 'files' &&
        (found.docs.length ? (
          found.docs.slice(0, 8).map((doc) => (
            <button
              key={doc.messageId + doc.fileName}
              type="button"
              onClick={() => onOpen(doc.messageId)}
              className="flex w-full items-center gap-3 border-t border-line py-2.5 text-left first:border-t-0"
            >
              <FileText size={18} className="shrink-0 text-text-secondary" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{doc.fileName}</span>
            </button>
          ))
        ) : (
          <Empty>No files yet</Empty>
        ))}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-caption text-text-tertiary">{children}</p>;
}
