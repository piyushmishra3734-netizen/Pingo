import { useChat, useProfile } from '@pingo/core';
import { Avatar, Button, PingoDot, Toggle, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Sheet } from '../../components/Sheet.js';
import { useConfirm } from '../../components/ConfirmProvider.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import type { AiProfileRow } from '../../lib/supabase/types.js';
import {
  fetchAiPublicIdentity,
  isAiOwner,
  type AiPublicIdentity,
} from './ai-public.js';
import { AiMemoriesSheet } from './AiMemoriesSheet.js';
import { AiPersonalityGrid } from './AiPersonalityGrid.js';
import {
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
  const faceSrc = prefs.avatar_url || pub?.avatarUrl;
  const bannerSrc = prefs.banner_url ?? undefined;
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
      const { error: upError } = await client.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
      if (upError) throw upError;
      const { data } = client.storage.from('avatars').getPublicUrl(path);
      const url = data.publicUrl;

      if (kind === 'avatar' && owner) {
        const { error: rpcError } = await client.rpc('update_ai_public_identity', {
          new_avatar_url: url,
        });
        if (rpcError) throw rpcError;
        setPub((p) => (p ? { ...p, avatarUrl: url } : p));
      }

      const patch = kind === 'avatar' ? { avatar_url: url } : { banner_url: url };
      await savePrefs(patch);
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
          display_name: (next.display_name ?? faceName).trim() || 'PINGO',
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
      title: 'Reset personality?',
      description: 'Back to Friendly, short replies.',
      confirmLabel: 'Reset',
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
      title: 'Reset memory?',
      description: 'All saved notes are removed. Memory stays on.',
      confirmLabel: 'Reset memory',
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

  const field =
    'w-full rounded-xl border border-black/[0.07] bg-white px-3.5 py-2.5 text-[0.9375rem] text-ink ' +
    'placeholder:text-text-tertiary outline-none transition-[border-color,box-shadow] duration-150 ' +
    'focus:border-black/20 focus:shadow-[0_0_0_3px_rgba(17,17,19,0.06)]';

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
              'relative w-full overflow-hidden bg-[#E8E8EA]',
              /* Tall full-bleed cover — not a thin strip. */
              'aspect-[2/1] min-h-[11.5rem] max-h-[14rem] sm:min-h-[12.5rem]',
            )}
          >
            {bannerSrc ? (
              <img
                src={bannerSrc}
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-center"
                draggable={false}
              />
            ) : (
              <div
                className="absolute inset-0 h-full w-full"
                style={{
                  background:
                    'radial-gradient(90% 80% at 20% 0%, rgb(17 17 19 / 0.08), transparent 55%),' +
                    'radial-gradient(70% 60% at 90% 40%, rgb(60 70 90 / 0.1), transparent 50%),' +
                    'linear-gradient(160deg, #F0F0F2 0%, #E4E5E8 100%)',
                }}
              />
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
                  'border border-black/[0.06] bg-white/92 shadow-sm',
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
                  'border border-black/[0.06] bg-white/92 shadow-sm',
                  'active:scale-[0.97] disabled:opacity-50',
                  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                )}
              >
                {bannerSrc ? 'Change cover' : 'Add cover'}
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
              aria-label="Change photo"
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

        <div className="space-y-3 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <Card>
            <Label>Their name</Label>
            <input
              value={prefs.display_name ?? faceName}
              onChange={(e) =>
                setPrefs((r) => ({ ...r, display_name: e.target.value.slice(0, 40) }))
              }
              onBlur={() => void savePrefs({ display_name: prefs.display_name })}
              className={field}
            />
          </Card>

          <Card>
            <Label>Your name for them</Label>
            <input
              value={prefs.preferred_name ?? ''}
              onChange={(e) =>
                setPrefs((r) => ({ ...r, preferred_name: e.target.value.slice(0, 40) }))
              }
              onBlur={() =>
                void savePrefs({ preferred_name: prefs.preferred_name?.trim() || null })
              }
              placeholder={profile?.displayName || 'What they call you'}
              className={field}
            />
            <Hint>How they address you in chat</Hint>
          </Card>

          <Card>
            <Label>Bio</Label>
            <textarea
              value={prefs.bio ?? ''}
              onChange={(e) => setPrefs((r) => ({ ...r, bio: e.target.value.slice(0, 160) }))}
              onBlur={() => void savePrefs({ bio: prefs.bio ?? null })}
              rows={3}
              className={cn(field, 'resize-none')}
              placeholder={
                pub?.bio?.trim() ||
                'Always down to chat. Your study buddy. Whatever fits them.'
              }
            />
            <Hint>
              How they show up for you
              {prefs.bio?.trim()
                ? ''
                : pub?.bio?.trim()
                  ? ` · default: “${pub.bio.trim()}”`
                  : ''}
            </Hint>
            {owner && (
              <button
                type="button"
                className="mt-2 text-[0.8125rem] font-medium text-brand underline-offset-2 hover:underline"
                onClick={() =>
                  void saveSharedDefaultBio((prefs.bio?.trim() || faceBio).slice(0, 160))
                }
              >
                Use this as default for everyone
              </button>
            )}
          </Card>

          <Card>
            <Label>Personality</Label>
            <AiPersonalityGrid
              value={personality}
              customText={prefs.custom_personality ?? ''}
              onChange={(id) => void savePrefs({ personality: id })}
              onCustomText={(text) => setPrefs((r) => ({ ...r, custom_personality: text }))}
            />
            {personality === 'custom' && (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                onClick={() =>
                  void savePrefs({ custom_personality: prefs.custom_personality ?? null })
                }
              >
                Save custom vibe
              </Button>
            )}
          </Card>

          <Card>
            <Label>Response style</Label>
            <div className="flex gap-1.5 rounded-xl bg-sunken p-1">
              {RESPONSE_LENGTHS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => void savePrefs({ response_length: l.id })}
                  className={cn(
                    'flex-1 rounded-lg py-2 text-[0.8125rem] font-medium transition-colors',
                    length === l.id
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-text-secondary hover:text-ink',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[0.75rem] leading-snug text-text-tertiary" aria-live="polite">
              {lengthPreview}
            </p>
          </Card>

          <Card>
            <Label>Language</Label>
            <div className="flex flex-wrap gap-1.5">
              {langs.slice(0, 10).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => void savePrefs({ language: l.id })}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
                    (prefs.language ?? 'en') === l.id
                      ? 'bg-brand text-on-brand'
                      : 'bg-sunken text-text-secondary hover:text-ink',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.9375rem] font-medium text-ink">Remember things about me</p>
                <p className="mt-0.5 text-[0.75rem] leading-snug text-text-tertiary">
                  Only with your permission. Edit or erase anytime.
                </p>
              </div>
              <Toggle
                checked={Boolean(prefs.memory_enabled ?? true)}
                onChange={(memory_enabled) => void savePrefs({ memory_enabled })}
                label="Remember things about me"
              />
            </div>
            {prefs.memory_enabled !== false && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-black/[0.05] pt-3">
                <button
                  type="button"
                  className="text-[0.8125rem] font-medium text-brand underline-offset-2 hover:underline"
                  onClick={() => setMemoriesOpen(true)}
                >
                  View & edit memories
                  {memoryCount > 0 ? ` (${memoryCount})` : ''}
                </button>
                <span className="text-[0.75rem] text-text-tertiary">
                  Saves when you say “remember…” / “yaad rakh…”
                </span>
              </div>
            )}
          </Card>

          <Card>
            <Label>Privacy</Label>
            <div className="space-y-1.5 text-[0.8125rem] leading-relaxed text-text-secondary">
              <p>Messages here are processed so they can reply.</p>
              <p>Processing copies clean up after about 24 hours.</p>
              <p>This chat is not end-to-end encrypted.</p>
            </div>
          </Card>

          <Card>
            <Label>Advanced</Label>
            <div className="divide-y divide-black/[0.05]">
              <AdvRow label="Reset personality" onClick={() => void resetPersonality()} />
              <AdvRow label="Reset memory" onClick={() => void resetMemory()} />
              {conversationId && (
                <>
                  <AdvRow label="Clear conversation" onClick={() => void clearChat()} />
                  <AdvRow label="Delete AI chat" danger onClick={() => void deleteChat()} />
                </>
              )}
            </div>
          </Card>

          {error && (
            <p
              className="rounded-xl bg-[#FEF2F2] px-3 py-2.5 text-center text-[0.8125rem] text-[#B42318]"
              role="alert"
            >
              {error}
            </p>
          )}

          <Button variant="primary" className="w-full" onClick={onClose} disabled={busy}>
            Done
          </Button>
        </div>
      </Sheet>

      {memoriesOpen && <AiMemoriesSheet onClose={() => setMemoriesOpen(false)} />}
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-black/[0.06] bg-white p-4',
        'shadow-[0_1px_2px_rgba(17,17,19,0.03)]',
      )}
    >
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[0.75rem] font-medium tracking-[-0.01em] text-text-secondary">
      {children}
    </h3>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-[0.75rem] leading-snug text-text-tertiary">{children}</p>;
}

function AdvRow({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center py-2.5 text-left text-[0.9375rem]',
        'transition-colors first:pt-0 last:pb-0',
        'hover:opacity-80 active:opacity-60',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {label}
    </button>
  );
}
