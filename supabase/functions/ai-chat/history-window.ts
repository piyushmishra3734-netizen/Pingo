/**
 * Which lines of a group thread the model gets to see.
 *
 * ## The bug this exists for
 *
 * The window was "the last forty lines", which in a one-to-one is the whole
 * conversation and in a shared group is whoever has been talking most.
 *
 * Measured on the live nine-person group, in the forty most recent lines the
 * assistant could read: nineteen were its own replies, eighteen were one
 * member, two were the person who had just asked it something, one was a third
 * member. So it answered with somebody else's conversation in its head and its
 * own asker almost absent - which is reported, correctly, as "it forgets what I
 * said".
 *
 * It was never forgetting. Their thread was two lines of a forty-line memory
 * that belonged to somebody else.
 *
 * ## What it does instead
 *
 * The recent window, plus a guaranteed number of the asker's own exchanges
 * wherever they happen to be, in the order they happened. Their turns come with
 * the reply that followed - a question without its answer is worse than
 * neither, because the assistant reads its own unanswered prompt and repeats
 * itself.
 *
 * ## Why indices and not messages
 *
 * The caller owns sanitising, truncating and the assistant/user roles. This
 * owns one decision - which lines survive - so it can be checked without a
 * model, a database or a Deno runtime. `pnpm verify:ai-context`.
 */

export interface WindowOptions {
  /** How many of the most recent lines are always kept. */
  recent?: number;
  /** How many of the asker's own turns to guarantee, reaching back if needed. */
  mineMin?: number;
}

/**
 * @param speakers One entry per history line: the speaker's name for a human in
 *   a group, `undefined` for the assistant and for every line in a one-to-one.
 * @param mine The asker's name, in a group. Omit outside a group - there is
 *   nobody else in the room to crowd them out.
 * @returns Indices into `speakers`, ascending, so order of events is preserved.
 */
export function windowIndices(
  speakers: (string | undefined)[],
  mine?: string,
  { recent = 40, mineMin = 8 }: WindowOptions = {},
): number[] {
  const keep = new Set<number>();
  const from = Math.max(0, speakers.length - recent);
  for (let i = from; i < speakers.length; i += 1) keep.add(i);

  if (mine) {
    let have = 0;
    for (let i = from; i < speakers.length; i += 1) {
      if (speakers[i] === mine) have += 1;
    }

    /*
     * Reaching back, newest first, so what is recovered is the tail of their
     * thread rather than the start of a conversation they have moved on from.
     */
    for (let i = from - 1; i >= 0 && have < mineMin; i -= 1) {
      if (speakers[i] !== mine) continue;
      keep.add(i);
      // The reply that followed, when there was one: pairs, or nothing.
      if (i + 1 < speakers.length && speakers[i + 1] === undefined) keep.add(i + 1);
      have += 1;
    }
  }

  return [...keep].sort((a, b) => a - b);
}
