import type { StoryDraft } from '@pingo/core';
import { useEffect, useState } from 'react';

import { StoryEditor } from '../../stories/StoryEditor.js';
import type { StoryFrom } from '../../stories/StoryUpload.js';
import type { SnapShot } from './SnapCamera.js';

/**
 * What the Snap camera took, opened in the story editor.
 *
 * The song chosen in the camera comes along as its sticker and its sound; the
 * editor's Send to makes chats Pings with a view limit.
 */
export function SnapShotEditor({ shot, lockedChatId, onDone, onPost }: {
  shot: SnapShot;
  lockedChatId?: string;
  onDone: () => void;
  onPost: (draft: StoryDraft, from?: StoryFrom) => Promise<void>;
}) {
  /*
   * Made and let go by the same effect.
   *
   * It was made in a memo and revoked in an effect's cleanup, and React runs
   * effects twice when checking a component in development: the cleanup
   * revoked the address, the memo kept handing out the dead one, and the video
   * failed to load. Owning both ends in one effect cannot come apart.
   */
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    const url = URL.createObjectURL(shot.blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [shot.blob]);
  if (!src) return null;
  return (
    <StoryEditor
      src={src}
      kind={shot.kind}
      media={shot.blob}
      {...(shot.song ? {
        initialSong: shot.song,
        initialStickers: [{ id: 'song', type: 'music' as const, x: 0.5, y: 0.72, s: 1, r: 0, d: { name: shot.song.name, artist: shot.song.artist, img: shot.song.img } }],
      } : {})}
      ping={lockedChatId ? { lockedChatId } : {}}
      onClose={onDone}
      onPost={async (draft, from) => { await onPost(draft, from); onDone(); }}
    />
  );
}
