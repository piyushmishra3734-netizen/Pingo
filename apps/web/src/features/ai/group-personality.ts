/**
 * How PINGO AI talks to *you* in a group: `@pingoai /personality` opens a card
 * (`GroupPersonalityCard`) and the pick is yours alone. PINGO AI stays the
 * whole group's - anyone can tag it - and answers each person in the voice
 * they chose, the default for anyone who chose nothing.
 *
 * Spicy is offered to adults only (18+ by their PINGO AI age) and
 * `set_my_group_ai_personality` refuses it for anyone else, whatever the app
 * shows.
 */

import { getSupabaseClient } from '../../lib/supabase/client.js';

export const GROUP_PERSONALITIES = [
  { id: 'friendly', label: 'Default', emoji: '✨', hint: 'Friendly and balanced', names: ['default', 'friendly', 'normal'] },
  { id: 'funny', label: 'Fun', emoji: '😂', hint: 'Jokes and banter', names: ['fun', 'funny'] },
  { id: 'genz', label: 'Gen Z', emoji: '💅', hint: 'Slang, memes, no cap', names: ['genz', 'gen-z'] },
  { id: 'creative', label: 'Creative', emoji: '💡', hint: 'Wild ideas', names: ['creative'] },
  { id: 'calm', label: 'Calm', emoji: '🌿', hint: 'Slow and steady', names: ['calm'] },
  { id: 'motivator', label: 'Motivator', emoji: '🔥', hint: 'Hype you up', names: ['motivator'] },
  { id: 'coach', label: 'Coach', emoji: '🎯', hint: 'Next steps, no fluff', names: ['coach'] },
  { id: 'study', label: 'Study Buddy', emoji: '📚', hint: 'Explains simply', names: ['study'] },
  { id: 'professional', label: 'Professional', emoji: '💼', hint: 'Formal and focused', names: ['professional', 'pro'] },
  { id: 'concise', label: 'Concise', emoji: '⚡', hint: 'Short answers', names: ['concise', 'short'] },
  { id: 'spicy', label: 'Spicy', emoji: '🌶️', hint: 'Flirty and bold · 18+', names: ['spicy'] },
] as const;

export type GroupPersonality = (typeof GROUP_PERSONALITIES)[number];
export type GroupPersonalityId = GroupPersonality['id'];

/**
 * `@pingoai /personality` or `/personality`, optionally with a name to start
 * the card on; anything else is an ordinary message (undefined).
 */
export function parseGroupPersonality(text: string): { start?: GroupPersonalityId } | undefined {
  const match = /^\s*(?:@pingo_?ai\s+)?\/personality\b\s*(\S*)\s*$/i.exec(text);
  if (!match) return undefined;
  const name = (match[1] ?? '').toLowerCase();
  const start = GROUP_PERSONALITIES.find((p) => (p.names as readonly string[]).includes(name));
  return start ? { start: start.id } : {};
}

/** Their PINGO AI age and what they picked in this group, for the card. */
export async function loadMine(conversationId: string, userId: string): Promise<{ age: number | null; current: GroupPersonalityId }> {
  const client = getSupabaseClient();
  const [profile, member] = await Promise.all([
    client.from('ai_profiles').select('age').eq('user_id', userId).maybeSingle(),
    client
      .from('conversation_members')
      .select('ai_personality' as never)
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  const age = (profile.data as { age?: number | null } | null)?.age ?? null;
  const picked = (member.data as { ai_personality?: string | null } | null)?.ai_personality;
  const current = GROUP_PERSONALITIES.find((p) => p.id === picked)?.id ?? 'friendly';
  return { age, current };
}

/** Saves their pick, or says why not in words fit to show. */
export async function setMine(conversationId: string, id: GroupPersonalityId): Promise<string | undefined> {
  const { error } = await getSupabaseClient().rpc('set_my_group_ai_personality' as never, {
    target: conversationId,
    new_personality: id,
  } as never);
  if (!error) return undefined;
  const message = error.message ?? '';
  if (/adults_only/.test(message)) return 'Spicy is for 18+ only.';
  return message || 'Could not change it. Try again?';
}
