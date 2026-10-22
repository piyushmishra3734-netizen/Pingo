import { musicPlayer, playerState } from '../music/player.js';
import { music, playback } from '../music/saavn/index.js';
import { searchMedia } from '../tv/api/tmdb.js';
import { watchPath } from '../tv/routes.js';
import { describe, type VoiceCommand } from './commands.js';

/**
 * Doing what was asked. Music and Pingo TV only: these cost nothing to run and
 * can all be undone with one more word, so they need no confirmation. Anything
 * that spends credits or speaks for the person stays in PINGO Master, with its
 * Approve button.
 */

export async function run(command: VoiceCommand, go: (path: string, state?: unknown) => void): Promise<string> {
  switch (command.kind) {
    case 'play_song': {
      const found = await music.searchSongs(command.query);
      const song = found.items[0];
      if (!song) return `No song found for ${command.query}`;
      playback.playSong(song);
      return `Playing ${song.name}`;
    }
    case 'play_movie': {
      const found = await searchMedia(command.query);
      const title = found[0];
      if (!title) return `Nothing found for ${command.query}`;
      go(watchPath(title), { media: title });
      return `Opening ${title.title ?? title.name ?? command.query}`;
    }
    case 'play_music':
      await playback.playForYou();
      return describe(command);
    case 'pause':
      if (playerState().playing) musicPlayer.pause();
      return describe(command);
    case 'resume':
      if (!playerState().playing) playback.toggleCurrent();
      return describe(command);
    case 'next':
      playback.next();
      return describe(command);
    case 'previous':
      playback.prev();
      return describe(command);
  }
}
