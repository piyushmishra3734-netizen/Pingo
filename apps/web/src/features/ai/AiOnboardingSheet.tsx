import { useProfile } from '@pingo/core';
import { cn } from '@pingo/ui';
import { ArrowRight, Check, ChevronLeft } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Overlay } from '../../components/Overlay.js';
import { useReturnFocus } from '../conversations/focus-restore.js';
import { useT } from '../i18n/useT.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { fetchAiPublicIdentity, type AiPublicIdentity } from './ai-public.js';
import { AiAgeWheel } from './AiAgeWheel.js';
import { AiPersonalityGrid } from './AiPersonalityGrid.js';
import { AiFace, Sky } from './profile/pastel.js';
import {
  isAdult,
  orderedLanguages,
  pushRecentLanguage,
  type PersonalityId,
} from './personalities.js';
import {
  INTERESTS,
  LIFE,
  MAX_INTERESTS,
  MAX_WANTS,
  NOTE_MAX,
  WANTS,
  requestGreeting,
  saveAbout,
  type Chip,
} from './onboarding-about.js';

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * First open — centered liquid-glass “meet them” ritual.
 * Not a bottom sheet product wizard.
 */
export function AiOnboardingSheet({
  conversationId,
  mode = 'full',
  preview = false,
  onDone,
  onClose,
}: {
  /**
   * full: the whole setup. about: only the interests, life and what-you-want
   * steps, for somebody who set PINGO AI up before they existed.
   */
  mode?: 'full' | 'about';
  /** Dev only (`?ai-onboarding`): every step works and nothing is saved. */
  preview?: boolean;
  /** The PINGO AI chat this opened over; it gets the first message once they finish. */
  conversationId?: string;
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
  const [interests, setInterests] = useState<string[]>([]);
  const [life, setLife] = useState<string | null>(null);
  const [wants, setWants] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const [reaction, setReaction] = useState<string>();
  useEffect(() => setReaction(undefined), [step]);
  /** Pingu answers a pick with its own line; taking one off says nothing. */
  const heard = (chips: Chip[], id: string, added: boolean) => {
    if (added) setReaction(chips.find((c) => c.id === id)?.react);
  };

  useEffect(() => {
    void fetchAiPublicIdentity().then(setPub);
  }, []);

  /*
   * The age they gave at setup decides whether Flirt (and Spicy) is offered. The
   * first setup let it be skipped, and 30 of the first 43 did - so somebody in
   * the about-only run with no age on record is asked for it here too. The
   * preview always shows that step.
   */
  const [askAge, setAskAge] = useState(mode === 'about' && preview);
  useEffect(() => {
    if (mode !== 'about' || !profile || preview) return;
    void Promise.resolve(
      getSupabaseClient().from('ai_profiles').select('age').eq('user_id', profile.id).maybeSingle(),
    ).then(({ data }) => {
      const known = (data as { age?: number | null } | null)?.age ?? null;
      setAge(known);
      setAskAge(known === null);
    }, () => undefined);
  }, [mode, profile?.id, preview]);

  useEffect(() => {
    const wanted = panelRef.current?.querySelector<HTMLElement>('[autofocus]');
    (wanted ?? panelRef.current)?.focus();
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (step === 0) onClose();
      else if (finishing) return;
      else if (mode === 'about' && step === seq[0]) setStep(0);
      else if (mode === 'about' && step === 4) setStep(askAge ? 2 : 0);
      else if (mode === 'about' && step === 2) setStep(0);
      else setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, onClose, finishing, mode, askAge]);

  const face = pub?.displayName ?? 'PINGO';
  const seq: Step[] = mode === 'about' ? (askAge ? [2, 4, 5, 6] : [4, 5, 6]) : [1, 2, 3, 4, 5, 6, 7];
  const shell = {
    titleId,
    avatar: pub?.avatarUrl,
    progress: [Math.max(1, seq.indexOf(step) + 1), seq.length] as const,
  };
  const langs = orderedLanguages(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
  );

  /** The preview's end: the celebration, then closed, with nothing written. */
  const finishPreview = () => {
    setFinishing(true);
    window.setTimeout(() => onDone(), 1600);
  };

  const save = async () => {
    if (preview) return finishPreview();
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
        // Spicy picked, then the age changed to under 18: the default instead.
        personality: personality === 'spicy' && !isAdult(age) ? 'friendly' : personality,
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
        about_done_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (writeError) throw writeError;
      /*
       * What they are into, before the first message is asked for: the
       * greeting is made from these memories, so they have to be there first.
       */
      await saveAbout(profile.id, {
        interests,
        life,
        // Flirting is for adults; an age changed after picking it drops it.
        wants: isAdult(age) ? wants : wants.filter((w) => w !== 'flirt'),
        note,
      });
      if (conversationId) requestGreeting(conversationId);
      // Soft success beat, then hand off to chat.
      window.setTimeout(() => onDone(), 220);
    } catch (cause) {
      setFinishing(false);
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setBusy(false);
    }
  };

  /**
   * The end of the about-only run. Done counts whether they picked things or
   * skipped every step: either way they have answered, and it stops asking.
   */
  const saveAboutOnly = async () => {
    if (preview) return finishPreview();
    if (!profile) return;
    setBusy(true);
    setFinishing(true);
    await saveAbout(profile.id, {
      interests,
      life,
      wants: isAdult(age) ? wants : wants.filter((w) => w !== 'flirt'),
      note,
    });
    await Promise.resolve(
      getSupabaseClient()
        .from('ai_profiles')
        // The age, when this run asked for it; never overwrites one already on record.
        .update({ about_done_at: new Date().toISOString(), ...(askAge && age !== null ? { age } : {}) })
        .eq('user_id', profile.id),
    ).catch(() => undefined);
    window.setTimeout(() => onDone(), 220);
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
            'pingo-pastel rounded-[28px] p-0 shadow-[0_24px_64px_-12px_rgba(40,36,90,0.35)]',
          )}
        >
          <style>{MOTION}</style>
          {step === 0 && (
            <div className="flex flex-col items-center px-6 pb-6 pt-6 text-center">
              <div className="relative -mx-6 h-44 w-[calc(100%+3rem)]">
                <Sky />
                <div className="absolute inset-x-0 bottom-1 flex justify-center">
                  <AiFace src={pub?.avatarUrl} className="pingo-float size-36" />
                </div>
              </div>
              <h2 id={titleId} className="ob-in mt-4 text-[26px] font-extrabold leading-tight text-[var(--pp-ink)]">
                {mode === 'about' ? 'Tell me about you 👀' : `Hey, I'm ${face} 👋`}
              </h2>
              <p className="ob-in mt-2 max-w-[19rem] text-[15px] leading-relaxed text-[var(--pp-sub)] [animation-delay:80ms]">
                {mode === 'about'
                  ? 'A few taps, so I know what you love and our chats never get boring.'
                  : "Let's get to know each other. It takes a minute, and I'll remember."}
              </p>
              {/*
                * What it costs, said before it is asked: a small, known effort
                * is one people start, an unknown one is one they put off.
                */}
              <div className="ob-in mt-4 flex flex-wrap justify-center gap-2 [animation-delay:160ms]">
                {(mode === 'about' ? ['⏱️ 20 seconds', '👆 Just taps', '⏭️ Skip anything'] : ['⏱️ 1 minute', '🔒 Only for you']).map((pill) => (
                  <span key={pill} className="rounded-full bg-[var(--pp-card)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--pp-sub)] shadow-[var(--pp-shadow)]">
                    {pill}
                  </span>
                ))}
              </div>
              <div className="mt-6 w-full">
                <Cta onClick={() => setStep(mode === 'about' ? seq[0]! : 1)} autoFocus>
                  {mode === 'about' ? "Let's go" : 'Continue'}
                  <ArrowRight size={18} aria-hidden />
                </Cta>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="focus-ring mt-2 w-full py-2 text-center text-[13.5px] font-medium text-[var(--pp-faint)]"
              >
                Not now
              </button>
            </div>
          )}

          {step === 1 && (
            <StepShell
              {...shell}
              title={t('ai.whatCallYou')}
              onBack={() => setStep(0)}
            >
              <input
                autoFocus
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value.slice(0, 40))}
                placeholder={t('ai.yourName')}
                className={cn(
                  'focus-ring w-full rounded-2xl bg-[var(--pp-card)] shadow-[var(--pp-shadow)]',
                  'px-4 py-3.5 text-[20px] font-semibold text-[var(--pp-ink)] placeholder:text-[var(--pp-faint)]',
                )}
              />
              <p className="mt-3 text-[13.5px] text-[var(--pp-sub)]" aria-live="polite">
                {preferredName.trim()
                  ? `I’ll call you ${preferredName.trim()}.`
                  : t('ai.nameHint')}
              </p>
              <div className="mt-6">
                <Cta disabled={!preferredName.trim()} onClick={() => setStep(2)}>
                  Next <ArrowRight size={18} aria-hidden />
                </Cta>
              </div>
            </StepShell>
          )}

          {step === 2 && (
            <StepShell {...shell} title={t('ai.age')} onBack={() => setStep(mode === 'about' ? 0 : 1)}>
              <AiAgeWheel value={age} onChange={setAge} />
              <div className="mt-5">
                <Cta onClick={() => setStep(mode === 'about' ? 4 : 3)}>
                  Next <ArrowRight size={18} aria-hidden />
                </Cta>
              </div>
            </StepShell>
          )}

          {step === 3 && (
            <StepShell {...shell} title={t('ai.language')} onBack={() => setStep(2)}>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('ai.language')}>
                {langs.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={language === l.id}
                    onClick={() => setLanguage(l.id)}
                    className={cn(
                      'focus-ring h-10 rounded-full px-4 text-[14.5px] font-semibold transition-colors',
                      language === l.id
                        ? 'bg-[var(--pp-accent)] text-[var(--pp-accent-ink)]'
                        : 'bg-[var(--pp-card)] text-[var(--pp-ink)] shadow-[var(--pp-shadow)]',
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <div className="mt-6">
                <Cta onClick={() => setStep(4)}>
                  Next <ArrowRight size={18} aria-hidden />
                </Cta>
              </div>
            </StepShell>
          )}

          {step === 4 && (
            <StepShell {...shell} title="What are you into?"
              hint={`Pick up to ${MAX_INTERESTS}. I'll bring these up, so we never run out of things to talk about.`}
              reaction={reaction}
              onBack={() => setStep(mode === 'about' ? (askAge ? 2 : 0) : 3)}
            >
              <Chips
                label="Interests"
                chips={INTERESTS}
                picked={interests}
                max={MAX_INTERESTS}
                onToggle={(id) => {
                  const next = toggle(interests, id, MAX_INTERESTS);
                  setInterests(next);
                  heard(INTERESTS, id, next.includes(id) && !interests.includes(id));
                }}
              />
              <NextOrSkip empty={!interests.length} onNext={() => setStep(5)} />
            </StepShell>
          )}

          {step === 5 && (
            <StepShell {...shell} title="What's going on in your life right now?"
              reaction={reaction}
              onBack={() => setStep(4)}
            >
              <Chips
                label="Right now"
                chips={LIFE}
                picked={life ? [life] : []}
                onToggle={(id) => {
                  setLife(life === id ? null : id);
                  heard(LIFE, id, life !== id);
                }}
              />
              <label className="mt-5 block">
                <span className="text-[13.5px] font-semibold text-[var(--pp-sub)]">
                  One thing I should know about you <span className="font-normal text-[var(--pp-faint)]">(optional)</span>
                </span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                  placeholder="Delhi se hoon, RCB fan, chai > coffee"
                  className={cn(
                    'focus-ring mt-2 w-full rounded-2xl bg-[var(--pp-card)] shadow-[var(--pp-shadow)]',
                    'px-4 py-3 text-[15px] text-[var(--pp-ink)] placeholder:text-[var(--pp-faint)]',
                  )}
                />
              </label>
              <NextOrSkip empty={!life && !note.trim()} onNext={() => setStep(6)} />
            </StepShell>
          )}

          {step === 6 && (
            <StepShell {...shell} title={`What do you want me to be for you?`}
              hint={`Pick up to ${MAX_WANTS}.`}
              reaction={reaction}
              onBack={() => setStep(5)}
            >
              <Chips
                label="What you want"
                // Flirting is offered to adults only, like Spicy itself.
                chips={isAdult(age) ? WANTS : WANTS.filter((w) => w.id !== 'flirt')}
                picked={wants}
                max={MAX_WANTS}
                onToggle={(id) => {
                  const next = toggle(wants, id, MAX_WANTS);
                  setWants(next);
                  heard(WANTS, id, next.includes(id) && !wants.includes(id));
                  // Asked for flirting: Spicy is what that is, so it starts selected on the next step.
                  if (id === 'flirt' && next.includes('flirt')) setPersonality('spicy');
                  else if (id === 'flirt' && personality === 'spicy') setPersonality('friendly');
                }}
              />
              <NextOrSkip
                empty={!wants.length}
                last={mode === 'about'}
                onNext={() => (mode === 'about' ? void saveAboutOnly() : setStep(7))}
              />
            </StepShell>
          )}

          {step === 7 && (
            <StepShell
              {...shell}
              title={t('ai.howBe')}
              onBack={() => setStep(6)}
            >
              <AiPersonalityGrid
                value={personality}
                customText={custom}
                onChange={setPersonality}
                onCustomText={setCustom}
                age={age}
              />
              {error && (
                <p className="mt-2 text-center text-caption text-danger/90" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-5">
                <Cta disabled={busy} onClick={() => void save()}>
                  {busy ? t('ai.saving') : t('ai.startChat')}
                </Cta>
              </div>
            </StepShell>
          )}

          {finishing && (
            <div className="absolute inset-0 grid animate-fade-in place-items-center bg-[var(--pp-bg)]/95 backdrop-blur-sm">
              <div className="flex flex-col items-center px-6 text-center">
                <div className="relative h-32 w-48">
                  <Sky />
                  <div className="absolute inset-x-0 bottom-0 flex justify-center">
                    <AiFace src={pub?.avatarUrl} className="pingo-hop size-24" />
                  </div>
                </div>
                <p className="ob-in mt-3 text-[22px] font-extrabold text-[var(--pp-ink)]">
                  All set{preferredName.trim() ? `, ${preferredName.trim()}` : ''}! ✨
                </p>
                <p className="ob-in mt-1 text-[14.5px] text-[var(--pp-sub)] [animation-delay:90ms]">Ab baatein kabhi boring nahi hongi.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

/** Adds or removes `id`; a full list takes nothing more until something is taken off. */
function toggle(list: string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= max ? list : [...list, id];
}

/*
 * The motion, in one place. Chips arrive one after another rather than all at
 * once - a list that builds itself reads as being offered, a list that is just
 * there reads as a form - and a pick answers with a small pop. Nothing moves
 * for anyone who asked for less motion.
 */
const MOTION = `
@keyframes ob-in { from { opacity: 0; transform: translateY(8px) scale(.96) } }
@keyframes ob-bubble { from { opacity: 0; transform: translateY(6px) scale(.92) } }
@keyframes ob-pop { 40% { transform: scale(1.08) } }
@keyframes ob-dot { 0%, 60%, 100% { opacity: .25; transform: translateY(0) } 30% { opacity: 1; transform: translateY(-3px) } }
.ob-in { animation: ob-in .42s cubic-bezier(.2,.8,.2,1) both }
.ob-bubble { animation: ob-bubble .34s cubic-bezier(.2,.8,.2,1) both; transform-origin: 0 100% }
.ob-pop { animation: ob-pop .3s ease-out }
.ob-dot { animation: ob-dot 1s infinite }
@media (prefers-reduced-motion: reduce) { .ob-in, .ob-bubble, .ob-pop, .ob-dot { animation: none !important } }
`;

function Chips({
  label,
  chips,
  picked,
  max,
  onToggle,
}: {
  label: string;
  chips: Chip[];
  picked: string[];
  /** Shown as "2/5" once something is picked; omitted for a single choice. */
  max?: number;
  onToggle: (id: string) => void;
}) {
  const full = max !== undefined && picked.length >= max;
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {chips.map((c, i) => {
          const on = picked.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(c.id)}
              style={{ animationDelay: `${Math.min(i, 14) * 28}ms` }}
              className={cn(
                'ob-in focus-ring inline-flex h-10 items-center gap-1.5 rounded-full pl-3 pr-3.5 text-[14.5px] font-semibold',
                'transition-[background-color,box-shadow,opacity,color] duration-150 active:scale-[0.95]',
                on
                  ? 'ob-pop bg-[var(--pp-accent)] text-[var(--pp-accent-ink)] shadow-[0_6px_16px_-6px_var(--pp-accent)]'
                  : 'bg-[var(--pp-card)] text-[var(--pp-ink)] shadow-[var(--pp-shadow)]',
                !on && full && 'opacity-45',
              )}
            >
              <span aria-hidden className="text-[16px] leading-none">
                {on ? <Check size={15} strokeWidth={3} /> : c.emoji}
              </span>
              {c.label}
            </button>
          );
        })}
      </div>
      {max !== undefined && picked.length > 0 && (
        <p className="mt-3 text-[12.5px] font-medium tabular-nums text-[var(--pp-faint)]" aria-live="polite">
          {picked.length}/{max} picked{full ? ' · tap one to swap' : ''}
        </p>
      )}
    </div>
  );
}

/** The one button that moves things on: a gradient pill, as on Update and in the AI room. */
function Cta({
  children,
  onClick,
  disabled,
  quiet,
  autoFocus,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  quiet?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={cn(
        'focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-full text-[16px] font-semibold transition-transform active:scale-[0.98] disabled:opacity-40',
        quiet
          ? 'bg-[var(--pp-card)] text-[var(--pp-sub)] shadow-[var(--pp-shadow)]'
          : 'bg-sweep text-white shadow-[0_8px_22px_-8px_rgba(139,93,255,0.65)]',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Next when something is picked, Skip when nothing is: every one of these
 * steps is optional, and saying so on the button is what stops a blank step
 * from feeling like a wall.
 */
function NextOrSkip({ empty, onNext, last }: { empty: boolean; onNext: () => void; last?: boolean }) {
  return (
    <div className="mt-6">
      <Cta onClick={onNext} quiet={empty}>
        {empty ? 'Skip for now' : last ? 'Done' : 'Next'}
        {!empty && <ArrowRight size={18} aria-hidden />}
      </Cta>
    </div>
  );
}

/**
 * How far along, as segments. The first is already lit on the first step: a
 * journey that has visibly started is one people finish (the endowed-progress
 * effect), where an empty bar reads as the whole distance still ahead.
 */
function Progress({ at, total }: { at: number; total: number }) {
  return (
    <div
      className="flex flex-1 gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={at}
      aria-label={`Step ${at} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--pp-line)]">
          <span
            className="bg-sweep block h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: i < at ? '100%' : '0%' }}
          />
        </span>
      ))}
    </div>
  );
}

/**
 * A step, asked by Pingu rather than printed by a form: its face, then the
 * question in a chat bubble that types itself in. It is a chat app and this is
 * the first conversation - a question from somebody gets answered, a field on
 * a page gets skipped. Its reaction to the last pick appears under the
 * question, so every tap is heard.
 */
function StepShell({
  titleId,
  title,
  hint,
  reaction,
  avatar,
  progress,
  onBack,
  children,
}: {
  titleId: string;
  title: string;
  hint?: string;
  reaction?: string | undefined;
  avatar?: string | null | undefined;
  progress: readonly [number, number];
  onBack: () => void;
  children: React.ReactNode;
}) {
  const [typing, setTyping] = useState(true);
  useEffect(() => {
    setTyping(true);
    const timer = window.setTimeout(() => setTyping(false), 520);
    return () => window.clearTimeout(timer);
  }, [title]);

  return (
    <div className="px-5 pb-6 pt-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="focus-ring grid size-9 shrink-0 place-items-center rounded-full bg-[var(--pp-card)] text-[var(--pp-sub)] shadow-[var(--pp-shadow)] active:scale-95"
        >
          <ChevronLeft size={19} aria-hidden />
        </button>
        <Progress at={progress[0]} total={progress[1]} />
      </div>

      <div className="mt-5 flex items-end gap-2.5">
        <AiFace src={avatar} framed className="size-10 shrink-0 ring-2 ring-[var(--pp-card)]" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="ob-bubble w-fit max-w-full rounded-[20px] rounded-bl-[6px] bg-[var(--pp-card)] px-4 py-3 shadow-[var(--pp-shadow)]">
            {typing && (
              <span className="flex h-6 items-center gap-1" aria-hidden>
                <i className="ob-dot size-1.5 rounded-full bg-[var(--pp-faint)]" />
                <i className="ob-dot size-1.5 rounded-full bg-[var(--pp-faint)] [animation-delay:.15s]" />
                <i className="ob-dot size-1.5 rounded-full bg-[var(--pp-faint)] [animation-delay:.3s]" />
              </span>
            )}
            <h2 id={titleId} className={cn('text-[19px] font-bold leading-snug text-[var(--pp-ink)]', typing && 'sr-only')}>
              {title}
            </h2>
            {hint && !typing && <p className="mt-0.5 text-[13.5px] leading-snug text-[var(--pp-sub)]">{hint}</p>}
          </div>
          {reaction && !typing && (
            <p
              key={reaction}
              aria-live="polite"
              className="ob-bubble w-fit max-w-full rounded-[18px] rounded-bl-[6px] bg-[var(--pp-accent-soft)] px-3.5 py-2 text-[14px] font-medium text-[var(--pp-ink)]"
            >
              {reaction}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5">{children}</div>
    </div>
  );
}
