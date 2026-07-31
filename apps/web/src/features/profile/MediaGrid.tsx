import type { ChatMediaItem } from '@pingo/core';
import { ImageIcon, LockIcon, Skeleton, cn } from '@pingo/ui';
import { useNavigate } from 'react-router-dom';

/**
 * The Media tab: pictures out of your own conversations.
 *
 * ## Why it is private, and why that is said out loud
 *
 * These are photos from chats. Some of them were sent to one person. A grid of
 * them on a page that also has a public half is exactly the kind of surface
 * where somebody assumes the wrong thing and shares their screen - so the tab
 * carries a lock and a line of text saying only you can see it. The enforcement
 * is row level security on `messages`; the label is so nobody has to trust that
 * without being told.
 *
 * ## Why tapping one opens the conversation
 *
 * A picture out of context is half the thing you were looking for. The useful
 * action is almost always "where was this and who was I talking to", and that is
 * one tap away rather than a viewer you then have to back out of.
 *
 * View-once photos are absent by construction - the service never lists them.
 */

export function MediaGrid({ items }: { items: ChatMediaItem[] }) {
  const navigate = useNavigate();

  return (
    <>
      <p className="mb-3 flex items-center justify-center gap-1.5 text-caption text-text-tertiary">
        <LockIcon size={13} />
        Only you can see this
      </p>

      <div className="grid grid-cols-3 gap-1 sm:gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(`/chats/${item.conversationId}`)}
            aria-label={`${item.mine ? 'Photo you sent' : 'Photo you received'} on ${new Date(
              item.createdAt,
            ).toLocaleDateString()} - open the conversation`}
            className={cn(
              'focus-ring relative aspect-square overflow-hidden rounded-lg bg-hover',
              'transition-transform duration-quick ease-standard active:scale-[0.98]',
            )}
          >
            <img
              src={item.url}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          </button>
        ))}
      </div>
    </>
  );
}

export function MediaEmpty() {
  return (
    <div className="rounded-lg bg-surface px-6 py-14 text-center shadow-sm">
      <ImageIcon size={26} className="mx-auto text-text-tertiary" />
      <p className="mt-3 text-body text-text-secondary">No photos from your chats yet.</p>
      <p className="mt-1 text-caption text-text-tertiary">
        Pictures you send and receive collect here, for you alone.
      </p>
    </div>
  );
}

export function MediaSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2" role="status" aria-label="Loading media">
      {Array.from({ length: 9 }, (_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </div>
  );
}
