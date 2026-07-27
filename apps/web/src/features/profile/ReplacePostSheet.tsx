import type { Post } from '@pingo/core';
import { cn } from '@pingo/ui';

import { Sheet, SheetCancel } from '../../components/Sheet.js';

/**
 * The fourth post.
 *
 * PINGO holds three, permanently, and this is the moment that rule is met. It
 * is a choice rather than a refusal: "you already have three" and a dead end
 * would be the easy version and the useless one, because the person is standing
 * there with a picture they want up.
 *
 * So the three existing posts are shown as they are, and picking one says which
 * goes. Nothing is deleted until the new picture has been through the editor and
 * uploaded — `replacePost` swaps the image on the chosen row rather than
 * deleting and re-creating, so a failed upload cannot leave a profile with two.
 */

export function ReplacePostSheet({
  posts,
  onCancel,
  onChoose,
}: {
  posts: Post[];
  onCancel: () => void;
  onChoose: (post: Post) => void;
}) {
  return (
    <Sheet
      title="Replace a post"
      description="A profile holds three. Choose which one the new picture takes the place of."
      onClose={onCancel}
    >
      <div className="mt-4 grid grid-cols-3 gap-2">
        {posts.map((post, index) => (
          <button
            key={post.id}
            type="button"
            onClick={() => onChoose(post)}
            aria-label={
              post.caption ? `Replace post: ${post.caption}` : `Replace post ${index + 1}`
            }
            className={cn(
              'focus-ring relative aspect-square overflow-hidden rounded-lg',
              'ring-2 ring-transparent transition-[box-shadow,transform] duration-instant',
              'hover:ring-brand active:scale-[0.98]',
            )}
          >
            <img src={post.imageUrl} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>

      <div className="mt-3">
        <SheetCancel onClick={onCancel} />
      </div>
    </Sheet>
  );
}
