/**
 * Document head helpers for public marketing pages.
 *
 * Only mutates title, description, canonical, Open Graph, and Twitter tags.
 * Restores prior values on cleanup so in-app navigation does not leave a
 * marketing title on a private screen.
 */

export interface PageSeo {
  title: string;
  description: string;
  /** Path only, e.g. `/download`. Origin is taken from the current host. */
  path: string;
  /** Open Graph type. Defaults to `website`. */
  type?: 'website' | 'article';
}

const META = {
  description: 'meta[name="description"]',
  ogTitle: 'meta[property="og:title"]',
  ogDescription: 'meta[property="og:description"]',
  ogUrl: 'meta[property="og:url"]',
  ogType: 'meta[property="og:type"]',
  twitterTitle: 'meta[name="twitter:title"]',
  twitterDescription: 'meta[name="twitter:description"]',
  twitterUrl: 'meta[name="twitter:url"]',
} as const;

function setMeta(selector: string, attr: 'content' | 'href', value: string): string {
  const el = document.querySelector(selector);
  if (!el) return '';
  const previous = el.getAttribute(attr) ?? '';
  el.setAttribute(attr, value);
  return previous;
}

/**
 * Apply page-level SEO tags and return a restore function for unmount.
 */
export function applyPageSeo(page: PageSeo): () => void {
  const url = `${window.location.origin}${page.path}`;
  const type = page.type ?? 'website';

  const previous = {
    title: document.title,
    description: setMeta(META.description, 'content', page.description),
    ogTitle: setMeta(META.ogTitle, 'content', page.title),
    ogDescription: setMeta(META.ogDescription, 'content', page.description),
    ogUrl: setMeta(META.ogUrl, 'content', url),
    ogType: setMeta(META.ogType, 'content', type),
    twitterTitle: setMeta(META.twitterTitle, 'content', page.title),
    twitterDescription: setMeta(META.twitterDescription, 'content', page.description),
    twitterUrl: setMeta(META.twitterUrl, 'content', url),
    canonical: setMeta('link[rel="canonical"]', 'href', url),
  };

  document.title = page.title;

  return () => {
    document.title = previous.title;
    setMeta(META.description, 'content', previous.description);
    setMeta(META.ogTitle, 'content', previous.ogTitle);
    setMeta(META.ogDescription, 'content', previous.ogDescription);
    setMeta(META.ogUrl, 'content', previous.ogUrl);
    setMeta(META.ogType, 'content', previous.ogType);
    setMeta(META.twitterTitle, 'content', previous.twitterTitle);
    setMeta(META.twitterDescription, 'content', previous.twitterDescription);
    setMeta(META.twitterUrl, 'content', previous.twitterUrl);
    setMeta('link[rel="canonical"]', 'href', previous.canonical);
  };
}
