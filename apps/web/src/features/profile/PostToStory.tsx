import type { Post, Profile, StoryDraft, StorySticker } from '@pingo/core';
import { useEffect, useMemo, useState } from 'react';

import { StoryEditor } from '../stories/StoryEditor.js';
import type { StoryFrom } from '../stories/StoryUpload.js';

/** Where a shared post sits before anybody moves it, Instagram's spot. */
const CARD: Omit<StorySticker, 'd'> = { id: 'post', type: 'post', x: 0.5, y: 0.46, s: 1.15, r: 0 };
const SOFT = 'linear-gradient(160deg,#3a3a40,#1c1c1e)';

/**
 * Share → Add to story on a profile post: the story editor, with the post as a
 * card on the photo's own colours.
 *
 * It opens at once on a soft default and the colours arrive a moment later,
 * rather than holding the tap while the picture is read.
 */
export function PostToStory({ post, author, audience, onClose, onPost }: {
  post: Post;
  author: Profile;
  /** Close friends from the share sheet sends there whichever button is used. */
  audience: 'friends' | 'close';
  onClose: () => void;
  onPost: (draft: StoryDraft, from?: StoryFrom) => void;
}) {
  const [bg, setBg] = useState(SOFT);
  useEffect(() => { let live = true; void dominant(post.imageUrl).then((c) => { if (live && c) setBg(c); }); return () => { live = false; }; }, [post.imageUrl]);

  const stickers = useMemo<StorySticker[]>(() => [{
    ...CARD,
    d: {
      src: post.imageUrl, user: author.username, avatar: author.avatarUrl ?? '',
      // The picture's URL is signed and short-lived; these let a viewer fetch a fresh one.
      postId: post.id, authorId: author.id,
    },
  }], [post, author]);
  const media = useMemo(() => new Blob([], { type: 'image/jpeg' }), []);

  return (
    <StoryEditor
      src={post.imageUrl}
      kind="photo"
      media={media}
      bg={bg}
      initialStickers={stickers}
      onClose={onClose}
      onPost={async (draft, from) => onPost(audience === 'close' ? { ...draft, audience: 'close' } : draft, from)}
    />
  );
}

/** Instagram backs a shared post with the photo's own colours. */
async function dominant(src: string): Promise<string | undefined> {
  try {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = 2; c.height = 2; const g = c.getContext('2d')!; g.drawImage(img, 0, 0, 2, 2);
    const a = g.getImageData(0, 0, 1, 1).data, b = g.getImageData(1, 1, 1, 1).data;
    return `linear-gradient(160deg, rgb(${a[0]},${a[1]},${a[2]}), rgb(${(b[0]! * 0.6) | 0},${(b[1]! * 0.6) | 0},${(b[2]! * 0.6) | 0}))`;
  } catch {
    return 'linear-gradient(160deg,#8b5dff,#e0559b)';
  }
}
