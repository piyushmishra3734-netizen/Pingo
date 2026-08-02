import { useProfile } from '@pingo/core';
import { Button, cn } from '@pingo/ui';
import { useState } from 'react';

import { Sheet } from '../../components/Sheet.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';

const PERSONALITIES: { id: string; label: string; hint: string }[] = [
  { id: 'friendly', label: 'Friendly', hint: 'Warm and easy' },
  { id: 'genz', label: 'Gen Z', hint: 'Natural internet energy' },
  { id: 'coach', label: 'Coach', hint: 'Clear next steps' },
  { id: 'study', label: 'Study Buddy', hint: 'Patient explainers' },
  { id: 'calm', label: 'Calm', hint: 'Steady and unhurried' },
  { id: 'funny', label: 'Funny', hint: 'Light humour' },
  { id: 'motivator', label: 'Motivator', hint: 'Encouraging' },
  { id: 'creative', label: 'Creative', hint: 'Ideas and play' },
  { id: 'custom', label: 'Custom', hint: 'You describe it' },
];

/**
 * First open only - meeting someone, not a product wizard.
 */
export function AiOnboardingSheet({
  onDone,
  onClose,
}: {
  onDone: () => void;
  onClose: () => void;
}) {
  const { profile } = useProfile();
  const [step, setStep] = useState<1 | 2>(1);
  const [preferredName, setPreferredName] = useState(profile?.displayName ?? '');
  const [language, setLanguage] = useState(
    typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en',
  );
  const [age, setAge] = useState('');
  const [country, setCountry] = useState('');
  const [personality, setPersonality] = useState('friendly');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
        country: country.trim() || null,
        age: age.trim() ? Number(age) : null,
        personality,
        custom_personality: personality === 'custom' ? custom.trim() || null : null,
        response_length: 'short',
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

  return (
    <Sheet
      title={step === 1 ? 'Quick intro' : 'How should I be?'}
      description={
        step === 1
          ? 'So I can talk to you like a person, not a form.'
          : 'You can change this anytime.'
      }
      onClose={onClose}
    >
      {step === 1 ? (
        <div className="mt-3 space-y-3">
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
          <Field
            label="Age (optional)"
            value={age}
            onChange={setAge}
            placeholder="—"
            inputMode="numeric"
          />
          <Field
            label="Country (optional)"
            value={country}
            onChange={setCountry}
            placeholder="—"
          />
          <Button
            variant="primary"
            className="mt-2 w-full"
            onClick={() => setStep(2)}
            disabled={!preferredName.trim()}
          >
            Next
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <ul className="grid grid-cols-2 gap-2">
            {PERSONALITIES.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setPersonality(p.id)}
                  className={cn(
                    'focus-ring flex w-full flex-col rounded-xl border px-3 py-2.5 text-left',
                    'transition-colors duration-150',
                    personality === p.id
                      ? 'border-brand/30 bg-selected'
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
                'focus-ring w-full resize-none rounded-xl border border-line/50 bg-sunken',
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
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-caption font-medium text-text-secondary">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={cn(
          'focus-ring w-full rounded-xl border border-line/50 bg-sunken px-3 py-2.5',
          'text-body text-ink',
        )}
      />
    </label>
  );
}
