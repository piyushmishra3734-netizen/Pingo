import { resolveStream, searchSongs, upNext } from './innertube.js';

/**
 * "Is YouTube Music working on this phone, and if not, which step?"
 *
 * Runs the same four things a song needs, one after the other, and reports each:
 * search, an address for the first result, the audio actually starting to play
 * from that address, and the radio that follows it. Shown from Music settings,
 * so a problem is a line on the screen and not a guess.
 */

export interface Step {
  name: string;
  ok: boolean;
  note: string;
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

export async function diagnose(onStep: (steps: Step[]) => void): Promise<Step[]> {
  const steps: Step[] = [];
  const add = (step: Step) => {
    steps.push(step);
    onStep([...steps]);
  };

  let videoId = '';
  let name = '';
  try {
    const found = await searchSongs('arijit singh');
    videoId = found[0]!.id.slice(3);
    name = found[0]!.name;
    add({ name: 'Search', ok: true, note: `${found.length} songs, first is ${name}` });
  } catch (e) {
    add({ name: 'Search', ok: false, note: why(e) });
    return steps;
  }

  let url = '';
  try {
    const stream = await resolveStream(videoId);
    url = stream['160'] ?? Object.values(stream)[0] ?? '';
    add({ name: 'Audio address', ok: Boolean(url), note: url ? 'found' : 'none returned' });
  } catch (e) {
    add({ name: 'Audio address', ok: false, note: why(e) });
    return steps;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const a = new Audio();
      const timer = window.setTimeout(() => reject(new Error('no sound within 12 seconds')), 12_000);
      a.addEventListener('canplay', () => {
        window.clearTimeout(timer);
        resolve();
      });
      a.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error(`the player refused it (code ${a.error?.code ?? '?'})`));
      });
      a.muted = true;
      a.preload = 'auto';
      a.src = url;
      a.load();
    });
    add({ name: 'Playback', ok: true, note: 'the audio starts' });
  } catch (e) {
    add({ name: 'Playback', ok: false, note: why(e) });
  }

  try {
    const next = await upNext(videoId, 10);
    add({ name: 'Radio', ok: true, note: `${next.length} songs up next` });
  } catch (e) {
    add({ name: 'Radio', ok: false, note: why(e) });
  }
  return steps;
}
