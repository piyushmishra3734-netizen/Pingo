import { useProfile } from '@pingo/core';
import { Avatar, Button, PingoDot, cn } from '@pingo/ui';
import { useEffect, useId, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { useReturnFocus } from '../conversations/focus-restore.js';
import { useT } from '../i18n/useT.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { fetchAiPublicIdentity, type AiPublicIdentity } from './ai-public.js';
import { AiAgeWheel } from './AiAgeWheel.js';
import { AiPersonalityGrid } from './AiPersonalityGrid.js';
import {
  orderedLanguages,
  pushRecentLanguage,
  type PersonalityId,
} from './personalities.js';

type Step = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * First open — centered liquid-glass “meet them” ritual.
 * Not a bottom sheet product wizard.
 */
export function AiOnboardingSheet({
  onDone,
  onClose,
}: {
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useReturnFocus();
  const { profile } = useProfile();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const [pub, setPub] = useState<AiPublicIdentity>();
  const [step, setStep] = useState<Step>(0);
  const [preferredName, setPreferredName] = useState(profile?.displayName ?? '');
  const [age, setAge] = useState<number | null>(null);
  const [language, setLanguage] = useState(
    typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en',
  );
  const [personality, setPersonality] = useState<PersonalityId>('friendly');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    void fetchAiPublicIdentity().then(setPub);
  }, []);

  useEffect(() => {
    const wanted = panelRef.current?.querySelector<HTMLElement>('[autofocus]');
    (wanted ?? panelRef.current)?.focus();
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (step === 0) onClose();
      else if (step === 5) return;
      else setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, onClose]);

  const face = pub?.displayName ?? 'PINGO';
  const langs = orderedLanguages(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
  );

  const save = async () => {
    if (!profile) return;
    if (personality === 'custom' && !custom.trim()) {
      setError('Describe the vibe, or pick another personality.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setFinishing(true);
    try {
      pushRecentLanguage(language);
      const client = getSupabaseClient();
      const { error: writeError } = await client.from('ai_profiles').upsert({
        user_id: profile.id,
        preferred_name: preferredName.trim() || null,
        age: age,
        language: language.trim() || null,
        personality,
        custom_personality: personality === 'custom' ? custom.trim() || null : null,
        response_length: 'short',
        memory_enabled: true,
        /*
         * Deliberately not seeded from `pub`.
         *
         * These two columns mean "this user chose something other than the
         * shared face". Copying the current shared values into them at signup
         * made every account permanently disagree with the face it was copied
         * from: the personal row wins, so the operator could change the AI's
         * picture and nobody who had already onboarded would ever see it. Nine
         * accounts were holding two URLs between them, which is what a copy
         * looks like and not what a preference does.
         *
         * Left null. Null is how a row says "whatever the shared one is".
         */
        display_name: null,
        avatar_url: null,
        onboarded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (writeError) throw writeError;
      // Soft success beat, then hand off to chat.
      window.setTimeout(() => onDone(), 220);
    } catch (cause) {
      setFinishing(false);
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setBusy(false);
    }
  };

  return (
    <Overlay onDismiss={onClose}>
      <div
        className="fixed inset-0 z-[1100] flex items-center justify-center px-4"
        onPointerDown={onClose}
      >
        <div className="absolute inset-0 animate-fade-in bg-backdrop/[0.22] backdrop-blur-[2px]" />

        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'animate-panel-in relative w-full max-w-md outline-none',
            'max-h-[min(88vh,40rem)] overflow-y-auto',
            'rounded-2xl border border-line bg-surface p-0 shadow-[0_16px_48px_rgba(17,17,19,0.12)]',
          )}
        >
          {step === 0 && (
            <div className="flex flex-col items-center px-6 pb-6 pt-10 text-center">
              <div
                className={cn(
                  'relative inline-grid size-[6.5rem] shrink-0 place-items-center rounded-full p-1',
                  'bg-surface shadow-[0_8px_24px_rgba(17,17,19,0.1)] ring-2 ring-surface',
                )}
              >
                <Avatar
                  name={face}
                  id="pingo-ai"
                  src={pub?.avatarUrl}
                  size="xl"
                  presence="online"
                />
              </div>
              <div className="mt-4 flex items-center gap-1.5">
                <PingoDot state="online" size={6} />
                <span className="text-[0.75rem] font-medium text-text-secondary">Always here</span>
              </div>
              <h2 id={titleId} className="mt-3 text-h1 text-ink">
                Hey 👋
              </h2>
              <p className="mt-2 max-w-[18rem] text-body text-text-secondary">
                Let&apos;s get to know each other.
              </p>
              <Button
                variant="primary"
                className="mt-6 w-full"
                onClick={() => setStep(1)}
                autoFocus
              >
                Continue
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="focus-ring mt-2 w-full py-2 text-center text-caption text-text-tertiary"
              >
                Not now
              </button>
            </div>
          )}

          {step === 1 && (
            <StepShell
              titleId={titleId}
              title={t('ai.whatCallYou')}
              onBack={() => setStep(0)}
            >
              <input
                autoFocus
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value.slice(0, 40))}
                placeholder={t('ai.yourName')}
                className={cn(
                  'focus-ring w-full rounded-2xl border border-line/50 bg-sunken',
                  'px-4 py-3.5 text-h2 text-ink placeholder:text-text-tertiary',
                )}
              />
              <p className="mt-3 text-caption text-text-secondary" aria-live="polite">
                {preferredName.trim()
                  ? `I’ll call you ${preferredName.trim()}.`
                  : t('ai.nameHint')}
              </p>
              <Button
                variant="primary"
                className="mt-5 w-full"
                disabled={!preferredName.trim()}
                onClick={() => setStep(2)}
              >
                Next
              </Button>
            </StepShell>
          )}

          {step === 2 && (
            <StepShell titleId={titleId} title={t('ai.age')} onBack={() => setStep(1)}>
              <AiAgeWheel value={age} onChange={setAge} />
              <Button variant="primary" className="mt-4 w-full" onClick={() => setStep(3)}>
                Next
              </Button>
            </StepShell>
          )}

          {step === 3 && (
            <StepShell titleId={titleId} title={t('ai.language')} onBack={() => setStep(2)}>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('ai.language')}>
                {langs.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={language === l.id}
                    onClick={() => setLanguage(l.id)}
                    className={cn(
                      'focus-ring rounded-full px-3.5 py-2 text-caption font-medium',
                      'transition-colors duration-instant ease-standard',
                      language === l.id
                        ? 'bg-brand text-on-brand'
                        : 'bg-sunken text-text-secondary hover:bg-hover',
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <Button variant="primary" className="mt-5 w-full" onClick={() => setStep(4)}>
                Next
              </Button>
            </StepShell>
          )}

          {step === 4 && (
            <StepShell
              titleId={titleId}
              title={t('ai.howBe')}
              onBack={() => setStep(3)}
            >
              <AiPersonalityGrid
                value={personality}
                customText={custom}
                onChange={setPersonality}
                onCustomText={setCustom}
              />
              {error && (
                <p className="mt-2 text-center text-caption text-danger/90" role="alert">
                  {error}
                </p>
              )}
              <Button
                variant="primary"
                className="mt-4 w-full"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? t('ai.saving') : t('ai.startChat')}
              </Button>
            </StepShell>
          )}

          {finishing && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/80 animate-fade-in">
              <p className="text-body font-medium text-ink">You&apos;re all set</p>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

function StepShell({
  titleId,
  title,
  onBack,
  children,
}: {
  titleId: string;
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 pb-6 pt-5">
      <button
        type="button"
        onClick={onBack}
        className="focus-ring mb-3 text-caption font-medium text-text-secondary"
      >
        Back
      </button>
      <h2 id={titleId} className="text-h2 text-ink">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}
