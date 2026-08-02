import { useProfile } from '@pingo/core';
import { Avatar, Button, PingoDot, cn } from '@pingo/ui';
import { useEffect, useRef, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import type { AiProfileRow } from '../../lib/supabase/types.js';
import {
  fetchAiPublicIdentity,
  isAiOwner,
  type AiPublicIdentity,
} from './ai-public.js';

const PERSONALITIES = [
  'friendly',
  'genz',
  'coach',
  'study',
  'calm',
  'funny',
  'motivator',
  'creative',
  'custom',
] as const;

const LENGTHS: { id: AiProfileRow['response_length']; label: string }[] = [
  { id: 'short', label: 'Short' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'detailed', label: 'Detailed' },
];

/**
 * Premium person card for PINGO AI — face, bio, prefs.
 * Owner can edit the shared default bio + pfp for everyone.
 */
export function AiProfileSheet({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** After save, parent can refresh conversation title/avatar. */
  onChanged?: () => void;
}) {
  const { profile } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pub, setPub] = useState<AiPublicIdentity>();
  const [owner, setOwner] = useState(false);
  const [prefs, setPrefs] = useState<Partial<AiProfileRow>>({});
  const [editGlobal, setEditGlobal] = useState(false);
  const [globalName, setGlobalName] = useState('PINGO');
  const [globalBio, setGlobalBio] = useState('');
  const [globalAvatar, setGlobalAvatar] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [section, setSection] = useState<'card' | 'prefs'>('card');

  useEffect(() => {
    void fetchAiPublicIdentity().then((identity) => {
      setPub(identity);
      if (identity) {
        setGlobalName(identity.displayName);
        setGlobalBio(identity.bio ?? '');
        setGlobalAvatar(identity.avatarUrl);
      }
    });
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

  const faceName =
    prefs.display_name?.trim() || pub?.displayName || 'PINGO';
  const faceSrc = prefs.avatar_url || pub?.avatarUrl;
  const faceBio = pub?.bio?.trim() || 'Always here. Not a bot product — just someone to talk to.';

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

      if (owner && editGlobal) {
        setGlobalAvatar(url);
        const { error: rpcError } = await client.rpc('update_ai_public_identity', {
          new_avatar_url: url,
        });
        if (rpcError) throw rpcError;
        setPub((p) => (p ? { ...p, avatarUrl: url } : p));
      } else {
        // Personal override of the face for this user only.
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
      }
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not upload photo.');
    } finally {
      setBusy(false);
    }
  };

  const saveGlobal = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { error: rpcError } = await getSupabaseClient().rpc('update_ai_public_identity', {
        new_display_name: globalName.trim() || 'PINGO',
        new_bio: globalBio.trim(),
        new_avatar_url: globalAvatar ?? '',
      });
      if (rpcError) throw rpcError;
      setPub({
        id: pub?.id ?? '',
        username: pub?.username ?? 'pingo_ai',
        displayName: globalName.trim() || 'PINGO',
        ...(globalAvatar ? { avatarUrl: globalAvatar } : {}),
        ...(globalBio.trim() ? { bio: globalBio.trim() } : {}),
      });
      setEditGlobal(false);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async () => {
    if (!profile) return;
    setBusy(true);
    setError(undefined);
    try {
      const { error: writeError } = await getSupabaseClient()
        .from('ai_profiles')
        .upsert({
          user_id: profile.id,
          display_name: (prefs.display_name ?? faceName).trim() || 'PINGO',
          personality: prefs.personality ?? 'friendly',
          custom_personality: prefs.custom_personality ?? null,
          response_length: prefs.response_length ?? 'short',
          preferred_name: prefs.preferred_name ?? null,
          memory_enabled: prefs.memory_enabled ?? false,
          avatar_url: prefs.avatar_url ?? null,
          updated_at: new Date().toISOString(),
        });
      if (writeError) throw writeError;
      setSection('card');
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="PINGO" hideTitle onClose={onClose} className="max-w-md overflow-hidden p-0">
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

      {/* Premium hero */}
      <div className="relative overflow-hidden bg-gradient-to-b from-brand/20 via-brand/[0.07] to-surface px-5 pb-5 pt-7">
        <div
          className="pointer-events-none absolute -top-20 left-1/2 size-64 -translate-x-1/2 rounded-full bg-brand/25 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col items-center text-center">
          <button
            type="button"
            onClick={() => {
              if (owner && editGlobal) fileRef.current?.click();
              else if (!editGlobal && section === 'prefs') fileRef.current?.click();
            }}
            className={cn(
              'relative rounded-full',
              (owner && editGlobal) || section === 'prefs'
                ? 'focus-ring cursor-pointer'
                : 'cursor-default',
            )}
            aria-label={
              owner && editGlobal ? 'Change shared photo' : section === 'prefs' ? 'Change photo' : faceName
            }
          >
            <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-brand/50 via-brand/15 to-transparent blur-[1px]" />
            <Avatar
              name={faceName}
              id="pingo-ai"
              src={editGlobal ? globalAvatar : faceSrc}
              size="xl"
              presence="online"
              className="relative ring-2 ring-surface shadow-xl"
            />
            {((owner && editGlobal) || section === 'prefs') && (
              <span className="absolute bottom-0 right-0 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                Edit
              </span>
            )}
          </button>

          <div className="mt-3 flex items-center gap-1.5">
            <PingoDot state="online" size={6} />
            <span className="text-caption font-medium text-brand">Always here</span>
          </div>
          <h2 className="mt-1.5 text-h1 text-ink">
            {editGlobal ? globalName || 'PINGO' : faceName}
          </h2>
          <p className="mt-1 text-caption text-text-tertiary">@{pub?.username ?? 'pingo_ai'}</p>
          {!editGlobal && (
            <p className="mt-3 max-w-[20rem] text-body leading-snug text-text-secondary">
              {faceBio}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4 px-5 pb-5">
        {section === 'card' && !editGlobal && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSection('prefs')}
                className={cn(
                  'focus-ring rounded-2xl border border-line/60 bg-sunken px-3 py-3 text-left',
                  'transition-colors hover:bg-hover',
                )}
              >
                <span className="block text-body font-medium text-ink">How they feel</span>
                <span className="mt-0.5 block text-caption text-text-tertiary">
                  Name, vibe, memory
                </span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'focus-ring rounded-2xl border border-brand/25 bg-selected px-3 py-3 text-left',
                  'transition-colors hover:bg-selected/80',
                )}
              >
                <span className="block text-body font-medium text-brand">Back to chat</span>
                <span className="mt-0.5 block text-caption text-text-tertiary">Keep talking</span>
              </button>
            </div>

            {owner && (
              <button
                type="button"
                onClick={() => setEditGlobal(true)}
                className="focus-ring w-full rounded-2xl border border-line/50 bg-surface px-3 py-3 text-left transition-colors hover:bg-hover"
              >
                <span className="block text-body font-medium text-ink">
                  Shared face for everyone
                </span>
                <span className="mt-0.5 block text-caption text-text-tertiary">
                  Default photo, name & bio every user sees
                </span>
              </button>
            )}

            <p className="text-center text-caption text-text-tertiary">
              Messages are processed to generate replies. Not end-to-end encrypted.
            </p>
          </>
        )}

        {editGlobal && owner && (
          <div className="space-y-3">
            <p className="text-caption font-medium text-text-secondary">
              Default for every account
            </p>
            <label className="block">
              <span className="mb-1.5 block text-caption text-text-secondary">Name</span>
              <input
                value={globalName}
                onChange={(e) => setGlobalName(e.target.value.slice(0, 40))}
                className="focus-ring w-full rounded-2xl border border-line/50 bg-sunken px-3 py-2.5 text-body text-ink"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-caption text-text-secondary">Bio</span>
              <textarea
                value={globalBio}
                onChange={(e) => setGlobalBio(e.target.value.slice(0, 160))}
                rows={3}
                className="focus-ring w-full resize-none rounded-2xl border border-line/50 bg-sunken px-3 py-2.5 text-body text-ink"
              />
            </label>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              Change shared photo
            </Button>
            {error && (
              <p className="text-center text-caption text-danger/90" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setEditGlobal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => void saveGlobal()}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save for everyone'}
              </Button>
            </div>
          </div>
        )}

        {section === 'prefs' && !editGlobal && (
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-caption font-medium text-text-secondary">
                Name in your chats
              </span>
              <input
                value={prefs.display_name ?? faceName}
                onChange={(e) =>
                  setPrefs((r) => ({ ...r, display_name: e.target.value.slice(0, 40) }))
                }
                className="focus-ring w-full rounded-2xl border border-line/50 bg-sunken px-3 py-2.5 text-body text-ink"
              />
            </label>

            <div>
              <span className="mb-1.5 block text-caption font-medium text-text-secondary">
                Personality
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PERSONALITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrefs((r) => ({ ...r, personality: p }))}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-caption font-medium capitalize',
                      (prefs.personality ?? 'friendly') === p
                        ? 'bg-selected text-brand'
                        : 'bg-sunken text-text-secondary',
                    )}
                  >
                    {p === 'genz' ? 'Gen Z' : p}
                  </button>
                ))}
              </div>
            </div>

            {(prefs.personality ?? 'friendly') === 'custom' && (
              <textarea
                value={prefs.custom_personality ?? ''}
                onChange={(e) =>
                  setPrefs((r) => ({
                    ...r,
                    custom_personality: e.target.value.slice(0, 200),
                  }))
                }
                rows={2}
                placeholder="Describe the vibe"
                className="focus-ring w-full resize-none rounded-2xl border border-line/50 bg-sunken px-3 py-2 text-body text-ink"
              />
            )}

            <div>
              <span className="mb-1.5 block text-caption font-medium text-text-secondary">
                Reply length
              </span>
              <div className="flex gap-1.5">
                {LENGTHS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setPrefs((r) => ({ ...r, response_length: l.id }))}
                    className={cn(
                      'flex-1 rounded-full py-2 text-caption font-medium',
                      (prefs.response_length ?? 'short') === l.id
                        ? 'bg-selected text-brand'
                        : 'bg-sunken text-text-secondary',
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-line/50 bg-surface px-3 py-3">
              <span>
                <span className="block text-body text-ink">Remember things I share</span>
                <span className="block text-caption text-text-tertiary">
                  Only with your permission
                </span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(prefs.memory_enabled)}
                onChange={(e) =>
                  setPrefs((r) => ({ ...r, memory_enabled: e.target.checked }))
                }
                className="size-5 accent-brand"
              />
            </label>

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              Change photo for you
            </Button>

            {error && (
              <p className="text-center text-caption text-danger/90" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setSection('card')}>
                Back
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => void savePrefs()}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
