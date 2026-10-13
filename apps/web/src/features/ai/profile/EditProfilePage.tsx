import { useChat, useProfile } from '@pingo/core';
import { cn } from '@pingo/ui';
import { Camera, Check, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { getSupabaseClient } from '../../../lib/supabase/client.js';
import { IMMUTABLE_CACHE_SECONDS, shrinkToAvatar } from '../../profile/avatar-image.js';
import type { AiPublicIdentity } from '../ai-public.js';
import { saveAiPrefs, useAiPrefs } from '../room/ai-prefs.js';
import { AI_STATUSES, asStatus, LIMITS, validateProfile, type AiStatus } from './ai-profile-model.js';
import { DEFAULT_BIO, DEFAULT_TAGLINE } from './AiProfilePage.js';
import { AiFace, Card, Counted, fieldClass, SectionLabel, StatusDot, TopBar } from './pastel.js';

/** A Do not disturb that lasts until they change it: muted for a century. */
const DND_UNTIL = () => Date.now() + 100 * 365 * 24 * 3_600_000;

export function EditProfilePage({
  pub,
  aiConversationId,
  onBack,
  onAvatar,
  onSaved,
}: {
  pub: AiPublicIdentity | undefined;
  aiConversationId: () => Promise<string>;
  onBack: () => void;
  onAvatar: () => void;
  onSaved: () => void;
}) {
  const { profile } = useProfile();
  const { service } = useChat();
  const { prefs, loaded } = useAiPrefs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [status, setStatus] = useState<AiStatus>('online');
  const [photo, setPhoto] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // The form starts from what is saved, once it has loaded.
  useEffect(() => {
    if (!loaded || ready) return;
    setName(prefs.display_name?.trim() || 'Pingo AI');
    setTagline(prefs.tagline?.trim() || DEFAULT_TAGLINE);
    setBio(prefs.bio?.trim() || pub?.bio?.trim() || DEFAULT_BIO);
    setStatus(asStatus(prefs.status));
    setPhoto(prefs.avatar_url ?? null);
    setReady(true);
  }, [loaded, ready, prefs, pub]);

  const problems = validateProfile({ name, tagline, bio });
  const dirty =
    ready &&
    (name.trim() !== (prefs.display_name?.trim() || 'Pingo AI') ||
      tagline.trim() !== (prefs.tagline?.trim() || DEFAULT_TAGLINE) ||
      bio.trim() !== (prefs.bio?.trim() || pub?.bio?.trim() || DEFAULT_BIO) ||
      status !== asStatus(prefs.status) ||
      photo !== (prefs.avatar_url ?? null));

  const upload = async (file: File) => {
    if (!profile) return;
    setUploading(true);
    setError(undefined);
    try {
      const client = getSupabaseClient();
      const path = `${profile.id}/ai-avatar-${Date.now()}`;
      const small = await shrinkToAvatar(file);
      const { error: upError } = await client.storage
        .from('avatars')
        .upload(path, small, { upsert: true, contentType: small.type || 'image/jpeg', cacheControl: IMMUTABLE_CACHE_SECONDS });
      if (upError) throw upError;
      setPhoto(client.storage.from('avatars').getPublicUrl(path).data.publicUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not upload the photo.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (Object.keys(problems).length) return;
    setSaving(true);
    setError(undefined);
    const wasDnd = asStatus(prefs.status) === 'dnd';
    const err = await saveAiPrefs({
      display_name: name.trim() === 'Pingo AI' && !prefs.display_name ? null : name.trim(),
      tagline: tagline.trim() === DEFAULT_TAGLINE ? null : tagline.trim(),
      bio: bio.trim() === (pub?.bio?.trim() || DEFAULT_BIO) ? null : bio.trim(),
      status,
      avatar_url: photo,
    });
    if (err) {
      setSaving(false);
      setError(err);
      return;
    }
    // Do not disturb is real: PINGO AI's chat is muted while it lasts.
    if ((status === 'dnd') !== wasDnd) {
      try {
        const id = await aiConversationId();
        await service.setConversationFlags([id], { mutedUntil: status === 'dnd' ? DND_UNTIL() : null });
      } catch {
        setSaving(false);
        setError('Saved, but the chat could not be muted. Try again.');
        return;
      }
    }
    setSaving(false);
    onSaved();
  };

  return (
    <>
      <TopBar title="Edit Profile" onBack={onBack} action={{ label: 'Save', onClick: () => void save(), disabled: !dirty || Object.keys(problems).length > 0, busy: saving }} />
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
        <div className="relative mx-auto mt-3 size-[13.5rem]">
          <button type="button" aria-label="Choose an avatar" onClick={onAvatar} className="block size-full rounded-full bg-[radial-gradient(circle_at_50%_40%,var(--pp-accent-soft),var(--pp-bg-2))] p-2 active:scale-[0.99]">
            <AiFace src={photo} framed className="size-full" />
          </button>
          <button
            type="button"
            aria-label="Upload a photo"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="pp-card absolute bottom-2 right-2 grid size-14 place-items-center rounded-full active:scale-95 disabled:opacity-60"
          >
            {uploading ? <Loader2 size={22} className="animate-spin" /> : <Camera size={24} />}
          </button>
        </div>

        <label className="mt-6 block">
          <span className="mb-2 block px-1 text-[16px] font-bold">Name</span>
          <span className="relative block">
            <input
              value={name}
              maxLength={LIMITS.name + 10}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(problems.name)}
              className={cn(fieldClass, 'h-14 pr-12')}
            />
            {name && (
              <button type="button" aria-label="Clear name" onClick={() => setName('')} className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-[var(--pp-line)] text-[var(--pp-sub)]">
                <X size={14} strokeWidth={2.6} />
              </button>
            )}
          </span>
          {problems.name && <span className="mt-1.5 block px-1 text-[13px] text-danger">{problems.name}</span>}
        </label>

        <label className="mt-5 block">
          <span className="mb-2 block px-1 text-[16px] font-bold">Tagline</span>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={DEFAULT_TAGLINE} className={cn(fieldClass, 'h-14')} />
          <Counted value={tagline.trim()} max={LIMITS.tagline} />
        </label>

        <div className="mt-3">
          <SectionLabel>Status</SectionLabel>
          <Card>
            <div role="radiogroup" aria-label="Status" className="p-1.5">
              {AI_STATUSES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={status === s.id}
                  onClick={() => setStatus(s.id)}
                  className={cn('flex w-full items-center gap-3.5 rounded-[14px] px-3.5 py-3 text-left text-[16.5px]', status === s.id && 'bg-[var(--pp-accent-soft)]')}
                >
                  <StatusDot color={s.dot} className="size-4" />
                  <span className="flex-1">{s.label}</span>
                  {status === s.id && <Check size={20} strokeWidth={2.6} className="text-[var(--pp-accent)]" aria-hidden />}
                </button>
              ))}
            </div>
          </Card>
          {status === 'dnd' && <p className="mt-1.5 px-1 text-[13px] text-[var(--pp-sub)]">PINGO AI&apos;s chat is muted while this is on.</p>}
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block px-1 text-[16px] font-bold">Bio</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} className={cn(fieldClass, 'resize-none py-3.5 leading-snug')} />
          <Counted value={bio.trim()} max={LIMITS.bio} />
        </label>

        {error && (
          <p role="alert" className="mt-2 text-center text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
