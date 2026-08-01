import type { Post } from '@pingo/core';
import { HeartIcon, ImageIcon, PlusIcon, Skeleton, cn } from '@pingo/ui';

/**
 * Three posts, in a row of squares.
 *
 * A three-column grid holding at most three posts is a single row, which is the
 * whole point: a PINGO profile shows everything it has without scrolling. The
 * grid is still a grid rather than a flex row so the tiles keep their squares
 * when there are one or two, instead of stretching to fill the width.
 *
 * ## Why the empty slots are visible on your own profile
 *
 * A profile with one post shows one picture and two dashed squares. Instagram
 * would show one picture and a lot of white. The dashed squares say what the
 * product allows - three, no more - and give the second and third posts an
 * obvious place to be added from. On somebody else's profile they are absent,
 * because how many slots they have left is not information about them.
 */

export function PostGrid({
  posts,
  isSelf,
  onOpen,
  onAdd,
}: {
  posts: Post[];
  isSelf: boolean;
  onOpen: (post: Post) => void;
  /** Absent on someone else's profile. */
  onAdd?: () => void;
}) {
  const empties = isSelf ? Math.max(0, 3 - posts.length) : 0;

  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2">
      {posts.map((post, index) => (
        <button
          key={post.id}
          type="button"
          onClick={() => onOpen(post)}
          aria-label={post.caption ? `Post: ${post.caption}` : `Post ${index + 1}`}
          className={cn(
            'group focus-ring relative aspect-square overflow-hidden rounded-lg bg-hover',
            'transition-transform duration-quick ease-standard active:scale-[0.98]',
          )}
        >
          <img
            src={post.imageUrl}
            alt=""
            loading="lazy"
            // `decoding=async` keeps a slow decode off the main thread, which is
            // what stops the row of three from janking as it appears.
            decoding="async"
            className="size-full object-cover"
          />

          {post.likeCount > 0 && (
            <span
              className={cn(
                'absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-full',
                'bg-ink/45 px-2 py-0.5 text-caption text-white backdrop-blur-glass',
              )}
            >
              <HeartIcon size={12} fill={post.likedByMe ? 'currentColor' : 'none'} />
              {post.likeCount}
            </span>
          )}
        </button>
      ))}

      {Array.from({ length: empties }, (_, index) => (
        <button
          key={`empty-${index}`}
          type="button"
          onClick={onAdd}
          aria-label="Add a post"
          className={cn(
            'focus-ring grid aspect-square place-items-center rounded-lg',
            'border-2 border-dashed border-line text-text-tertiary',
            'transition-colors duration-instant hover:border-brand hover:text-brand',
          )}
        >
          <PlusIcon size={22} />
        </button>
      ))}
    </div>
  );
}

/** Nothing posted, and nowhere for a dashed square to help - someone else's. */
export function PostsEmpty({ name }: { name: string }) {
  return (
    <div className="rounded-lg bg-surface px-6 py-14 text-center shadow-sm">
      <ImageIcon size={28} className="mx-auto text-text-tertiary" />
      <p className="mt-3 text-body text-text-secondary">{name} hasn't posted yet.</p>
      <p className="mt-1 text-caption text-text-tertiary/90">
        A PINGO profile holds three posts. Theirs are still to come.
      </p>
    </div>
  );
}

export function PostGridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2" role="status" aria-label="Loading posts">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </div>
  );
}
