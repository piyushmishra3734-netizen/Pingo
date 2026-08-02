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
 * Contact-style editor for PINGO AI — not a model control panel.
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
  const fileRef = useRef<HTMLInputElement>(null);

  const [pub, setPub] = useState<AiPublicIdentity>();
  const [owner, setOwner] = useState(false);
  const [prefs, setPrefs] = useState<Partial<AiProfileRow>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);

  useEffect(() => {
    if (!profile) return;
    void getSupabaseClient()
      .from('ai_memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .then(({ count }) => setMemoryCount(count ?? 0));
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

  const uploadAvatar = async (file: File) => {
    if (!profile) return;
    setBusy(true);
    setError(undefined);
    try {
      const client = getSupabaseClient();
      const path = `${profile.id}/ai-avatar-${Date.now()}`;
      const { error: upError } = await client.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
      if (upError) throw upError;
      const { data } = client.storage.from('avatars').getPublicUrl(path);
      const url = data.publicUrl;

      if (owner) {
        const { error: rpcError } = await client.rpc('update_ai_public_identity', {
          new_avatar_url: url,
        });
        if (rpcError) throw rpcError;
        setPub((p) => (p ? { ...p, avatarUrl: url } : p));
      }

      const { error: writeError } = await client.from('ai_profiles').upsert({
        user_id: profile.id,
        avatar_url: url,
        display_name: prefs.display_name ?? faceName,
        personality: prefs.personality ?? 'friendly',
        response_length: prefs.response_length ?? 'short',
        updated_at: new Date().toISOString(),
      });
      if (writeError) throw writeError;
      setPrefs((r) => ({ ...r, avatar_url: url }));
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not upload photo.');
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async (patch: Partial<AiProfileRow>) => {
    if (!profile) return;
    // Leaving custom mode must drop stale custom text so the model ignores it.
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

  /** Owner-only: default bio every new user sees until they write their own. */
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
      {/*
        Flex column: outer sheet clips; only the body scrolls. Passing
        overflow-hidden alone used to kill Sheet's overflow-y-auto and freeze
        the whole panel (including under the avatar).
      */}
      <Sheet
        title="About them"
        hideTitle
        onClose={onClose}
        className="flex max-h-[90vh] max-w-md flex-col overflow-hidden p-0"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void uploadAvatar(file);
          }}
        />

        {/* Hero — shrink-0 so it never steals the scroll surface */}
        <div className="relative shrink-0 bg-brand/[0.08] px-5 pb-5 pt-7">
          <div className="relative flex flex-col items-center text-center">
            <div className="relative mx-auto" style={{ width: 96, height: 96 }}>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'absolute inset-0 rounded-full',
                  'outline-none focus-visible:outline focus-visible:outline-2',
                  'focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-focus-ring)]',
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
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'absolute bottom-0 right-0 z-10 rounded-full',
                  'bg-brand px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm',
                  'outline-none focus-visible:outline focus-visible:outline-2',
                  'focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-focus-ring)]',
                )}
              >
                Edit
              </button>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <PingoDot state="online" size={6} />
              <span className="text-caption font-medium text-brand">Always here</span>
            </div>
            <h2 className="mt-1.5 text-h1 text-ink">{faceName}</h2>
            <p className="mt-1 text-caption text-text-tertiary">
              @{pub?.username ?? 'pingo_ai'}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-6 pt-4">
          <Section title="Name">
            <input
              value={prefs.display_name ?? faceName}
              onChange={(e) => setPrefs((r) => ({ ...r, display_name: e.target.value.slice(0, 40) }))}
              onBlur={() => void savePrefs({ display_name: prefs.display_name })}
              className="focus-ring w-full rounded-2xl border border-line/50 bg-sunken px-3 py-2.5 text-body text-ink"
            />
          </Section>

          <Section title="Bio">
            <textarea
              value={prefs.bio ?? ''}
              onChange={(e) =>
                setPrefs((r) => ({ ...r, bio: e.target.value.slice(0, 160) }))
              }
              onBlur={() => void savePrefs({ bio: prefs.bio ?? null })}
              rows={2}
              className="focus-ring w-full resize-none rounded-2xl border border-line/50 bg-sunken px-3 py-2.5 text-body text-ink"
              placeholder={
                pub?.bio?.trim() ||
                'Always down to chat. Your study buddy. Whatever fits them.'
              }
            />
            <p className="mt-1.5 text-caption text-text-tertiary">
              How they show up for you
              {prefs.bio?.trim()
                ? ''
                : pub?.bio?.trim()
                  ? ` · default: “${pub.bio.trim()}”`
                  : ''}
              .
            </p>
            {owner && (
              <button
                type="button"
                className="focus-ring mt-2 text-caption font-medium text-brand"
                onClick={() =>
                  void saveSharedDefaultBio(
                    (prefs.bio?.trim() || faceBio).slice(0, 160),
                  )
                }
              >
                Use this as default for everyone
              </button>
            )}
          </Section>

          <Section title="Personality">
            <AiPersonalityGrid
              value={personality}
              customText={prefs.custom_personality ?? ''}
              onChange={(id) => void savePrefs({ personality: id })}
              onCustomText={(text) => setPrefs((r) => ({ ...r, custom_personality: text }))}
            />
            {personality === 'custom' && (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                onClick={() =>
                  void savePrefs({ custom_personality: prefs.custom_personality ?? null })
                }
              >
                Save custom vibe
              </Button>
            )}
          </Section>

          <Section title="Response style">
            <div className="flex gap-1.5">
              {RESPONSE_LENGTHS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => void savePrefs({ response_length: l.id })}
                  className={cn(
                    'flex-1 rounded-full py-2 text-caption font-medium',
                    length === l.id ? 'bg-selected text-brand' : 'bg-sunken text-text-secondary',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-caption text-text-tertiary" aria-live="polite">
              {lengthPreview}
            </p>
          </Section>

          <Section title="Language">
            <div className="flex flex-wrap gap-2">
              {langs.slice(0, 10).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => void savePrefs({ language: l.id })}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-caption font-medium',
                    (prefs.language ?? 'en') === l.id
                      ? 'bg-selected text-brand'
                      : 'bg-sunken text-text-secondary',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Memory">
            <div className="rounded-2xl border border-line/50 bg-surface px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-body text-ink">Remember things about me</p>
                  <p className="text-caption text-text-tertiary">
                    Only with your permission. You can edit or erase anytime.
                  </p>
                </div>
                <Toggle
                  checked={Boolean(prefs.memory_enabled ?? true)}
                  onChange={(memory_enabled) => void savePrefs({ memory_enabled })}
                  label="Remember things about me"
                />
              </div>
              {prefs.memory_enabled !== false && (
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line/40 pt-3">
                  <button
                    type="button"
                    className="focus-ring text-caption font-medium text-brand"
                    onClick={() => setMemoriesOpen(true)}
                  >
                    View & edit memories
                    {memoryCount > 0 ? ` (${memoryCount})` : ''}
                  </button>
                  <span className="text-caption text-text-tertiary">
                    Chat me “yaad rakh …” bhi chalta hai
                  </span>
                </div>
              )}
            </div>
          </Section>

          <Section title="Privacy">
            <div className="space-y-2 rounded-2xl border border-line/40 bg-sunken/50 px-3 py-3 text-caption leading-relaxed text-text-secondary">
              <p>Messages here are processed so they can reply.</p>
              <p>Processing copies are cleaned up automatically after about 24 hours.</p>
              <p>This chat is not end-to-end encrypted.</p>
            </div>
          </Section>

          <Section title="Advanced">
            <div className="space-y-1">
              <AdvRow label="Reset personality" onClick={() => void resetPersonality()} />
              <AdvRow label="Reset memory" onClick={() => void resetMemory()} />
              {conversationId && (
                <>
                  <AdvRow label="Clear conversation" onClick={() => void clearChat()} />
                  <AdvRow
                    label="Delete AI chat"
                    danger
                    onClick={() => void deleteChat()}
                  />
                </>
              )}
            </div>
          </Section>

          {error && (
            <p className="text-center text-caption text-danger/90" role="alert">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-caption font-medium text-text-secondary">{title}</h3>
      {children}
    </section>
  );
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
        'focus-ring flex w-full items-center rounded-xl px-2 py-2.5 text-left text-body',
        'hover:bg-hover',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {label}
    </button>
  );
}
