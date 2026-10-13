import { useChat, useProfile } from '@pingo/core';
import { Avatar, PingoDot, Toggle, cn } from '@pingo/ui';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Sheet } from '../../components/Sheet.js';
import { useConfirm } from '../../components/ConfirmProvider.js';
import { useT } from '../i18n/useT.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import type { AiProfileRow } from '../../lib/supabase/types.js';
import {
  fetchAiPublicIdentity,
  isAiOwner,
  type AiPublicIdentity,
} from './ai-public.js';
import { AiMemoriesSheet } from './AiMemoriesSheet.js';
import { IMMUTABLE_CACHE_SECONDS, shrinkToAvatar } from '../profile/avatar-image.js';
import {
  PERSONALITIES,
  orderedLanguages,
  pushRecentLanguage,
  RESPONSE_LENGTHS,
  type PersonalityId,
} from './personalities.js';

/**
 * Contact-style editor for PINGO AI.
 *
 * Profile card on top (cover + face + identity), then calm settings cards.
 * Ink product chrome — not a leftover purple control panel.
 */
export function AiProfileSheet({
  conversationId,
  onClose,
  onChanged,
}: {
  conversationId?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const t = useT();
  const { profile } = useProfile();
  const { service } = useChat();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);

  const [pub, setPub] = useState<AiPublicIdentity>();
  const [owner, setOwner] = useState(false);
  const [prefs, setPrefs] = useState<Partial<AiProfileRow>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [picker, setPicker] = useState<'personality' | 'length' | 'language'>();
  const [memoryCount, setMemoryCount] = useState(0);

  const refreshMemoryCount = () => {
    if (!profile) return;
    void getSupabaseClient()
      .from('ai_memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .then(({ count }) => setMemoryCount(count ?? 0));
  };

  useEffect(() => {
    refreshMemoryCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, memoriesOpen]);

  useEffect(() => {
    void fetchAiPublicIdentity().then(setPub);
    void isAiOwner().then(setOwner);
  }, []);

  useEffect(() => {
    if (!profile) return;
    void getSupabaseClient()
      .from('ai_profiles')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs(data);
      });
  }, [profile]);

  const faceName = prefs.display_name?.trim() || pub?.displayName || 'PINGO';
  const faceSrc = prefs.avatar_url || pub?.avatarUrl || '/pingo-avatar.png';
  /*
   * Their own cover if they set one; otherwise PINGO's, drawn from the logo.
   * The shared picture that used to fill this read as generated art, and a
   * brand's own assistant should look like the brand.
   */
  const bannerSrc = prefs.banner_url ?? undefined;
  const bannerOffset = 50;
  const faceBio =
    prefs.bio?.trim() ||
    pub?.bio?.trim() ||
    'Always down to chat. Not a product — someone to talk to.';
  const personality = (prefs.personality as PersonalityId) || 'friendly';
  const length = prefs.response_length ?? 'short';
  const lengthPreview =
    RESPONSE_LENGTHS.find((l) => l.id === length)?.preview ?? RESPONSE_LENGTHS[0]!.preview;
  const langs = orderedLanguages(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
  );

  const uploadToAvatars = async (file: File, kind: 'avatar' | 'banner') => {
    if (!profile) return;
    setBusy(true);
    setError(undefined);
    try {
      const client = getSupabaseClient();
      const path = `${profile.id}/ai-${kind}-${Date.now()}`;
      // Shrunk and cached like every other face - see `avatar-image.ts`.
      const small = await shrinkToAvatar(file);
      const { error: upError } = await client.storage
        .from('avatars')
        .upload(path, small, {
          upsert: true,
          contentType: small.type || 'image/jpeg',
          cacheControl: IMMUTABLE_CACHE_SECONDS,
        });
      if (upError) throw upError;
      const { data } = client.storage.from('avatars').getPublicUrl(path);
      const url = data.publicUrl;

      /*
       * The operator is not editing their own copy - they are editing the one
       * everybody gets. Writing the personal row as well is what made this look
       * broken from the inside: the change landed globally *and* locally, the
       * local one shadowed it, and the only account that could not tell the
       * difference was the one making the change.
       *
       * So for the owner it is the shared face and nothing else. Every other
       * account writes only its own row, which is the whole point of having one.
       */
      if (owner) {
        const { error: rpcError } = await client.rpc('update_ai_public_identity', {
          ...(kind === 'avatar' ? { new_avatar_url: url } : { new_banner_url: url }),
        });
        if (rpcError) throw rpcError;
        setPub((p) =>
          p ? { ...p, ...(kind === 'avatar' ? { avatarUrl: url } : { bannerUrl: url }) } : p,
        );
      } else {
        await savePrefs(kind === 'avatar' ? { avatar_url: url } : { banner_url: url });
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : kind === 'banner'
            ? 'Could not upload banner.'
            : 'Could not upload photo.',
      );
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async (patch: Partial<AiProfileRow>) => {
    if (!profile) return;
    if (patch.personality && patch.personality !== 'custom') {
      patch = { ...patch, custom_personality: null };
    }
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setBusy(true);
    setError(undefined);
    try {
      if (next.language) pushRecentLanguage(next.language);
      const { error: writeError } = await getSupabaseClient()
        .from('ai_profiles')
        .upsert({
          user_id: profile.id,
          /*
           * `faceName` is the *resolved* name - their override or the shared
           * one. Writing it back turned "I never chose a name" into "I chose
           * exactly the name it had that day", one save at a time, and the AI
           * could never be renamed for anybody again.
           */
          display_name: next.display_name?.trim() || null,
          bio: next.bio?.trim() ? next.bio.trim().slice(0, 160) : null,
          personality: next.personality ?? 'friendly',
          custom_personality:
            (next.personality ?? 'friendly') === 'custom'
              ? next.custom_personality ?? null
              : null,
          response_length: next.response_length ?? 'short',
          preferred_name: next.preferred_name ?? null,
          language: next.language ?? null,
          memory_enabled: next.memory_enabled ?? true,
          avatar_url: next.avatar_url ?? null,
          banner_url: next.banner_url ?? null,
          updated_at: new Date().toISOString(),
        });
      if (writeError) throw writeError;
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const saveSharedDefaultBio = async (bio: string) => {
    if (!owner) return;
    setBusy(true);
    try {
      const { error: rpcError } = await getSupabaseClient().rpc('update_ai_public_identity', {
        new_bio: bio.trim().slice(0, 160),
      });
      if (rpcError) throw rpcError;
      setPub((p) => (p ? { ...p, bio: bio.trim().slice(0, 160) } : p));
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save default bio.');
    } finally {
      setBusy(false);
    }
  };

  const resetPersonality = async () => {
    const go = await confirm({
      title: t('ai.resetPersonalityQ'),
      description: t('ai.resetPersonalityBody'),
      confirmLabel: t('ai.reset'),
    });
    if (!go) return;
    await savePrefs({
      personality: 'friendly',
      custom_personality: null,
      response_length: 'short',
    });
  };

  const resetMemory = async () => {
    if (!profile) return;
    const go = await confirm({
      title: t('ai.resetMemoryQ'),
      description: t('ai.resetMemoryBody'),
      confirmLabel: t('ai.resetMemory'),
    });
    if (!go) return;
    await getSupabaseClient().from('ai_memories').delete().eq('user_id', profile.id);
    setMemoryCount(0);
  };

  const clearChat = async () => {
    if (!conversationId) return;
    const go = await confirm({
      title: 'Clear this chat?',
      description: 'Messages leave your side. The chat stays in the list.',
      confirmLabel: 'Clear messages',
    });
    if (!go) return;
    await service.clearConversations([conversationId]);
    onClose();
  };

  const deleteChat = async () => {
    if (!conversationId) return;
    const go = await confirm({
      title: 'Delete this chat?',
      description: 'Removed from your list. You can open PINGO again from +.',
      confirmLabel: 'Delete chat',
    });
    if (!go) return;
    await service.deleteConversations([conversationId]);
    onClose();
    navigate('/chats');
  };

  return (
    <>
      <Sheet
        title={`${faceName} — AI profile`}
        hideTitle
        onClose={onClose}
        className={cn(
          /* Kill default Sheet padding so cover is edge-to-edge. */
          '!max-h-[min(92vh,48rem)] !max-w-md !overflow-x-hidden !overflow-y-auto !p-0 !pb-0',
          'sm:!max-w-md sm:!rounded-2xl sm:!p-0 sm:!pb-0',
        )}
      >
        <input
          ref={avatarFileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void uploadToAvatars(file, 'avatar');
          }}
        />
        <input
          ref={bannerFileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void uploadToAvatars(file, 'banner');
          }}
        />

        {/*
          Cover is the first thing in the sheet — full width, full banner box.
          Controls float ON the cover so nothing steals height above it.
        */}
        <div className="relative w-full">
          <div
            className={cn(
              'relative w-full overflow-hidden bg-surface',
              /* Tall full-bleed cover — not a thin strip. */
              'aspect-[2/1] min-h-[11.5rem] max-h-[14rem] sm:min-h-[12.5rem]',
            )}
          >
            {bannerSrc ? (
              <img
                src={bannerSrc}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                /*
                 * Where the crop sits, not always the middle. A cover is a wide
                 * band taken out of a photo that was almost never wide, and the
                 * middle of a portrait is a chin.
                 */
                style={{ objectPosition: `50% ${bannerOffset}%` }}
                draggable={false}
              />
            ) : (
              <div className="absolute inset-0 h-full w-full overflow-hidden bg-surface">
                {/* The sweep, soft, with the mark large and off to one side - PINGO's own cover. */}
                <div className="bg-sweep absolute inset-0 opacity-30" />
                <div className="absolute inset-0 bg-[radial-gradient(80%_90%_at_15%_20%,var(--color-surface)_0%,transparent_70%)] opacity-60" />
                <img
                  src="/pingo-mark.svg"
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="absolute -top-6 -right-8 size-56 rotate-[-8deg] opacity-90 drop-shadow-[0_18px_40px_rgba(139,93,255,0.35)]"
                />
              </div>
            )}
            {/* Soft bottom fade only — cover still reads full frame */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-surface to-transparent" />

            {/* Floating controls on cover */}
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[0.8125rem] font-medium text-ink',
                  'border border-line bg-surface/92 shadow-sm',
                  'active:scale-[0.97]',
                  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                )}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => bannerFileRef.current?.click()}
                disabled={busy}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[0.75rem] font-medium text-ink',
                  'border border-line bg-surface/92 shadow-sm',
                  'active:scale-[0.97] disabled:opacity-50',
                  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                )}
              >
                {bannerSrc ? t('ai.changeCover') : t('ai.addCover')}
              </button>
            </div>
          </div>

          {/* Identity — face ring must be square grid so ring is a circle, not oval */}
          <div className="relative -mt-12 flex flex-col items-center px-5 pb-5 text-center">
            <button
              type="button"
              onClick={() => avatarFileRef.current?.click()}
              disabled={busy}
              className={cn(
                /*
                  Same oval-ring fix as StoryRing / AvatarStack:
                  a plain button is a line box; rounded-full on a non-square
                  line box paints an egg. Grid + fixed size = true circle.
                */
                'relative inline-grid shrink-0 place-items-center rounded-full',
                'size-[6.5rem] bg-surface p-1',
                'shadow-[0_4px_20px_rgba(17,17,19,0.12)] ring-2 ring-surface',
                'active:scale-[0.98] disabled:opacity-50',
                'outline-none focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-offset-2 focus-visible:outline-ink',
              )}
              aria-label={t('ai.changePhoto')}
            >
              <Avatar
                name={faceName}
                id="pingo-ai"
                src={faceSrc}
                size="xl"
                presence="online"
              />
              <span
                className={cn(
                  'pointer-events-none absolute bottom-0 left-1/2 z-[1]',
                  '-translate-x-1/2 translate-y-1/4',
                  'rounded-full bg-brand px-2.5 py-0.5',
                  'text-[10px] font-semibold tracking-wide text-on-brand shadow-sm',
                )}
              >
                Edit
              </span>
            </button>

            <div className="mt-5 flex items-center gap-1.5">
              <PingoDot state="online" size={6} />
              <span className="text-[0.75rem] font-medium text-text-secondary">Always here</span>
            </div>
            <h2 className="mt-1.5 text-[1.5rem] font-semibold tracking-[-0.03em] text-ink">
              {faceName}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-text-tertiary">
              @{pub?.username ?? 'pingo_ai'}
            </p>
            <p className="mt-2 max-w-[18rem] text-[0.8125rem] leading-relaxed text-text-secondary">
              {faceBio}
            </p>
          </div>
        </div>

        {/*
          Settings the way a phone's own Settings are: grouped rows, a value on
          the right, a list with a tick behind it. The grid of personality tiles
          and the chip clouds this replaced looked generated - this looks like
          the rest of the phone.
        */}
        {picker ? (
          <div className="bg-page px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => setPicker(undefined)} className="mb-2 flex items-center gap-1 py-2 text-[15px] font-medium text-brand">
              <ChevronLeft size={20} />Back
            </button>
            {picker === 'personality' && (
              <Group title="Personality" footer={PERSONALITIES.find((x) => x.id === personality)?.preview}>
                {PERSONALITIES.map((x) => (
                  <PickRow key={x.id} label={x.label} sub={x.hint} on={personality === x.id} onPick={() => void savePrefs({ personality: x.id })} />
                ))}
              </Group>
            )}
            {picker === 'personality' && personality === 'custom' && (
              <Group title="Their vibe, in your words" footer="Saved when you leave the box.">
                <textarea
                  value={prefs.custom_personality ?? ''}
                  onChange={(e) => setPrefs((r) => ({ ...r, custom_personality: e.target.value.slice(0, 200) }))}
                  onBlur={() => void savePrefs({ custom_personality: prefs.custom_personality ?? null })}
                  rows={3}
                  placeholder={t('ai.vibePh')}
                  className="block w-full resize-none bg-transparent px-4 py-3 text-[16px] text-ink outline-none placeholder:text-text-tertiary"
                />
              </Group>
            )}
            {picker === 'length' && (
              <Group title="Replies" footer={lengthPreview}>
                {RESPONSE_LENGTHS.map((l) => (
                  <PickRow key={l.id} label={l.label} on={length === l.id} onPick={() => void savePrefs({ response_length: l.id })} />
                ))}
              </Group>
            )}
            {picker === 'language' && (
              <Group title="Language">
                {langs.map((l) => (
                  <PickRow key={l.id} label={l.label} on={(prefs.language ?? 'en') === l.id} onPick={() => void savePrefs({ language: l.id })} />
                ))}
              </Group>
            )}
          </div>
        ) : (
          <div className="bg-page px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <Group>
              <FieldRow label="Name">
                <input
                  value={prefs.display_name ?? faceName}
                  onChange={(e) => setPrefs((r) => ({ ...r, display_name: e.target.value.slice(0, 40) }))}
                  onBlur={() => void savePrefs({ display_name: prefs.display_name })}
                  className={rowInput}
                />
              </FieldRow>
              <FieldRow label="Calls you">
                <input
                  value={prefs.preferred_name ?? ''}
                  onChange={(e) => setPrefs((r) => ({ ...r, preferred_name: e.target.value.slice(0, 40) }))}
                  onBlur={() => void savePrefs({ preferred_name: prefs.preferred_name?.trim() || null })}
                  placeholder={profile?.displayName || t('ai.callYouTitle')}
                  className={rowInput}
                />
              </FieldRow>
              <label className="block px-4 py-3">
                <span className="block text-[13px] text-text-secondary">Bio</span>
                <textarea
                  value={prefs.bio ?? ''}
                  onChange={(e) => setPrefs((r) => ({ ...r, bio: e.target.value.slice(0, 160) }))}
                  onBlur={() => void savePrefs({ bio: prefs.bio ?? null })}
                  rows={2}
                  placeholder={pub?.bio?.trim() || 'How they show up for you'}
                  className="mt-1 block w-full resize-none bg-transparent text-[16px] leading-snug text-ink outline-none placeholder:text-text-tertiary"
                />
              </label>
              {owner && (
                <ActionRow label="Use this bio for everyone" onClick={() => void saveSharedDefaultBio((prefs.bio?.trim() || faceBio).slice(0, 160))} />
              )}
            </Group>

            <Group title="How they talk">
              <NavRow label="Personality" value={PERSONALITIES.find((x) => x.id === personality)?.label ?? 'Friendly'} onClick={() => setPicker('personality')} />
              <NavRow label="Replies" value={RESPONSE_LENGTHS.find((l) => l.id === length)?.label ?? 'Short'} onClick={() => setPicker('length')} />
              <NavRow label="Language" value={(langs.find((l) => l.id === (prefs.language ?? 'en'))?.label ?? 'English')} onClick={() => setPicker('language')} />
            </Group>

            <Group
              title="Memory"
              footer="Messages here are processed so they can reply, and those copies clear after about 24 hours. This chat is not end-to-end encrypted."
            >
              <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                <span className="text-[16px] text-ink">{t('ai.rememberMe')}</span>
                <Toggle
                  checked={Boolean(prefs.memory_enabled ?? true)}
                  onChange={(memory_enabled) => void savePrefs({ memory_enabled })}
                  label={t('ai.rememberMe')}
                />
              </div>
              {prefs.memory_enabled !== false && (
                <NavRow label={t('ai.memories')} value={memoryCount > 0 ? String(memoryCount) : ''} onClick={() => setMemoriesOpen(true)} />
              )}
            </Group>

            <Group>
              <ActionRow label={t('ai.resetPersonality')} onClick={() => void resetPersonality()} />
              <ActionRow label={t('ai.resetMemory')} onClick={() => void resetMemory()} />
              {conversationId && <ActionRow label={t('ai.clearChat')} onClick={() => void clearChat()} />}
            </Group>
            {conversationId && (
              <Group>
                <ActionRow label={t('ai.deleteChat')} danger onClick={() => void deleteChat()} />
              </Group>
            )}

            {error && (
              <p className="mt-3 text-center text-[13px] text-danger" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Sheet>

      {memoriesOpen && <AiMemoriesSheet onClose={() => setMemoriesOpen(false)} />}
    </>
  );
}

const rowInput = 'min-w-0 flex-1 bg-transparent text-right text-[16px] text-text-secondary outline-none placeholder:text-text-tertiary focus:text-ink';

/** An inset group: optional title above, rows on one card, optional footnote below. */
function Group({ title, footer, children }: { title?: string; footer?: string | undefined; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      {title && <h3 className="mb-1.5 px-4 text-[13px] text-text-secondary">{title}</h3>}
      <div className="overflow-hidden rounded-[14px] bg-surface [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
      {footer && <p className="mt-1.5 px-4 text-[13px] leading-snug text-text-tertiary">{footer}</p>}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-h-12 items-center gap-3 px-4">
      <span className="shrink-0 text-[16px] text-ink">{label}</span>
      {children}
    </label>
  );
}

function NavRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-2 px-4 text-left active:bg-hover">
      <span className="flex-1 text-[16px] text-ink">{label}</span>
      <span className="truncate text-[16px] text-text-secondary">{value}</span>
      <ChevronRight size={18} className="shrink-0 text-text-tertiary" />
    </button>
  );
}

function PickRow({ label, sub, on, onPick }: { label: string; sub?: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-hover">
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] text-ink">{label}</span>
        {sub && <span className="block text-[13px] text-text-tertiary">{sub}</span>}
      </span>
      {on && <Check size={20} strokeWidth={2.5} className="shrink-0 text-brand" />}
    </button>
  );
}

function ActionRow({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex min-h-12 w-full items-center px-4 text-left text-[16px] active:bg-hover', danger ? 'text-danger' : 'text-brand')}>
      {label}
    </button>
  );
}
