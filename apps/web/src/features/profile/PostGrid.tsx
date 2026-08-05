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
 * A profile with one post shows one picture and two open slots. Instagram
 * would show one picture and a lot of white. The open slots say what the
 * product allows - three, no more - and give the second and third posts an
 * obvious place to be added from. On somebody else's profile they are absent,
 * because how many slots they have left is not information about them.
 *
 * Empty slots use a soft glass surface rather than a dashed development box.
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
                'bg-backdrop/45 px-2 py-0.5 text-caption text-white backdrop-blur-glass',
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
            // Soft surface + thin border - not a dashed wireframe.
            'border border-line/55 bg-surface/80 text-text-tertiary shadow-sm',
            'transition-[border-color,color,background-color] duration-150 ease-standard',
            'hover:border-brand/35 hover:bg-selected hover:text-brand',
          )}
        >
          <PlusIcon size={20} />
        </button>
      ))}
    </div>
  );
}

/**
 * Own profile, zero posts: a premium create moment rather than three empty
 * squares that read as unfinished UI.
 */
export function OwnPostsEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className={cn(
        'focus-ring flex w-full flex-col items-center justify-center gap-3',
        'rounded-xl border border-line/50 bg-surface/90 px-6 py-12 text-center shadow-sm',
        'transition-[border-color,background-color,box-shadow] duration-150 ease-standard',
        'hover:border-brand/30 hover:bg-selected/60 hover:shadow-md',
      )}
    >
      <span
        className={cn(
          'grid size-12 place-items-center rounded-full',
          'bg-brand/10 text-brand ring-1 ring-brand/15',
        )}
        aria-hidden
      >
        <PlusIcon size={22} />
      </span>
      <span className="space-y-1">
        <span className="block text-body font-medium text-ink">Create your first post</span>
        <span className="block text-caption text-text-tertiary">
          A PINGO profile holds three. Start with one.
        </span>
      </span>
    </button>
  );
}

/** Nothing posted, and nowhere for open slots to help - someone else's. */
export function PostsEmpty({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-line/40 bg-surface px-6 py-14 text-center shadow-sm">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-sunken text-text-tertiary">
        <ImageIcon size={26} />
      </span>
      <p className="mt-4 text-body font-medium text-ink">{name} hasn{"'"}t posted yet.</p>
      <p className="mt-1.5 text-caption text-text-tertiary">
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
