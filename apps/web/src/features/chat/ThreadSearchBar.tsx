import type { Message } from '@pingo/core';
import { ChevronLeftIcon, CloseIcon, IconButton, SearchIcon, cn } from '@pingo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n/useT.js';
import { searchMatches, stepMatch } from './search-matches.js';

/**
 * What the thread header becomes while somebody is looking for a message.
 *
 * ## In place, not on top
 *
 * Same rule as the selection bar: you are still in this conversation, doing
 * something to part of it, so the header changes rather than a new layer
 * arriving over the thread you are searching.
 *
 * ## Newest first
 *
 * The first match offered is the most recent one, and Up walks backwards
 * through time. Somebody searching a chat is nearly always looking for
 * something said lately - the address, the time, the link from this morning -
 * and starting at the oldest match would make them press Down forty times to
 * get to it.
 *
 * ## What it can see
 *
 * Only history that is loaded. A thread pages older messages in as you scroll,
 * so a search run straight after opening a chat searches the recent window, and
 * the bar says so and offers to fetch more rather than reporting "no matches"
 * for something that is simply still on the server.
 *
 * ponytail: substring match over loaded messages. If threads get long enough
 * that paging to a match is painful, move the query to the service
 * (`body ilike`) and page directly to the hit.
 */

export interface ThreadSearchBarProps {
  messages: Message[];
  /** Scrolls a message into view and flashes it. */
  onJump: (messageId: string) => void;
  onClose: () => void;
  /** Whether the thread still has older messages on the server. */
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
}

export function ThreadSearchBar({
  messages,
  onJump,
  onClose,
  hasOlder,
  loadingOlder,
  onLoadOlder,
}: ThreadSearchBarProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const term = query.trim().toLowerCase();

  /** Newest first, so index 0 is the match nearest the bottom of the thread. */
  const matches = useMemo(() => searchMatches(messages, term), [messages, term]);

  // A new term starts at its own first match rather than wherever the last one
  // had got to.
  useEffect(() => setAt(0), [term]);

  const current = matches[at];
  useEffect(() => {
    // Deliberately keyed on the match alone: the thread re-renders constantly
    // and a new `onJump` identity must not yank the reader back.
    if (current) onJump(current);
  }, [current]);

  const step = (by: number) => setAt((index) => stepMatch(index, by, matches.length));

  return (
    <div className="flex items-center gap-1 px-1">
      <IconButton label={t('search.close')} onClick={onClose}>
        <CloseIcon size={20} />
      </IconButton>

      <span className="flex min-w-0 flex-1 items-center gap-2">
        <SearchIcon size={16} className="shrink-0 text-text-tertiary" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
            if (event.key === 'Escape') onClose();
          }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-body text-ink outline-none',
            'placeholder:text-text-tertiary',
          )}
        />
      </span>

      {term.length > 0 && (
        <>
          <span
            className="shrink-0 text-caption tabular-nums text-text-secondary"
            aria-live="polite"
          >
            {matches.length === 0
              ? t('search.none')
              : t('search.nOfTotal', { n: at + 1, total: matches.length })}
          </span>

          {/* No up/down glyphs in the set; the chevron turned is the same arrow. */}
          <IconButton
            label={t('search.previous')}
            size="sm"
            onClick={() => step(1)}
            {...(matches.length === 0 ? { disabled: true } : {})}
          >
            <ChevronLeftIcon size={18} className="rotate-90" />
          </IconButton>
          <IconButton
            label={t('search.next')}
            size="sm"
            onClick={() => step(-1)}
            {...(matches.length === 0 ? { disabled: true } : {})}
          >
            <ChevronLeftIcon size={18} className="-rotate-90" />
          </IconButton>

          {/*
            Offered whenever there is more history, not only when nothing
            matched: five hits in this month's messages says nothing about
            last year's.
          */}
          {hasOlder && (
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className={cn(
                'focus-ring shrink-0 rounded-full px-2.5 py-1 text-caption font-medium',
                'text-brand transition-colors duration-instant hover:bg-hover',
                'disabled:opacity-50',
              )}
            >
              {loadingOlder ? t('search.loadingOlder') : t('search.older')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
