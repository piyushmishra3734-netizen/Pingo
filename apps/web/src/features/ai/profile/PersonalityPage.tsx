import { Toggle, cn } from '@pingo/ui';
import { Brain, Briefcase, CheckCircle2, FileText, Gamepad2, Heart, Lightbulb, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { saveAiPrefs, useAiPrefs } from '../room/ai-prefs.js';
import { AI_PERSONAS, LIMITS, personaLabel } from './ai-profile-model.js';
import { AiFace, Card, Counted, fieldClass, Sky, TopBar } from './pastel.js';

const ICONS: Record<string, ReactNode> = {
  friendly: <Sparkles size={26} className="text-[var(--pp-accent)]" />,
  professional: <Briefcase size={25} />,
  creative: <Lightbulb size={26} className="text-[var(--pp-gold)]" />,
  concise: <FileText size={25} />,
  funny: <Gamepad2 size={26} className="text-[#d946ef]" />,
  custom: <SlidersHorizontal size={25} />,
};

/**
 * How PINGO AI talks, saved to `ai_profiles.personality` and
 * `custom_instructions`; the chat and call functions put both into every
 * request (`profile-prompt.ts`).
 */
export function PersonalityPage({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const { prefs, loaded } = useAiPrefs();
  const [persona, setPersona] = useState('friendly');
  const [instructions, setInstructions] = useState('');
  const [memory, setMemory] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!loaded || ready) return;
    setPersona(prefs.personality ?? 'friendly');
    setInstructions(prefs.custom_instructions ?? (prefs.personality === 'custom' ? (prefs.custom_personality ?? '') : ''));
    setMemory(prefs.memory_enabled !== false);
    setReady(true);
  }, [loaded, ready, prefs]);

  const legacy = ready && !AI_PERSONAS.some((p) => p.id === prefs.personality) ? prefs.personality : undefined;
  const line = AI_PERSONAS.find((p) => p.id === persona)?.line ?? "I'm always here to help you.";
  const tooLong = instructions.trim().length > LIMITS.instructions;
  const customEmpty = persona === 'custom' && !instructions.trim();
  const dirty =
    ready &&
    (persona !== (prefs.personality ?? 'friendly') ||
      instructions.trim() !== (prefs.custom_instructions ?? (prefs.personality === 'custom' ? (prefs.custom_personality ?? '') : '')).trim() ||
      memory !== (prefs.memory_enabled !== false));

  const save = async () => {
    if (tooLong || customEmpty) return;
    setSaving(true);
    setError(undefined);
    const text = instructions.trim();
    const err = await saveAiPrefs({
      personality: persona,
      custom_instructions: text || null,
      custom_personality: persona === 'custom' ? text : null,
      memory_enabled: memory,
    });
    setSaving(false);
    if (err) setError(err);
    else onSaved();
  };

  return (
    <>
      <TopBar title="Personality" onBack={onBack} action={{ label: 'Save', onClick: () => void save(), disabled: !dirty || tooLong || customEmpty, busy: saving }} />
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
        <div className="relative -mx-4 h-44">
          <Sky sparkles={false} />
          <AiFace src={prefs.avatar_url} className={prefs.avatar_url && prefs.avatar_url !== '/ai/avatars/classic.webp' ? 'absolute bottom-3 left-[18%] size-32 ring-4 ring-[var(--pp-card)]' : 'absolute bottom-0 left-[14%] h-40 w-44'} />
          <p className="pp-card absolute right-4 top-3 max-w-[11rem] rounded-[22px] rounded-bl-[6px] px-4 py-2.5 text-[14.5px] leading-snug">
            {line} <Heart size={13} className="inline -translate-y-px fill-[var(--pp-accent)] text-[var(--pp-accent)]" aria-hidden />
          </p>
        </div>

        <div role="radiogroup" aria-label="Personality" className="mt-2 flex flex-col gap-2.5">
          {legacy && (
            <Persona on={persona === legacy} icon={<Sparkles size={24} />} title={`${personaLabel(legacy)} (current)`} sub="A personality from before" onPick={() => setPersona(legacy)} />
          )}
          {AI_PERSONAS.map((p) => (
            <Persona key={p.id} on={persona === p.id} icon={ICONS[p.id]} title={p.label} sub={p.sub} onPick={() => setPersona(p.id)} />
          ))}
        </div>

        <Card className="mt-4 p-4">
          <label>
            <span className="block text-[16.5px] font-bold">Custom instructions</span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              placeholder="Tell Pingo how you want it to behave..."
              className={cn(fieldClass, 'mt-2.5 resize-none py-3 leading-snug')}
            />
          </label>
          <Counted value={instructions.trim()} max={LIMITS.instructions} />
          <p className="text-[13px] text-[var(--pp-sub)]">
            {persona === 'custom' ? 'With Custom, these words are its whole personality.' : 'Followed in every chat and call, whatever the personality.'}
          </p>
          {customEmpty && <p className="mt-1 text-[13px] text-danger">Describe the personality you want for Custom.</p>}
        </Card>

        <Card className="mt-3">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <Brain size={25} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold">Remember in memory</span>
              <span className="block text-[13.5px] text-[var(--pp-sub)]">Let Pingo save what you ask it to remember</span>
            </span>
            <Toggle checked={memory} onChange={setMemory} label="Remember in memory" />
          </div>
        </Card>

        <p className="mt-3 px-1 text-[13.5px] leading-snug text-[var(--pp-sub)]">Pingo follows this personality in all your chats with it and on voice calls.</p>
        {error && (
          <p role="alert" className="mt-2 text-center text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

function Persona({ on, icon, title, sub, onPick }: { on: boolean; icon: ReactNode; title: string; sub: string; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn('pp-card flex w-full items-center gap-3.5 px-4 py-3.5 text-left ring-1 transition-colors', on ? 'bg-[var(--pp-accent-soft)] ring-[var(--pp-accent)]/30' : 'ring-transparent')}
    >
      <span className="grid size-9 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16.5px] font-semibold">{title}</span>
        <span className="block text-[14px] text-[var(--pp-sub)]">{sub}</span>
      </span>
      {on && <CheckCircle2 size={26} className="shrink-0 fill-[var(--pp-accent)] text-[var(--pp-card)]" aria-hidden />}
    </button>
  );
}
