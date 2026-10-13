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
 * Where a web answer came from, as Muse shows its Browser card: a tile and a
 * title, the pages on a white panel, and one pill to open the first of them.
 *
 * The data is `message.aiMeta?.sources` on a posted reply. Outside PINGO AI's
 * room (a group that tagged @pingoai) the room's colours fall back to the
 * app's surfaces.
 */
export function AiSources({ sources }: { sources: AiSource[] }) {
  if (!sources.length) return null;
  const shown = sources.slice(0, 3);
  const first = sources[0]!;
  return (
    <section
      aria-label="Sources"
      className="room-card mt-2 flex w-[min(100%,21rem)] flex-col gap-3.5"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[var(--room-tile,#dbe8ff)] text-[var(--room-tile-ink,#0a66e0)]">
          <Globe size={24} strokeWidth={1.9} />
        </span>
        <span className="min-w-0">
          <span className="block text-[17px] font-semibold leading-tight text-[var(--room-ink,var(--color-ink))]">Web search</span>
          <span className="block text-[15px] leading-tight text-[var(--room-sub,var(--color-text-secondary))]">
            Checked {sources.length} {sources.length === 1 ? 'site' : 'sites'}
          </span>
        </span>
      </div>

      <ul className="flex flex-col rounded-[18px] bg-[var(--room-panel,#fff)] px-3.5 py-1.5">
        {shown.map((s, i) => {
          const name = site(s.url);
          return (
            <li key={s.url} className={i > 0 ? 'border-t border-black/[0.06]' : undefined}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex items-center gap-3 py-2.5 text-left"
              >
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-[#eef1f6] text-[12px] font-bold uppercase text-[#3a4150]">
                  {name.charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold text-[#15171c]">{s.title || name}</span>
                  <span className="block truncate text-[12.5px] text-[#7a7f8c]">{name}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <a href={first.url} target="_blank" rel="noopener noreferrer nofollow" className="room-card-button">
        Open {site(first.url)}
      </a>
    </section>
  );
}
