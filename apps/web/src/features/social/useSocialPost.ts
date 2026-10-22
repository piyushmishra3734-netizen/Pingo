import type { SocialLink } from '@pingo/core';
import { useEffect, useState } from 'react';

import { publicAppUrl } from '../../lib/public-origin.js';

/** What `/api/social` returns. Pictures are already proxied addresses. */
export interface SocialMedia {
  kind: 'photo' | 'video' | 'gif';
  src: string;
  poster?: string;
  w?: number;
  h?: number;
}

export interface SocialPost {
  platform: 'x' | 'pinterest';
  url: string;
  author?: { name: string; handle?: string; avatar?: string; verified?: boolean; url?: string };
  text?: string;
  title?: string;
  createdAt?: string;
  stats?: { replies?: number; reposts?: number; likes?: number; views?: number };
  media: SocialMedia[];
  quote?: { author?: { name: string; handle?: string }; text?: string; media: SocialMedia[] };
}

/** Pictures come back as paths on this app, which an installed app has to point at the live site. */
export const assetUrl = (src: string): string => (src.startsWith('/api/') ? publicAppUrl(src) : src);

/**
 * One request per post per session, shared by every card showing it. The edge
 * and the browser's HTTP cache do the long-term remembering; this only stops a
 * re-render, or the same link twice in a thread, from asking again.
 */
const posts = new Map<string, Promise<SocialPost | null>>();

function endpoint(link: SocialLink): string {
  if (link.platform === 'x') return `/api/social?p=x&user=${encodeURIComponent(link.user ?? 'i')}&id=${link.id}`;
  return link.short ? `/api/social?p=pin&short=${link.id}` : `/api/social?p=pin&id=${link.id}`;
}

function load(link: SocialLink): Promise<SocialPost | null> {
  const key = link.canonicalUrl;
  const hit = posts.get(key);
  if (hit) return hit;
  const request = fetch(publicAppUrl(endpoint(link)))
    .then((res) => (res.ok ? (res.json() as Promise<SocialPost>) : null))
    .catch(() => null)
    .then((post) => {
      // A miss is not kept: it was usually a hiccup, and the card offers a retry by remounting.
      if (!post) posts.delete(key);
      return post;
    });
  posts.set(key, request);
  return request;
}

export function useSocialPost(link: SocialLink): { post: SocialPost | null | undefined } {
  const [post, setPost] = useState<SocialPost | null | undefined>();
  useEffect(() => {
    let live = true;
    setPost(undefined);
    void load(link).then((found) => {
      if (live) setPost(found);
    });
    return () => {
      live = false;
    };
  }, [link]);
  return { post };
}
