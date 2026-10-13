import type { AiSource } from '@pingo/core';
import { Globe } from 'lucide-react';

/** "www.imd.gov.in/x" -> "imd.gov.in". */
function site(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The web pages a PINGO AI reply cited, as small chips under the reply: the
 * site's initial, then its name. The data is `message.aiMeta?.sources` on a
 * posted reply, and `useAiDraftSources(conversationId)` while it is written.
 */
export function AiSources({ sources }: { sources: AiSource[] }) {
  if (!sources.length) return null;
  const shown = sources.slice(0, 4);
  const more = sources.length - shown.length;
  return (
    <nav aria-label="Sources" className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Globe size={14} className="mr-0.5 shrink-0 text-text-tertiary" aria-hidden />
      {shown.map((s) => {
        const name = site(s.url);
        return (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={s.title || s.url}
            className="flex max-w-[11rem] items-center gap-1.5 rounded-full bg-ink/[0.06] py-1 pl-1 pr-2.5 text-[12.5px] font-semibold text-text-secondary active:bg-ink/10"
          >
            <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-full bg-surface text-[9px] font-bold uppercase text-ink">
              {name.charAt(0)}
            </span>
            <span className="truncate">{name}</span>
          </a>
        );
      })}
      {more > 0 && <span className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-[12.5px] font-semibold text-text-tertiary">+{more}</span>}
    </nav>
  );
}
