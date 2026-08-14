import { LinkIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';

import { publicAppUrl } from '../../lib/public-origin.js';

/**
 * A link, drawn as what it points at.
 *
 * ## Who fetches the page
 *
 * Not this. `/api/unfurl` reads the page from the edge and returns the title,
 * so a link sent to a group does not hand the site the IP address of everyone
 * in it. Same bargain `VideoLinkCard` makes about embeds, for the same reason.
 *
 * ## No picture
 *
 * The endpoint does not return `og:image` and this card would not use it if it
 * did: loading the image would put the reader's browser back on the site's
 * server, which is the leak the endpoint exists to avoid. Title, site and host
 * are what make a link legible before you tap it.
 *
 * ## Nothing is cached here
 *
 * The response carries a day of `Cache-Control`, so the browser's own HTTP
 * cache does this job. A second store in `localStorage` would be a second copy
 * to invalidate and would answer the same question more slowly.
 *
 * ponytail: one in-flight request per URL per session, deduped by the map
 * below. If threads full of the same link start costing renders, the answer is
 * a real store, not a bigger map.
 */

interface Unfurled {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
}

/** Answers already in hand this session, so a re-render never refetches. */
const seen = new Map<string, Unfurled>();

async function unfurl(href: string): Promise<Unfurled | undefined> {
  const already = seen.get(href);
  if (already) return already;
  try {
    const response = await fetch(publicAppUrl(`/api/unfurl?url=${encodeURIComponent(href)}`));
    if (!response.ok) return undefined;
    const body = (await response.json()) as Unfurled;
    seen.set(href, body);
    return body;
  } catch {
    return undefined;
  }
}

export interface LinkPreviewCardProps {
  href: string;
  mine: boolean;
  /** Extra bottom margin when text follows. */
  spaced?: boolean;
}

export function LinkPreviewCard({ href, mine, spaced }: LinkPreviewCardProps) {
  const [found, setFound] = useState<Unfurled | undefined>(() => seen.get(href));

  useEffect(() => {
    if (seen.has(href)) {
      setFound(seen.get(href));
      return;
    }
    let live = true;
    void unfurl(href).then((result) => {
      if (live) setFound(result);
    });
    return () => {
      live = false;
    };
  }, [href]);

  /*
   * Nothing at all until there is something to say.
   *
   * No skeleton: a card that appears a second after the message arrives pushes
   * the thread down under the reader's thumb, and a placeholder that resolves
   * to "this site told us nothing" would have moved the conversation twice for
   * no information. A link with no title stays the link it already was in the
   * text below.
   */
  if (!found?.title) return null;

  let host = '';
  try {
    host = new URL(found.url).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }

  return (
    <a
      href={found.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        'focus-ring mb-1 flex flex-col gap-0.5 rounded-lg border-l-2 px-2.5 py-1.5',
        'transition-colors duration-instant',
        mine
          ? 'border-white/50 bg-white/12 hover:bg-white/18'
          : 'border-brand bg-surface-2 hover:bg-hover',
        spaced && 'mb-1.5',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1 text-caption',
          mine ? 'text-white/70' : 'text-text-tertiary',
        )}
      >
        <LinkIcon size={11} />
        <span className="truncate">{found.siteName || host}</span>
      </span>

      <span
        className={cn(
          'line-clamp-2 text-caption font-medium',
          mine ? 'text-white' : 'text-ink',
        )}
      >
        {found.title}
      </span>

      {found.description && (
        <span
          className={cn(
            'line-clamp-2 text-caption',
            mine ? 'text-white/75' : 'text-text-secondary',
          )}
        >
          {found.description}
        </span>
      )}
    </a>
  );
}
