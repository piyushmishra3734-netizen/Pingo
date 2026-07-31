/**
 * Finding links inside a message.
 *
 * A product rule rather than a rendering one, which is why it lives here: what
 * counts as a link decides what a message *means*, and web and native have to
 * agree about it.
 *
 * ## Why not "anything with a dot in it"
 *
 * The tempting regex matches any `word.word`, and then every `file.txt`,
 * `script.js`, `v1.2.3`, `e.g.` and `Node.js` in the app becomes a broken blue
 * link. In a chat that is constant: people talk about filenames far more often
 * than they type bare domains.
 *
 * So three things are linked and nothing else:
 *
 *   1. Anything with an explicit `http://` or `https://` - unambiguous.
 *   2. Anything starting `www.` - unambiguous by convention.
 *   3. A bare domain whose suffix is in `COMMON_TLDS` below.
 *
 * The third is the compromise. People do type `pingochat.pages.dev` with no
 * scheme and expect it to work, and a curated list gets that without turning
 * `notes.txt` into a hyperlink. It is deliberately short: a missed link is a
 * copy-paste, a wrong one is a message that reads as broken.
 *
 * ## Only `http` and `https` are ever produced
 *
 * `javascript:`, `data:` and friends are not matched by any branch, and a bare
 * domain is prefixed with `https://` rather than passed through - so nothing
 * here can produce a URL scheme that executes.
 */

export interface TextSegment {
  kind: 'text';
  value: string;
}

export interface LinkSegment {
  kind: 'link';
  /** As typed, so the message still reads the way it was written. */
  value: string;
  /** Always absolute and always http(s) - safe to put in an `href`. */
  href: string;
}

export type MessageSegment = TextSegment | LinkSegment;

/**
 * Suffixes a bare domain may end in to be treated as a link.
 *
 * Short on purpose. Every entry here is a string that people type meaning "a
 * website" far more often than they type it meaning anything else - which is
 * why `js`, `txt`, `md`, `sh` and `py` are absent despite being real TLDs or
 * looking like them.
 */
const COMMON_TLDS = [
  'com', 'net', 'org', 'edu', 'gov', 'int',
  'io', 'ai', 'app', 'dev', 'me', 'co', 'xyz', 'tech', 'online', 'site',
  'in', 'uk', 'us', 'ca', 'au', 'de', 'fr', 'nl', 'es', 'it', 'br', 'jp', 'cn',
];

/**
 * One pass, three alternatives, in order of confidence.
 *
 * The bare-domain branch requires the TLD to be followed by a boundary - a
 * slash, a query, or the end of the token - so `example.com` matches and
 * `example.community` does not match as `example.com` + `munity`.
 */
const LINK = new RegExp(
  [
    /*
     * 1. Email, and it has to come first.
     *
     * Otherwise the bare-domain branch matches the half after the `@` and
     * `write to me@example.com` turns into a link to example.com - a message
     * that looks helpful and sends the reader somewhere they did not ask to go.
     */
    '[a-z0-9._%+-]+@[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}',
    // 2. Explicit scheme.
    'https?://[^\\s<>"]+',
    // 3. www., no scheme.
    'www\\.[^\\s<>"]+',
    // 4. Bare domain with a known suffix.
    `(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${COMMON_TLDS.join('|')})(?![a-z])(?:[/?#][^\\s<>"]*)?`,
  ].join('|'),
  'gi',
);

/** An address rather than a location - the only thing that gets `mailto:`. */
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

/**
 * Punctuation that commonly ends a sentence rather than a URL.
 *
 * "Have a look at example.com." should link `example.com`, not `example.com.`.
 * Closing brackets are trimmed only when unbalanced, because plenty of real
 * URLs - Wikipedia's especially - legitimately contain them.
 */
function trimTrailing(match: string): string {
  let end = match.length;

  while (end > 0) {
    const char = match[end - 1]!;
    if ('.,;:!?'.includes(char)) {
      end -= 1;
      continue;
    }
    if (char === ')' || char === ']') {
      const open = char === ')' ? '(' : '[';
      const segment = match.slice(0, end);
      const opens = segment.split(open).length - 1;
      const closes = segment.split(char).length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }

  return match.slice(0, end);
}

/**
 * Splits a message into plain runs and links.
 *
 * Returns a single text segment when there is nothing to link, so a caller can
 * render the common case without a special path.
 */
export function linkify(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK)) {
    const raw = match[0];
    const start = match.index;
    const value = trimTrailing(raw);

    // Entirely punctuation after trimming - not a link at all.
    if (!value) continue;

    if (start > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, start) });
    }

    segments.push({
      kind: 'link',
      value,
      href: EMAIL.test(value)
        ? `mailto:${value}`
        : // A bare domain gets a scheme so the browser does not read it as a
          // relative path off the current page.
          /^https?:\/\//i.test(value)
          ? value
          : `https://${value}`,
    });

    cursor = start + value.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', value: text.slice(cursor) });
  }

  return segments;
}

/** Whether a message contains anything worth linking. */
export function hasLink(text: string): boolean {
  return linkify(text).some((segment) => segment.kind === 'link');
}
