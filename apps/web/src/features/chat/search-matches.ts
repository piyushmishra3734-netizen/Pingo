/**
 * Which messages a search term hits, newest first.
 *
 * Its own module so it can be asserted without a browser: the bar around it is
 * an input and two arrows, and this is the part that can be wrong.
 *
 * Newest first is the whole ordering decision. Threads arrive oldest-first
 * because that is how they are read, and matches are walked in the other
 * direction because somebody searching a chat is looking for something said
 * recently far more often than for something said the first week.
 */

export interface Searchable {
  id: string;
  body: string;
}

/** Ids of every message containing `term`, most recent first. Empty for a blank term. */
export function searchMatches(messages: readonly Searchable[], term: string): string[] {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return [];
  const hits: string[] = [];
  for (const message of messages) {
    if (message.body.toLowerCase().includes(needle)) hits.unshift(message.id);
  }
  return hits;
}

/**
 * The match `by` steps away, wrapping at both ends.
 *
 * Wrapping rather than stopping: the count beside the arrows already says
 * where you are, and a dead button at the last match makes somebody who wants
 * the first one close the search and start again.
 */
export function stepMatch(at: number, by: number, total: number): number {
  if (total <= 0) return 0;
  return (((at + by) % total) + total) % total;
}
