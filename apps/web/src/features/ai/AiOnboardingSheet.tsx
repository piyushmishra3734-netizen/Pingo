import { useProfile } from '@pingo/core';
import { Avatar, Button, PingoDot, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { fetchAiPublicIdentity, type AiPublicIdentity } from './ai-public.js';

const PERSONALITIES: { id: string; label: string; hint: string }[] = [
  { id: 'friendly', label: 'Friendly', hint: 'Warm and easy' },
  { id: 'genz', label: 'Gen Z', hint: 'Natural energy' },
  { id: 'coach', label: 'Coach', hint: 'Clear next steps' },
  { id: 'study', label: 'Study Buddy', hint: 'Patient explainers' },
  { id: 'calm', label: 'Calm', hint: 'Steady, unhurried' },
  { id: 'funny', label: 'Funny', hint: 'Light humour' },
  { id: 'motivator', label: 'Motivator', hint: 'Encouraging' },
  { id: 'creative', label: 'Creative', hint: 'Ideas and play' },
  { id: 'custom', label: 'Custom', hint: 'You describe it' },
];

/**
 * First open — a premium “meet them” card, not a product wizard.
 */
export function AiOnboardingSheet({
  onDone,
  onClose,
}: {
  onDone: () => void;
  onClose: () => void;
}) {
  const { profile } = useProfile();
  const [pub, setPub] = useState<AiPublicIdentity>();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [preferredName, setPreferredName] = useState(profile?.displayName ?? '');
  const [language, setLanguage] = useState(
    typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en',
  );
  const [personality, setPersonality] = useState('friendly');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetchAiPublicIdentity().then(setPub);
  }, []);

  const save = async () => {
    if (!profile) return;
    setBusy(true);
    setError(undefined);
    try {
      const client = getSupabaseClient();
      const { error: writeError } = await client.from('ai_profiles').upsert({
        user_id: profile.id,
        preferred_name: preferredName.trim() || null,
        language: language.trim() || null,
        personality,
        custom_personality: personality === 'custom' ? custom.trim() || null : null,
        response_length: 'short',
        memory_enabled: true,
        display_name: pub?.displayName ?? 'PINGO',
        avatar_url: pub?.avatarUrl ?? null,
        onboarded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (writeError) throw writeError;
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const face = pub?.displayName ?? 'PINGO';

  return (
    <Sheet title="Meet them" hideTitle onClose={onClose} className="max-w-md overflow-hidden p-0">
      {/* Hero */}
      <div
        className={cn(
          'relative overflow-hidden px-5 pb-6 pt-8',
          'bg-gradient-to-b from-brand/15 via-brand/5 to-surface',
        )}
      >
        <div
          className="pointer-events-none absolute -top-16 left-1/2 size-56 -translate-x-1/2 rounded-full bg-brand/20 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col items-center text-center">
          <div className="relative">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-brand/40 to-brand/5 blur-[2px]" />
            <Avatar
              name={face}
              id="pingo-ai"
              src={pub?.avatarUrl}
              size="xl"
              presence="online"
              className="relative ring-2 ring-surface shadow-lg"
            />
          </div>
          <div className="mt-4 flex items-center gap-1.5">
            <PingoDot state="online" size={6} />
            <span className="text-caption font-medium text-brand">Always here</span>
          </div>
          <h2 className="mt-2 text-h1 text-ink">{face}</h2>
          <p className="mt-1.5 max-w-[18rem] text-body text-text-secondary">
            {pub?.bio?.trim() ||
              'Always here. Not a bot product — just someone to talk to.'}
          </p>
        </div>
      </div>

      <div className="px-5 pb-5">
        {step === 0 && (
          <div className="space-y-3">
            <p className="text-center text-caption text-text-tertiary">
              A real chat. You can change how they feel anytime.
            </p>
            <Button variant="primary" className="w-full" onClick={() => setStep(1)}>
              Continue
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="focus-ring w-full py-2 text-center text-caption text-text-tertiary"
            >
              Not now
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-caption font-medium text-text-secondary">
              So they can talk to you like a person
            </p>
            <Field
              label="What should I call you?"
              value={preferredName}
              onChange={setPreferredName}
              placeholder="Your name"
            />
            <Field
              label="Language"
              value={language}
              onChange={setLanguage}
              placeholder="en"
            />
            <Button
              variant="primary"
              className="w-full"
              onClick={() => setStep(2)}
              disabled={!preferredName.trim()}
            >
              Next
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-caption font-medium text-text-secondary">How should I be?</p>
            <ul className="grid grid-cols-2 gap-2">
              {PERSONALITIES.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setPersonality(p.id)}
                    className={cn(
                      'focus-ring flex w-full flex-col rounded-2xl border px-3 py-2.5 text-left',
                      'transition-colors duration-150',
                      personality === p.id
                        ? 'border-brand/35 bg-selected shadow-sm'
                        : 'border-line/50 bg-surface hover:bg-hover',
                    )}
                  >
                    <span className="text-body font-medium text-ink">{p.label}</span>
                    <span className="text-caption text-text-tertiary">{p.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
            {personality === 'custom' && (
              <textarea
                value={custom}
                onChange={(e) => setCustom(e.target.value.slice(0, 200))}
                rows={2}
                placeholder="Describe the vibe in a sentence"
                className={cn(
                  'focus-ring w-full resize-none rounded-2xl border border-line/50 bg-sunken',
                  'px-3 py-2 text-body text-ink',
                )}
              />
            )}
            {error && (
              <p className="text-center text-caption text-danger/90" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => void save()}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Start chatting'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-caption font-medium text-text-secondary">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'focus-ring w-full rounded-2xl border border-line/50 bg-sunken px-3 py-2.5',
          'text-body text-ink',
        )}
      />
    </label>
  );
}
