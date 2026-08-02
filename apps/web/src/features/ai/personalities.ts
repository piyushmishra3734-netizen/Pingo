/** Shared personality catalog for onboarding + profile. */

export type PersonalityId =
  | 'friendly'
  | 'genz'
  | 'coach'
  | 'study'
  | 'calm'
  | 'funny'
  | 'motivator'
  | 'creative'
  | 'custom';

export const PERSONALITIES: {
  id: PersonalityId;
  label: string;
  hint: string;
  /** One-line sample of how they sound. */
  preview: string;
}[] = [
  {
    id: 'friendly',
    label: 'Friendly',
    hint: 'Warm and easy',
    preview: 'Hey — I’m here. What’s on your mind?',
  },
  {
    id: 'genz',
    label: 'Gen Z',
    hint: 'Natural energy',
    preview: 'Okay wait tell me everything thr',
  },
  {
    id: 'coach',
    label: 'Coach',
    hint: 'Clear next steps',
    preview: 'Got it. One small step you can take today…',
  },
  {
    id: 'study',
    label: 'Study Buddy',
    hint: 'Patient explainers',
    preview: 'Let’s break it down slowly — where are you stuck?',
  },
  {
    id: 'calm',
    label: 'Calm',
    hint: 'Steady, unhurried',
    preview: 'Take a breath. We can go at your pace.',
  },
  {
    id: 'funny',
    label: 'Funny',
    hint: 'Light humour',
    preview: 'Okay but first: we’re surviving this, right?',
  },
  {
    id: 'motivator',
    label: 'Motivator',
    hint: 'Encouraging',
    preview: 'You’re closer than you think. Want a push?',
  },
  {
    id: 'creative',
    label: 'Creative',
    hint: 'Ideas and play',
    preview: 'What if we tried a wilder angle…',
  },
  {
    id: 'custom',
    label: 'Custom',
    hint: 'You describe it',
    preview: 'I’ll match the vibe you write.',
  },
];

export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'Hindi' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'ar', label: 'Arabic' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'zh', label: 'Chinese' },
];

export const RESPONSE_LENGTHS = [
  { id: 'short' as const, label: 'Short', preview: 'A line or two. Chat-speed.' },
  { id: 'balanced' as const, label: 'Balanced', preview: 'A few sentences when it helps.' },
  { id: 'detailed' as const, label: 'Detailed', preview: 'Thorough when you need depth.' },
];

const RECENT_LANG_KEY = 'pingo:ai:recent-languages';

export function readRecentLanguages(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_LANG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecentLanguage(id: string): void {
  try {
    const next = [id, ...readRecentLanguages().filter((x) => x !== id)].slice(0, 4);
    localStorage.setItem(RECENT_LANG_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function orderedLanguages(deviceLang?: string): { id: string; label: string }[] {
  const recent = readRecentLanguages();
  const device = deviceLang?.slice(0, 2).toLowerCase();
  const priority = [
    ...recent,
    ...(device && !recent.includes(device) ? [device] : []),
  ];
  const rest = LANGUAGES.filter((l) => !priority.includes(l.id));
  const head = priority
    .map((id) => LANGUAGES.find((l) => l.id === id) ?? { id, label: id.toUpperCase() })
    .filter(Boolean);
  return [...head, ...rest];
}
