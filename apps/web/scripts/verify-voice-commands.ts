/**
 * "Hey Pingo": the wake phrase and the commands after it, as text.
 *
 * Speech recognition is the part nobody can test in CI, so everything that can
 * be pure is: what counts as the wake phrase (including how it is usually
 * misheard), and what each spoken line turns into.
 *
 * Run with `pnpm verify:voice-commands`.
 */
import assert from 'node:assert/strict';

import { afterWake, parseCommand } from '../src/features/voice-assistant/commands.js';

// The wake phrase, and what follows it.
assert.equal(afterWake('hey pingo play kesariya'), 'play kesariya');
assert.equal(afterWake('Hey Pingo'), '');
assert.equal(afterWake('ok pingo, next song'), 'next song');
assert.equal(afterWake('hi ping go play despacito'), 'play despacito');
assert.equal(afterWake('hey bingo pause'), 'pause');
assert.equal(afterWake('hello pinko play shape of you'), 'play shape of you');
assert.equal(afterWake('I want to play bingo'), null, 'bingo alone is not the wake phrase');
assert.equal(afterWake('pingo is a nice app'), null);
assert.equal(afterWake('hey siri play music'), null);

// Songs.
assert.deepEqual(parseCommand('play kesariya'), { kind: 'play_song', query: 'kesariya' });
assert.deepEqual(parseCommand('play kesariya by arijit singh'), { kind: 'play_song', query: 'kesariya by arijit singh' });
assert.deepEqual(parseCommand('play the song shape of you'), { kind: 'play_song', query: 'shape of you' });
assert.deepEqual(parseCommand('kesariya bajao'), { kind: 'play_song', query: 'kesariya' });
assert.deepEqual(parseCommand('gaana chalao tum hi ho'), { kind: 'play_song', query: 'tum hi ho' });
assert.deepEqual(parseCommand('arijit singh ke gaane sunao'), { kind: 'play_song', query: 'arijit singh' });
assert.deepEqual(parseCommand('please play kesariya'), { kind: 'play_song', query: 'kesariya' });

// Movies and shows go to Pingo TV.
assert.deepEqual(parseCommand('play movie 3 idiots'), { kind: 'play_movie', query: '3 idiots' });
assert.deepEqual(parseCommand('watch 3 idiots'), { kind: 'play_movie', query: '3 idiots' });
assert.deepEqual(parseCommand('open movie dangal on pingo tv'), { kind: 'play_movie', query: 'dangal' });
assert.deepEqual(parseCommand('3 idiots dikhao'), { kind: 'play_movie', query: '3 idiots' });
assert.deepEqual(parseCommand('play the series money heist'), { kind: 'play_movie', query: 'money heist' });

// Transport.
assert.deepEqual(parseCommand('pause'), { kind: 'pause' });
assert.deepEqual(parseCommand('stop the music'), { kind: 'pause' });
assert.deepEqual(parseCommand('ruko'), { kind: 'pause' });
assert.deepEqual(parseCommand('resume'), { kind: 'resume' });
assert.deepEqual(parseCommand('play music'), { kind: 'play_music' });
assert.deepEqual(parseCommand('next'), { kind: 'next' });
assert.deepEqual(parseCommand('agla gaana'), { kind: 'next' });
assert.deepEqual(parseCommand('previous song'), { kind: 'previous' });

// Things that are not commands are left alone rather than guessed at.
assert.equal(parseCommand(''), undefined);
assert.equal(parseCommand('what is the weather'), undefined);
assert.deepEqual(parseCommand('play'), parseCommand('play music'));

console.log('voice commands: wake phrase and commands understood');
