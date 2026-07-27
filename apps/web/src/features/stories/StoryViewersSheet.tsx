import type { Story, StoryInsights, StoryViewer } from '@pingo/core';
import { Avatar, HeartIcon, cn } from '@pingo/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Sheet, SheetCancel } from '../../components/Sheet.js';
import { useStories } from './StoryContext.js';

/**
 * Who watched your story.
 *
 * Owner only, and enforced by `story_viewers()` rather than by this component —
 * asking for somebody else's story returns nothing, so a reader of this file
 * cannot accidentally make it leak by changing a condition.
 *
 * ## Three numbers and a list, and nothing else
 *
 * Views, likes, replies. No reach, no retention, no completion rate, no chart.
 * A story is a thing you posted this morning and will have forgotten by
 * tomorrow; a dashboard would turn it into something to optimise, which is the
 * one thing this product has decided not to be.
 *
 * Replies are counted but not listed. They are private messages sitting in
 * threads — showing them here would be a second inbox with different rules, and
 * the thread is where an answer belongs.
 */

export function StoryViewersSheet({ story, onClose }: { story: Story; onClose: () => void }) {
  const { service } = useStories();

  const [viewers, setViewers] = useState<StoryViewer[]>();
  const [insights, setInsights] = useState<StoryInsights>();

  useEffect(() => {
    let active = true;

    void service
      .listViewers(story.id)
      .then((list) => { if (active) setViewers(list); })
      .catch(() => { if (active) setViewers([]); });

    void service
      .insights(story.id)
      .then((next) => { if (active) setInsights(next); })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [service, story.id]);

  return (
    <Sheet title="Story insights" description="Only you can see this." onClose={onClose} elevated>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Views" value={insights?.views} />
        <Stat label="Likes" value={insights?.likes} />
        <Stat label="Replies" value={insights?.replies} />
      </dl>

      <div className="mt-4">
        {!viewers ? (
          <p className="py-6 text-center text-caption text-text-tertiary">Loading…</p>
        ) : viewers.length === 0 ? (
          <p className="py-6 text-center text-caption text-text-tertiary">
            Nobody has watched this yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {viewers.map((viewer) => (
              <li key={viewer.userId}>
                <Link
                  to={`/profile/${viewer.username}`}
                  onClick={onClose}
                  className={cn(
                    'focus-ring flex items-center gap-3 rounded-lg px-2 py-2',
                    'transition-colors duration-instant hover:bg-hover',
                  )}
                >
                  <Avatar
                    name={viewer.displayName}
                    id={viewer.userId}
                    src={viewer.avatarUrl}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{viewer.displayName}</span>
                    <span className="block truncate text-caption text-text-secondary">
                      @{viewer.username}
                    </span>
                  </span>
                  {viewer.liked && (
                    <HeartIcon
                      size={16}
                      fill="currentColor"
                      className="shrink-0 text-danger"
                      title="Liked this story"
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2">
        <SheetCancel onClick={onClose} label="Done" />
      </div>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg bg-hover px-3 py-2.5 text-center">
      <dt className="sr-only">{label}</dt>
      <dd className="text-h2 font-semibold text-ink tabular-nums">
        {value === undefined ? <span className="text-text-tertiary">—</span> : value}
      </dd>
      <p aria-hidden className="text-caption text-text-secondary">
        {label}
      </p>
    </div>
  );
}
