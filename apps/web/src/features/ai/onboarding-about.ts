/**
 * What PINGO AI learns at the start beyond how to talk: what to talk *about*.
 *
 * Name, age, language and personality tell it how to sound, and nothing to say -
 * so the first chat was "kya chal raha hai?" and the second was too. Three tap
 * steps fix that: what they are into, where they are in life, and what they want
 * PINGO AI for. Every one can be skipped.
 *
 * Kept as ordinary `ai_memories` rows, under fixed keys so going through this
 * again replaces them. Both chat paths already put memories in the prompt, the
 * person sees and deletes them on the Memory page, and nothing new was needed
 * in the database.
 */

import { getSupabaseClient } from '../../lib/supabase/client.js';

export interface Chip {
  id: string;
  label: string;
  emoji: string;
  /** How it reads inside the memory the model sees. */
  says: string;
}

export const INTERESTS: Chip[] = [
  { id: 'cricket', label: 'Cricket', emoji: '🏏', says: 'cricket' },
  { id: 'football', label: 'Football', emoji: '⚽', says: 'football' },
  { id: 'anime', label: 'Anime', emoji: '🍥', says: 'anime' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮', says: 'gaming' },
  { id: 'music', label: 'Music', emoji: '🎧', says: 'music' },
  { id: 'movies', label: 'Movies & series', emoji: '🎬', says: 'movies and web series' },
  { id: 'memes', label: 'Memes', emoji: '😂', says: 'memes' },
  { id: 'fitness', label: 'Gym & fitness', emoji: '💪', says: 'gym and fitness' },
  { id: 'coding', label: 'Coding', emoji: '💻', says: 'coding' },
  { id: 'fashion', label: 'Fashion', emoji: '👗', says: 'fashion' },
  { id: 'food', label: 'Food', emoji: '🍜', says: 'food' },
  { id: 'travel', label: 'Travel', emoji: '✈️', says: 'travel' },
  { id: 'books', label: 'Books', emoji: '📚', says: 'books' },
  { id: 'art', label: 'Art & design', emoji: '🎨', says: 'art and design' },
  { id: 'cars', label: 'Cars & bikes', emoji: '🏍️', says: 'cars and bikes' },
  { id: 'kpop', label: 'K-pop', emoji: '💜', says: 'K-pop' },
  { id: 'startups', label: 'Startups', emoji: '🚀', says: 'startups and business' },
  { id: 'photo', label: 'Photography', emoji: '📸', says: 'photography' },
];

export const LIFE: Chip[] = [
  { id: 'school', label: 'In school', emoji: '🎒', says: 'in school' },
  { id: 'college', label: 'In college', emoji: '🎓', says: 'in college' },
  { id: 'exams', label: 'Preparing for exams', emoji: '📝', says: 'preparing for competitive exams' },
  { id: 'work', label: 'Working', emoji: '💼', says: 'working' },
  { id: 'building', label: 'Building something', emoji: '🛠️', says: 'building something of their own' },
  { id: 'break', label: 'Taking a break', emoji: '🌴', says: 'taking a break' },
];

export const WANTS: Chip[] = [
  { id: 'friend', label: 'A friend to chill with', emoji: '😄', says: 'a friend to chill and joke with' },
  { id: 'help', label: 'Help with study or work', emoji: '📚', says: 'help with studies or work' },
  { id: 'vent', label: 'Someone to talk to', emoji: '🫂', says: 'someone to talk to when things are heavy' },
  { id: 'ideas', label: 'Ideas and plans', emoji: '💡', says: 'ideas and plans' },
  { id: 'flirt', label: 'Flirt', emoji: '🔥', says: 'someone to flirt with' },
];

export const MAX_INTERESTS = 5;
export const MAX_WANTS = 2;
export const NOTE_MAX = 140;

const KEYS = {
  interests: 'onboarding_interests',
  life: 'onboarding_life',
  wants: 'onboarding_wants',
  note: 'onboarding_note',
} as const;

const says = (list: Chip[], ids: string[]) =>
  ids.map((id) => list.find((c) => c.id === id)?.says).filter(Boolean).join(', ');

export interface About {
  interests: string[];
  life: string | null;
  wants: string[];
  note: string;
}

/**
 * Writes what they picked as memories, replacing an earlier run's. Never
 * throws: a missing memory makes the first chat plainer, not broken, and must
 * not stop them getting into it.
 */
export async function saveAbout(userId: string, about: About): Promise<void> {
  const rows: { user_id: string; key: string; value: string }[] = [];
  const add = (key: string, value: string) => value && rows.push({ user_id: userId, key, value: value.slice(0, 500) });
  const interests = says(INTERESTS, about.interests);
  if (interests) add(KEYS.interests, `Into: ${interests}.`);
  const life = about.life ? says(LIFE, [about.life]) : '';
  if (life) add(KEYS.life, `Right now they are ${life}.`);
  const wants = says(WANTS, about.wants);
  if (wants) add(KEYS.wants, `What they want from PINGO AI: ${wants}.`);
  const note = about.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  if (note) add(KEYS.note, `In their own words: "${note}"`);

  try {
    const client = getSupabaseClient();
    await client.from('ai_memories').delete().eq('user_id', userId).in('key', Object.values(KEYS));
    if (rows.length) await client.from('ai_memories').insert(rows);
  } catch {
    // See above.
  }
}

/**
 * Asks PINGO AI to send the first message, made from what they just told it.
 *
 * An empty chat waiting for "hi" is the dullest way to meet anybody. The
 * server only does this for a PINGO AI chat with nothing in it yet, so calling
 * it twice, or late, writes nothing.
 */
export function requestGreeting(conversationId: string): void {
  void getSupabaseClient()
    .functions.invoke('ai-chat', { body: { conversationId, action: 'greet' } })
    .catch(() => undefined);
}
