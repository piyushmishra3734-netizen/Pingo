/**
 * Whose conversation the assistant is holding in its head.
 *
 * The complaint was "it forgets what I said". It was not forgetting. In a
 * shared group the model's window was the last forty lines, and the last forty
 * lines belong to whoever has been talking most - measured live on the
 * nine-person group, the assistant's own forty were nineteen of its replies,
 * eighteen from one member, two from the person who had just asked it
 * something, and one from a third.
 *
 * So this checks the property that fixes it: the asker's own exchanges are in
 * the window no matter how busy the room got. The busy-room case is built to
 * the shape of the real one, because a test with two speakers and four lines
 * passes whatever the function does.
 *
 * Run with `pnpm verify:ai-context`.
 */
import { windowIndices } from '../../../supabase/functions/ai-chat/history-window.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** `undefined` is the assistant; a string is that person's line. */
type Line = string | undefined;

const ME = 'Piyush';
const THEM = 'Baani';

/** How many of `mine` survive the window. */
const minesIn = (speakers: Line[], picked: number[], mine: string) =>
  picked.filter((i) => speakers[i] === mine).length;

console.log('\n--- a one-to-one, where there is nobody to crowd you out ---');

{
  const speakers: Line[] = [];
  for (let i = 0; i < 100; i += 1) speakers.push(i % 2 === 0 ? undefined : ME);

  const picked = windowIndices(speakers);
  check(picked.length === 40, 'the window is the last forty lines');
  check(picked[0] === 60 && picked[picked.length - 1] === 99, 'and they are the most recent forty');
  check(
    picked.every((v, i) => i === 0 || v > picked[i - 1]!),
    'indices come back in the order things were said',
  );
}

console.log('\n--- the busy group, built like the real one ---');

/*
 * 400 lines. One member and the assistant talk constantly; the asker said
 * something a while ago and then twice just now - which is exactly the shape
 * that produced two lines out of forty.
 */
const busy: Line[] = [];
for (let i = 0; i < 380; i += 1) {
  if (i % 3 === 0) busy.push(undefined);
  else if (i % 17 === 0) busy.push(ME);
  else busy.push(THEM);
}
busy.push(ME, undefined, ME, undefined);

{
  const before = windowIndices(busy);
  const after = windowIndices(busy, ME);

  const minesBefore = minesIn(busy, before, ME);
  const minesAfter = minesIn(busy, after, ME);

  console.log(`      (asker's lines in window: ${minesBefore} before, ${minesAfter} after)`);

  check(minesBefore < 8, 'without the fix the asker is a footnote in their own conversation');
  check(minesAfter >= 8, 'with it, at least eight of their turns are always there');
  check(
    after.every((v, i) => i === 0 || v > after[i - 1]!),
    'still in the order things were said',
  );
  check(
    before.every((i) => after.includes(i)),
    'nothing recent is dropped to make room - the room is still readable',
  );

  /*
   * A question the assistant can see without the answer it already gave is
   * worse than seeing neither: it reads its own unanswered prompt and says the
   * same thing again.
   */
  const reachedBack = after.filter((i) => !before.includes(i));
  const pairedUp = reachedBack
    .filter((i) => busy[i] === ME)
    .every((i) => busy[i + 1] !== undefined || after.includes(i + 1));
  check(pairedUp, 'every recovered question brings the reply that followed it');
  check(reachedBack.length > 0, 'it did have to reach back - the fixture is doing its job');
}

console.log('\n--- it never invents, and never runs away ---');

{
  const short: Line[] = [ME, undefined, THEM];
  const picked = windowIndices(short, ME);
  check(picked.length === 3, 'a thread shorter than the window is kept whole');

  check(windowIndices([], ME).length === 0, 'an empty thread is empty, not an error');

  const noneOfMine = windowIndices(
    Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? undefined : THEM)),
    ME,
  );
  check(
    noneOfMine.length === 40,
    'somebody who has not spoken yet gets the ordinary window, not a search of the whole thread',
  );

  const capped = windowIndices(busy, ME);
  check(
    capped.length <= 40 + 8 * 2,
    `the reach-back is bounded (${capped.length} lines), so a long thread cannot grow the prompt without limit`,
  );

  check(
    windowIndices(busy, 'Nobody With This Name').length === 40,
    'a name that is not in the thread changes nothing',
  );
}

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
