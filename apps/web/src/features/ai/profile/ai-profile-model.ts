/**
 * PINGO AI's profile page, the parts with no React in them: the avatar
 * catalogue, the personalities it offers, validation of an edit, and how an
 * imported memory file becomes rows. `pnpm verify:ai-profile` asserts them.
 */

import type { AiProfileRow } from '../../../lib/supabase/types.js';

/* ---------- avatars ---------- */

export type AvatarCategory = 'default' | 'cute' | 'minimal' | 'pro';

export interface AiAvatar {
  id: string;
  label: string;
  src: string;
  category: AvatarCategory;
}

/** The ten preset faces. The Pro ones need Pingo Pro (the database checks too). */
export const AI_AVATARS: readonly AiAvatar[] = [
  { id: 'classic', label: 'Classic', src: '/ai/avatars/classic.webp', category: 'default' },
  { id: 'star', label: 'Star', src: '/ai/avatars/star.webp', category: 'cute' },
  { id: 'sleepy', label: 'Sleepy', src: '/ai/avatars/sleepy.webp', category: 'minimal' },
  { id: 'reader', label: 'Reader', src: '/ai/avatars/reader.webp', category: 'default' },
  { id: 'headset', label: 'At work', src: '/ai/avatars/headset.webp', category: 'pro' },
  { id: 'sprout', label: 'Sprout', src: '/ai/avatars/sprout.webp', category: 'cute' },
  { id: 'heart', label: 'Hello', src: '/ai/avatars/heart.webp', category: 'cute' },
  { id: 'cozy', label: 'Cozy', src: '/ai/avatars/cozy.webp', category: 'minimal' },
  { id: 'wizard', label: 'Wizard', src: '/ai/avatars/wizard.webp', category: 'pro' },
  { id: 'explorer', label: 'Explorer', src: '/ai/avatars/explorer.webp', category: 'pro' },
];

export const AVATAR_TABS: { id: 'all' | AvatarCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'default', label: 'Default' },
  { id: 'cute', label: 'Cute' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'pro', label: 'Pro' },
];

export const DEFAULT_AVATAR = AI_AVATARS[0]!;

export function avatarsIn(tab: 'all' | AvatarCategory): AiAvatar[] {
  return tab === 'all' ? [...AI_AVATARS] : AI_AVATARS.filter((a) => a.category === tab);
}

export function presetFor(url: string | null | undefined): AiAvatar | undefined {
  return url ? AI_AVATARS.find((a) => a.src === url) : undefined;
}

/** Whether this person may wear this avatar. */
export function canUseAvatar(avatar: AiAvatar, premium: boolean): boolean {
  return avatar.category !== 'pro' || premium;
}

/* ---------- personalities ---------- */

/**
 * The six the page offers, stored as the ids the server already knows:
 * Default is `friendly` and Fun is `funny`, so nobody's saved choice moves.
 */
export const AI_PERSONAS = [
  { id: 'friendly', label: 'Default', sub: 'Friendly, helpful, and balanced', line: "I'm always here to help you." },
  { id: 'professional', label: 'Professional', sub: 'More formal and focused', line: 'Ready when you are. What do you need?' },
  { id: 'creative', label: 'Creative', sub: 'Imaginative and idea-focused', line: "Let's dream up something new." },
  { id: 'concise', label: 'Concise', sub: 'Short and to the point', line: 'Ask. I answer. Briefly.' },
  { id: 'funny', label: 'Fun', sub: 'Playful and casual', line: "Okay, what are we getting into today?" },
  { id: 'custom', label: 'Custom', sub: 'Set your own personality', line: "I'll be exactly how you describe me." },
] as const;

export type AiPersonaId = (typeof AI_PERSONAS)[number]['id'];

/** Names for the older personalities a row may still hold, so the page can say what is in use. */
const LEGACY_LABELS: Record<string, string> = {
  genz: 'Gen Z',
  coach: 'Coach',
  study: 'Study Buddy',
  calm: 'Calm',
  motivator: 'Motivator',
  spicy: 'Spicy',
};

export function personaLabel(id: string | null | undefined): string {
  const p = AI_PERSONAS.find((x) => x.id === id);
  return p?.label ?? LEGACY_LABELS[id ?? ''] ?? 'Default';
}

export function personaSub(id: string | null | undefined): string {
  return AI_PERSONAS.find((x) => x.id === id)?.sub ?? (LEGACY_LABELS[id ?? ''] ? 'A personality from before' : AI_PERSONAS[0].sub);
}

/* ---------- status ---------- */

export const AI_STATUSES = [
  { id: 'online', label: 'Online', dot: '#22c55e' },
  { id: 'away', label: 'Away', dot: '#f5b800' },
  { id: 'dnd', label: 'Do not disturb', dot: '#ef4444' },
] as const;

