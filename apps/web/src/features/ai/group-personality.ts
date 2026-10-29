/**
 * `/personality <name>` in a group PINGO AI is in: how it talks there, for
 * everybody, until somebody changes it again.
 *
 * Only an adult (18+ by their PINGO AI age) may change it, any of them, because
 * one is Spicy; `set_group_ai_personality` holds that line, this only asks.
 * Spicy is still spoken to adults alone: anyone younger who tags PINGO AI there
 * gets the default voice (`spicy.ts`, `profile-prompt.ts`).
 */

import { getSupabaseClient } from '../../lib/supabase/client.js';

export const GROUP_PERSONALITIES = [
  { id: 'friendly', label: 'Default', names: ['default', 'friendly', 'normal'] },
  { id: 'funny', label: 'Fun', names: ['fun', 'funny'] },
  { id: 'genz', label: 'Gen Z', names: ['genz', 'gen-z'] },
  { id: 'creative', label: 'Creative', names: ['creative'] },
  { id: 'professional', label: 'Professional', names: ['professional', 'pro'] },
  { id: 'concise', label: 'Concise', names: ['concise', 'short'] },
  { id: 'calm', label: 'Calm', names: ['calm'] },
  { id: 'coach', label: 'Coach', names: ['coach'] },
  { id: 'study', label: 'Study Buddy', names: ['study'] },
  { id: 'motivator', label: 'Motivator', names: ['motivator'] },
  { id: 'spicy', label: 'Spicy 🔥', names: ['spicy'] },
] as const;

export type GroupPersonalityId = (typeof GROUP_PERSONALITIES)[number]['id'];

export const GROUP_PERSONALITY_HINT = `Try: ${GROUP_PERSONALITIES.map((p) => p.names[0]).join(', ')}`;

/**
 * `/personality spicy` → the personality; `/personality` alone → 'list';
 * anything else, undefined (an ordinary message).
 */
export function parseGroupPersonality(text: string): (typeof GROUP_PERSONALITIES)[number] | 'list' | 'unknown' | undefined {
  const match = /^\/personality(?:\s+(.*))?$/i.exec(text.trim());
  if (!match) return undefined;
  const name = (match[1] ?? '').trim().toLowerCase();
  if (!name) return 'list';
  return GROUP_PERSONALITIES.find((p) => (p.names as readonly string[]).includes(name)) ?? 'unknown';
}

/** Sets it, or says why not in words fit to show. */
export async function setGroupPersonality(conversationId: string, id: GroupPersonalityId): Promise<string | undefined> {
  const { error } = await getSupabaseClient().rpc('set_group_ai_personality' as never, {
    target: conversationId,
    new_personality: id,
  } as never);
  if (!error) return undefined;
  const message = error.message ?? '';
  if (/adults_only/.test(message)) return 'Only members who are 18+ can change PINGO AI’s personality.';
  if (/unknown_personality/.test(message)) return `That personality doesn’t exist. ${GROUP_PERSONALITY_HINT}.`;
  return message || 'Could not change it. Try again?';
}
