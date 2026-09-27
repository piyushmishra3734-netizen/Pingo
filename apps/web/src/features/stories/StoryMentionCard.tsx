import { cn } from '@pingo/ui';
import { CirclePlus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { StoryEditor } from './StoryEditor.js';
import { useStories } from './StoryContext.js';
import type { StoryMention } from './story-mentions.js';

/**
 * "Mentioned you in their story", in the chat - Instagram's card.
 *
 * The story is found in the reader's own tray by id, so the picture is always
 * a fresh one and a story that has run out says so. The person mentioned can
 * add it to their own story; it opens in the editor, and once posted the
 * viewer credits the original under their name.
 */
export function StoryMentionCard({ mention, mine, otherName }: { mention: StoryMention; mine: boolean; otherName: string }) {
  const { groups, mine: myGroup, upload } = useStories();
  const found = useMemo(() => {
    const pool = mine ? (myGroup ? [myGroup] : []) : groups;
    for (const group of pool) {
      const story = group.stories.find((s) => s.id === mention.storyId);
      if (story) return { story, group };
    }
    return undefined;
  }, [groups, myGroup, mine, mention.storyId]);

  const [editing, setEditing] = useState<{ src: string; kind: 'photo' | 'video'; media: Blob }>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const addToStory = async () => {
    if (!found) return;
    setBusy(true);
    setFailed(false);
    try {
      const blob = await (await fetch(found.story.mediaUrl)).blob();
      setEditing({ src: URL.createObjectURL(blob), kind: found.story.kind, media: blob });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const author = found?.group.authorUsername ?? found?.group.authorName ?? otherName;

  return (
    <div className={cn('flex flex-col gap-1.5', mine ? 'items-end' : 'items-start')}>
      <p className="px-1 text-caption text-text-tertiary">
        {mine ? 'Mentioned in your story' : 'Mentioned you in their story'}
      </p>
      <div className="relative h-[240px] w-[135px] overflow-hidden rounded-[16px] bg-sunken ring-1 ring-line">
        {found ? (
          found.story.kind === 'photo' ? (
            <img src={found.story.mediaUrl} alt={`${author}'s story`} className="size-full object-cover" draggable={false} />
          ) : (
            <video src={`${found.story.mediaUrl}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
          )
        ) : (
          <span className="grid size-full place-items-center px-3 text-center text-caption text-text-tertiary">Story unavailable</span>
        )}
        {found && (
          <span className="absolute inset-x-0 top-0 flex items-center gap-1.5 bg-gradient-to-b from-black/50 to-transparent p-2 text-[11px] font-semibold text-white">
            {found.group.authorAvatarUrl && <img src={found.group.authorAvatarUrl} alt="" className="size-5 rounded-full object-cover" />}
            <span className="truncate">{author}</span>
          </span>
        )}
      </div>
      {!mine && found && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void addToStory()}
          className="focus-ring flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-2 text-caption font-semibold text-ink shadow-sm ring-1 ring-line active:bg-hover disabled:opacity-60"
        >
          <CirclePlus size={15} className="text-brand" />
          {busy ? 'Opening…' : failed ? 'Try again' : 'Add to your story'}
        </button>
      )}
      {editing && found && (
        <StoryEditor
          src={editing.src}
          kind={editing.kind}
          media={editing.media}
          from={{ id: mention.authorId, name: author }}
          onClose={() => { URL.revokeObjectURL(editing.src); setEditing(undefined); }}
          onPost={async (draft, from) => {
            upload(draft, from);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