export type AiStatus = (typeof AI_STATUSES)[number]['id'];

export function asStatus(v: unknown): AiStatus {
  return v === 'away' || v === 'dnd' ? v : 'online';
}

/* ---------- limits and validation ---------- */

export const LIMITS = { name: 40, tagline: 50, bio: 200, instructions: 500 } as const;

export interface ProfileDraft {
  name: string;
  tagline: string;
  bio: string;
}

/** What is wrong with an edit, field by field; empty when it can be saved. */
export function validateProfile(d: ProfileDraft): Partial<Record<keyof ProfileDraft, string>> {
  const out: Partial<Record<keyof ProfileDraft, string>> = {};
  const name = d.name.trim();
  if (!name) out.name = 'Give it a name.';
  else if (name.length > LIMITS.name) out.name = `Up to ${LIMITS.name} characters.`;
  if (d.tagline.trim().length > LIMITS.tagline) out.tagline = `Up to ${LIMITS.tagline} characters.`;
  if (d.bio.trim().length > LIMITS.bio) out.bio = `Up to ${LIMITS.bio} characters.`;
  return out;
}

/* ---------- voice ---------- */

export const VOICE_SPEED = { min: 0.7, max: 1.3, step: 0.05 } as const;

export function clampSpeed(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  const clamped = Math.min(VOICE_SPEED.max, Math.max(VOICE_SPEED.min, n));
  return Math.round(clamped * 100) / 100;
}

export function speedLabel(v: number): string {
  if (v <= 0.85) return 'Slower';
  if (v >= 1.15) return 'Faster';
  return 'Normal';
}

/* ---------- memory import ---------- */

/** What `ai_memories` holds per row, and how many PINGO AI keeps. */
export const MEMORY_VALUE_MAX = 500;
export const MEMORY_KEY_MAX = 80;
export const MEMORY_CAP = 60;

export function memoryKey(value: string): string {
  const key = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEMORY_KEY_MAX);
  return key || 'note';
}

/**
 * An imported file or pasted text as memory rows: a JSON array (of strings, or
 * of `{ value }` / `{ text }` objects, the shape this page exports) or plain
 * text, one memory per line, bullets stripped. Duplicates (and ones already
 * saved) are dropped, and no more than `room` come back.
 */
export function parseMemoryImport(raw: string, existing: string[] = [], room = MEMORY_CAP): { key: string; value: string }[] {
  let items: string[] = [];
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        items = parsed.map((x) =>
          typeof x === 'string'
            ? x
            : x && typeof x === 'object'
              ? String((x as { value?: unknown; text?: unknown }).value ?? (x as { text?: unknown }).text ?? '')
              : '',
        );
      }
    } catch {
      items = text.split(/\r?\n/);
    }
  } else {
    items = text.split(/\r?\n/);
  }
  const seen = new Set(existing.map((v) => v.trim().toLowerCase()));
  const out: { key: string; value: string }[] = [];
  for (const item of items) {
    const value = item
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MEMORY_VALUE_MAX);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push({ key: memoryKey(value), value });
    if (out.length >= Math.max(0, room)) break;
  }
  return out;
}

/* ---------- the row ---------- */

/** The row as written: every column the app owns, from the merged state. */
export function toAiProfileUpsert(userId: string, next: Partial<AiProfileRow>, now = new Date()) {
  const personality = next.personality ?? 'friendly';
  return {
    user_id: userId,
    display_name: next.display_name?.trim() || null,
    bio: next.bio?.trim() ? next.bio.trim().slice(0, 200) : null,
    tagline: next.tagline?.trim() ? next.tagline.trim().slice(0, 50) : null,
    status: next.status ?? 'online',
    personality,
    custom_personality: personality === 'custom' ? (next.custom_personality?.trim() || next.custom_instructions?.trim() || null) : null,
    custom_instructions: next.custom_instructions?.trim() ? next.custom_instructions.trim().slice(0, 500) : null,
    response_length: next.response_length ?? 'short',
    preferred_name: next.preferred_name ?? null,
    /*
     * Missing from this list until 2026-10-30: the Personality page's "Your
     * age" showed the new age and never wrote it, so it was back to the old
     * one on the next open. Anything a settings screen can change has to be here.
     */
    age: next.age ?? null,
    language: next.language ?? null,
    memory_enabled: next.memory_enabled ?? true,
    reactions_enabled: next.reactions_enabled ?? true,
    avatar_url: next.avatar_url ?? null,
    banner_url: next.banner_url ?? null,
    voice: next.voice ?? null,
    voice_speed: next.voice_speed ?? 1,
    voice_language: next.voice_language ?? null,
    updated_at: now.toISOString(),
  };
}

