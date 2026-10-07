/**
 * One sound at a time.
 *
 * Several parts of the app play audio on elements of their own: the music
 * player behind the island and the song cards, the music picker's preview,
 * the story editor's and the camera's song, a story's sound, voice messages,
 * Read aloud. Each used to start without asking, so a song picked in Edit
 * Profile played on top of the one already going from a chat.
 *
 * Every one of them now claims the speaker just before it plays, and claiming
 * pauses whoever had it - the way a phone's media apps take turns. Paused, not
 * stopped: the one that lost the speaker keeps its place and its controls show
 * it as paused, so it can be picked up again.
 *
 * Calls and the rain behind a chat are left out on purpose: a call is never
 * paused by a song, and ambient sound is not a thing anybody "plays".
 */
let holder: HTMLMediaElement | undefined;

/** Call right before `play()`. Pauses whatever else was playing. */
export function claimAudio(element: HTMLMediaElement) {
  if (holder && holder !== element && !holder.paused) holder.pause();
  holder = element;
}
