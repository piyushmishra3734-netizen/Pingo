/**
 * Finding links inside something somebody typed.
 *
 * The hard part is not spotting `https://` - it is deciding where the link
 * stops. People end sentences with links, wrap them in brackets, and put them
 * next to emoji, so the naive "everything up to whitespace" answer routinely
 * swallows a full stop and turns a valid id into an invalid one. That failure
 * is quiet: the URL still parses, the id just fails its character check and no
 * card appears, which reads as the feature not working rather than as a parsing
 * bug.
 */

/**
 * Everything up to whitespace or a character that cannot appear in a URL.
 *
 * `<>"'` are excluded outright - they terminate a URL in every context that
 * matters and are the ones that would matter for injection if this text ever
 * reached markup. Trailing punctuation is dealt with separately, below, because
 * it *can* legally appear inside a URL and only looks like punctuation at the
 * end.
 */
const LINK = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/** Sentence punctuation, which a URL may contain but rarely ends with. */
const TRAILING = /[.,!?;:'"]+$/;

/**
 * Hosts we will consider at all.
 *
 * Detection is deliberately not filtered by this - `findLinks` returns
 * everything, and it is the provider registry that decides what is a video.
 * Keeping the allowlist in one place, next to the providers that own each host,
 * is what stops a second half-maintained copy drifting out of agreement with
 * the first.
 */

export function findLinks(text: string): URL[] {
  const found: URL[] = [];

  for (const match of text.matchAll(LINK)) {
    const url = tidy(match[0]);
    if (url) found.push(url);
  }

  return found;
}

function tidy(raw: string): URL | undefined {
  let candidate = raw.replace(TRAILING, '');

  /*
   * A closing bracket only ends the URL if nothing opened it inside the URL.
   *
   * "(see https://youtu.be/abc)" must lose its bracket, while a link that
   * genuinely contains a balanced pair - Wikipedia titles do this constantly -
   * must keep it. Counting is the only way to tell the two apart.
   */
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ] as const) {
    while (candidate.endsWith(close)) {
      const opens = candidate.split(open).length - 1;
      const closes = candidate.split(close).length - 1;
      if (opens >= closes) break;
      candidate = candidate.slice(0, -1);
    }
  }

  // Re-run: stripping a bracket can expose the full stop it was hiding.
  candidate = candidate.replace(TRAILING, '');

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }

  /*
   * https only, and http upgraded rather than rejected.
   *
   * The scheme in the message decides nothing: whether this URL is ever
   * *touched* is decided by the provider registry, and a provider only ever
   * requests an address it built itself out of a validated id. So an upgrade
   * here cannot widen what we talk to - it only means somebody who pasted an
   * old `http://youtu.be/...` link still gets a card. Every other scheme
   * (`javascript:`, `data:`, `file:`) is refused outright.
   */
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return undefined;

  return url;
}
