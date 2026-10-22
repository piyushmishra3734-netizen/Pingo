/**
 * "Hey Pingo" in words: finding the wake phrase in what was heard, and turning
 * what follows into one of a few commands.
 *
 * Pure text in, plain data out, so it is checked without a microphone (see
 * `pnpm verify:voice-commands`). Speech recognition mishears "Pingo" all the
 * time, so the wake phrase accepts the usual mishearings; the commands accept
 * English and the Hinglish people actually say ("kesariya bajao").
 */

export type VoiceCommand =
  | { kind: 'play_song'; query: string }
  | { kind: 'play_movie'; query: string }
  | { kind: 'play_music' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'next' }
  | { kind: 'previous' };

const NAME = '(?:pingo|pinko|pingu|pinggo|ping go|ping-go|bingo|pango|pingoo|pingow|pinku)';
const WAKE = new RegExp(`\\b(?:hey|hay|hi|hello|ok|okay|a|oye|are)\\s+${NAME}\\b[\\s,.!?:-]*`, 'i');

/** What was said after "Hey Pingo", when the phrase is in the text; `''` when that was all; null when it is not there. */
export function afterWake(heard: string): string | null {
  const m = WAKE.exec(heard.trim());
  if (!m) return null;
  return heard.slice(m.index + m[0].length).trim();
}

const FILLER = /\b(please|plz|pls|zara|na|yaar|bro|bhai|ek|the|a|me|mujhe|mere liye|for me|now|abhi|kar do|kardo|kar de|karo|ko)\b/gi;

function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"“”]/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MOVIE_WORDS = /\b(movie|film|picture|series|show|season|episode|pingo tv|tv)\b/;

/** "kesariya by arijit" and "kesariya arijit singh" are both fine as a search; only the glue words go. */
function tidyQuery(query: string): string {
  return query
    .replace(/\b(song|gaana|gana|gaane|music|track|on pingo music|on pingo tv|on pingo|pingo music|pingo tv|movie|film|picture|series|show|sunao|suna|sunna|dikhao|dikha|dekhna|dekhni|dekho|chalao|chala|bajao|baja|laga|lagao|play|open|watch|start|put on|on)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(?:ke|ki|ka)$/, '');
}

export function parseCommand(spoken: string): VoiceCommand | undefined {
  const t = clean(spoken);
  if (!t) return undefined;

  if (/^(pause|stop|ruko|ruk jao|ruk ja|band karo|band|chup|stop music|pause music|stop the music|gaana band|music band)$/.test(t) || /^(pause|stop|ruk|band)\b.*\b(music|song|gaana|gana|playback)\b/.test(t)) {
    return { kind: 'pause' };
  }
  if (/^(resume|continue|play|play music|chalu karo|chalu|shuru karo|shuru|resume music|music chalao|gaana chalao|gana chalao)$/.test(t)) {
    return t === 'play' || t === 'play music' || /chalao|chalu|shuru/.test(t) ? { kind: 'play_music' } : { kind: 'resume' };
  }
  if (/^(next|skip|next song|next gaana|agla|agla gaana|agla gana|skip karo|skip song|skip this)$/.test(t)) return { kind: 'next' };
  if (/^(previous|prev|back|pichla|pichla gaana|previous song|go back|last song)$/.test(t)) return { kind: 'previous' };

  const movie = MOVIE_WORDS.test(t) || /\b(dikhao|dikha|dekhna|dekhni|dekho|watch)\b/.test(t);
  const query = tidyQuery(t);
  if (!query) return undefined;
  if (movie) return { kind: 'play_movie', query };
  if (/\b(play|bajao|baja|chalao|chala|laga|lagao|sunao|suna|sunna|put on|start)\b/.test(t)) return { kind: 'play_song', query };
  return undefined;
}

/** What to say back, short enough to read in a pill. */
export function describe(command: VoiceCommand): string {
  switch (command.kind) {
    case 'play_song':
      return `Playing ${command.query}`;
    case 'play_movie':
      return `Opening ${command.query}`;
    case 'play_music':
      return 'Playing music';
    case 'pause':
      return 'Paused';
    case 'resume':
      return 'Resuming';
    case 'next':
      return 'Next song';
    case 'previous':
      return 'Previous song';
  }
}
