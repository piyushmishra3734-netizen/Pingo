import type { Story, StoryDraft, StoryGroup, StorySticker } from '@pingo/core';
import { useMemo, useState } from 'react';

import { StoryEditor } from '../../features/stories/StoryEditor.js';
import { StoryViewer } from '../../features/stories/StoryViewer.js';

/**
 * The story editor and viewer, at `/dev/story-lab`, without a session.
 *
 * "Posting" here hands the draft straight to the viewer instead of the server,
 * so the whole loop - place stickers, share, watch, vote - can be walked
 * through in a browser that is not signed in. Answers go nowhere.
 */
const SAMPLE = 'https://picsum.photos/id/1011/1080/1920';
const DEMO: StorySticker[] = [
  { id: 'p1', type: 'poll', x: 0.5, y: 0.55, s: 1, r: 0, d: { q: 'Chai ya coffee?', opts: ['CHAI', 'COFFEE'] } },
  { id: 'l1', type: 'loc', x: 0.5, y: 0.78, s: 1, r: -4, d: { text: 'Indore' } },
  { id: 't1', type: 'text', x: 0.5, y: 0.2, s: 1, r: 0, d: { text: 'late night drive', font: 'neon', color: '#ff7eb6', bg: 'none', align: 'center', size: 40, anim: 'flicker' } },
];

export function StoryLab() {
  const [editing, setEditing] = useState<{ src: string; kind: 'photo' | 'video'; media: Blob; stickers?: StorySticker[] }>();
  const [stories, setStories] = useState<Story[]>([]);
  const [watching, setWatching] = useState(false);

  const openEditor = async (withStickers: boolean) => {
    const blob = await (await fetch(SAMPLE)).blob();
    setEditing({ src: URL.createObjectURL(blob), kind: 'photo', media: blob, ...(withStickers ? { stickers: DEMO } : {}) });
  };
  const posted = async (draft: StoryDraft) => {
    const now = Date.now();
    setStories((list) => [...list, {
      id: `lab-${now}`, authorId: 'lab', authorName: 'Story Lab', authorUsername: 'storylab', kind: draft.kind,
      mediaUrl: URL.createObjectURL(draft.media), audience: draft.audience, createdAt: now, expiresAt: now + 864e5, seen: false, likedByMe: false,
      ...(draft.caption ? { caption: draft.caption } : {}), ...(draft.decor ? { decor: draft.decor } : {}),
    }]);
    setEditing(undefined);
  };
  const group: StoryGroup | undefined = stories.length ? {
    authorId: 'lab', authorName: 'Story Lab', authorUsername: 'storylab', stories, allSeen: false, latestAt: Date.now(), isFriend: true, closeFriends: false,
  } : undefined;
  // a second person, so the turn between people can be tried
  const friend: StoryGroup = useMemo(() => {
    const now = Date.now();
    const mk = (id: string, pic: number): Story => ({ id, authorId: 'baani', authorName: 'Baani', authorUsername: 'baani', kind: 'photo',
      mediaUrl: `https://picsum.photos/id/${pic}/1080/1920`, audience: 'friends', createdAt: now - 36e5, expiresAt: now + 864e5, seen: false, likedByMe: false });
    return { authorId: 'baani', authorName: 'Baani', authorUsername: 'baani', stories: [mk('f1', 1062), mk('f2', 1043)], allSeen: false, latestAt: now, isFriend: true, closeFriends: false };
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-sunken">
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-6">
        <h1 className="text-h2 text-ink">Story lab</h1>
        <button type="button" data-lab="edit" onClick={() => void openEditor(false)} className="rounded-xl bg-page p-4 text-left font-semibold shadow-sm">Open the editor</button>
        <button type="button" data-lab="edit-stickers" onClick={() => void openEditor(true)} className="rounded-xl bg-page p-4 text-left font-semibold shadow-sm">Open the editor with a poll, place and text</button>
        <label className="rounded-xl bg-page p-4 font-semibold shadow-sm">
          Open the editor with a file
          <input type="file" accept="image/*,video/*" className="mt-2 block text-caption" onChange={(e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setEditing({ src: URL.createObjectURL(f), kind: f.type.startsWith('video/') ? 'video' : 'photo', media: f });
          }} />
        </label>
        <button type="button" data-lab="watch" disabled={!group} onClick={() => setWatching(true)} className="rounded-xl bg-page p-4 text-left font-semibold shadow-sm disabled:opacity-50">
          Watch what was shared ({stories.length})
        </button>
      </div>

      {editing && (
        <StoryEditor src={editing.src} kind={editing.kind} media={editing.media} {...(editing.stickers ? { initialStickers: editing.stickers } : {})}
          onClose={() => setEditing(undefined)} onPost={posted} />
      )}
      {watching && group && <StoryViewer groups={[group, friend]} startGroupIndex={0} currentUserId="someone-else" onClose={() => setWatching(false)} />}
    </div>
  );
}
