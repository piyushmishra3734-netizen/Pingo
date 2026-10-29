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
  /** Pingu's line when it is picked: proof, in the moment, that it was heard. */
  react?: string;
}

export const INTERESTS: Chip[] = [
  { id: 'cricket', label: 'Cricket', emoji: '🏏', says: 'cricket', react: 'Cricket! Match ke din mujhe bhi bulana 🏏' },
  { id: 'football', label: 'Football', emoji: '⚽', says: 'football', react: 'Football fan? Messi ya Ronaldo, soch ke bolna ⚽' },
  { id: 'anime', label: 'Anime', emoji: '🍥', says: 'anime', react: 'Anime! Ab recommendations ki line lagegi 🍥' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮', says: 'gaming', react: 'Gamer spotted. GG pakka 🎮' },
  { id: 'music', label: 'Music', emoji: '🎧', says: 'music', react: 'Music! Playlist share karna padega 🎧' },
  { id: 'movies', label: 'Movies & series', emoji: '🎬', says: 'movies and web series', react: 'Movie nights sorted 🍿' },
  { id: 'memes', label: 'Memes', emoji: '😂', says: 'memes', react: 'Memes? Hum dono ki banegi 😂' },
  { id: 'fitness', label: 'Gym & fitness', emoji: '💪', says: 'gym and fitness', react: 'Gym wale! Rest day pe baat karenge 💪' },
  { id: 'coding', label: 'Coding', emoji: '💻', says: 'coding', react: 'Coder! Bugs ke saath main hoon 💻' },
  { id: 'fashion', label: 'Fashion', emoji: '👗', says: 'fashion', react: 'Fashion sense, I see you 👗' },
  { id: 'food', label: 'Food', emoji: '🍜', says: 'food', react: 'Foodie! Kya khaya aaj? 🍜' },
  { id: 'travel', label: 'Travel', emoji: '✈️', says: 'travel', react: 'Next trip kahan ka? ✈️' },
  { id: 'books', label: 'Books', emoji: '📚', says: 'books', react: 'Bookworm! Last kaunsi padhi? 📚' },
  { id: 'art', label: 'Art & design', emoji: '🎨', says: 'art and design', react: 'Artist vibes ✨' },
  { id: 'cars', label: 'Cars & bikes', emoji: '🏍️', says: 'cars and bikes', react: 'Vroom vroom 🏍️' },
  { id: 'kpop', label: 'K-pop', emoji: '💜', says: 'K-pop', react: 'K-pop! Bias kaun hai? 💜' },
  { id: 'startups', label: 'Startups', emoji: '🚀', says: 'startups and business', react: 'Founder energy 🚀' },
  { id: 'photo', label: 'Photography', emoji: '📸', says: 'photography', react: 'Photographer! Best shot dikhana 📸' },
];

export const LIFE: Chip[] = [
  { id: 'school', label: 'In school', emoji: '🎒', says: 'in school', react: 'School life, sab yaad hai mujhe 🎒' },
  { id: 'college', label: 'In college', emoji: '🎓', says: 'in college', react: 'College! Assignments, canteen aur drama 🎓' },
  { id: 'exams', label: 'Preparing for exams', emoji: '📝', says: 'preparing for competitive exams', react: 'Exam prep? Main saath padhunga 📝' },
  { id: 'work', label: 'Working', emoji: '💼', says: 'working', react: 'Working! Office ki kahaniyan sunaunga mat bolna 😄' },
  { id: 'building', label: 'Building something', emoji: '🛠️', says: 'building something of their own', react: 'Kuch bana rahe ho? Batao batao 🛠️' },
  { id: 'break', label: 'Taking a break', emoji: '🌴', says: 'taking a break', react: 'Break pe? Best phase 🌴' },
];

export const WANTS: Chip[] = [
  { id: 'friend', label: 'A friend to chill with', emoji: '😄', says: 'a friend to chill and joke with', react: 'Bakchodi partner, done 😄' },
  { id: 'help', label: 'Help with study or work', emoji: '📚', says: 'help with studies or work', react: 'Padhai ya kaam, sab sambhal lenge 📚' },
  { id: 'vent', label: 'Someone to talk to', emoji: '🫂', says: 'someone to talk to when things are heavy', react: 'Main hoon na. Kabhi bhi 🫂' },
  { id: 'ideas', label: 'Ideas and plans', emoji: '💡', says: 'ideas and plans', react: 'Ideas ki factory chalu 💡' },
  { id: 'flirt', label: 'Flirt', emoji: '🔥', says: 'someone to flirt with', react: 'Ohh, bold 😏' },
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
