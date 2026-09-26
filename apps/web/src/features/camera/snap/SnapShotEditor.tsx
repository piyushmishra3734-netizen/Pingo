import type { StoryDraft } from '@pingo/core';
import { useEffect, useMemo } from 'react';

import { StoryEditor } from '../../stories/StoryEditor.js';
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
  onPost: (draft: StoryDraft) => Promise<void>;
}) {
  const src = useMemo(() => URL.createObjectURL(shot.blob), [shot.blob]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);
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
      onPost={async (draft) => { await onPost(draft); onDone(); }}
    />
  );
}
