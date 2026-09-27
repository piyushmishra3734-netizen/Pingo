import type { Post, Profile, Story, StoryDraft, StoryGroup, StoryService, StorySticker } from '@pingo/core';
import { useMemo, useRef, useState } from 'react';

import { PostToStory } from '../../features/profile/PostToStory.js';
import { PostViewer } from '../../features/profile/PostViewer.js';
import { StoriesRow } from '../../features/stories/StoriesRow.js';
import { StoryEditor } from '../../features/stories/StoryEditor.js';
import { StoryProvider, useStories } from '../../features/stories/StoryContext.js';
import type { StoryFrom } from '../../features/stories/StoryUpload.js';
import { StoryViewer } from '../../features/stories/StoryViewer.js';

/**
 * The story editor and viewer, at `/dev/story-lab`, without a session.
 *
 * "Posting" goes through the real upload path - the flight into your ring, the
 * spinning ring, the toast - against a stand-in service that keeps the story
 * here instead of on the server, so the whole loop - place stickers, share,
 * watch, vote - can be walked through in a browser that is not signed in.
 * Answers go nowhere. A sample post tries Share → Add to story.
 */
const SAMPLE = 'https://picsum.photos/id/1011/1080/1920';
const DEMO: StorySticker[] = [
  { id: 'p1', type: 'poll', x: 0.5, y: 0.55, s: 1, r: 0, d: { q: 'Chai ya coffee?', opts: ['CHAI', 'COFFEE'] } },
  { id: 'l1', type: 'loc', x: 0.5, y: 0.78, s: 1, r: -4, d: { text: 'Indore' } },
  { id: 't1', type: 'text', x: 0.5, y: 0.2, s: 1, r: 0, d: { text: 'late night drive', font: 'neon', color: '#ff7eb6', bg: 'none', align: 'center', size: 40, anim: 'flicker' } },
];
const BAANI: Profile = { id: 'baani', username: 'baani', displayName: 'Baani', avatarUrl: 'https://i.pravatar.cc/120?img=47', bannerOffset: 50, isPremium: false, createdAt: 0 } as Profile;
const POST: Post = { id: 'post-1', authorId: 'baani', imageUrl: 'https://picsum.photos/id/1025/900/1125', caption: 'sunday naps are a personality now', createdAt: Date.now() - 864e5, likeCount: 29, likedByMe: false, savedByMe: false, commentCount: 3, hideLikeCount: false, hideCommentCount: false };

export function StoryLab() {
  const [stories, setStories] = useState<Story[]>([]);
  const add = useRef(setStories); add.current = setStories;
  /*
   * The real service's shape, answering from here. Posting adds the story at
   * once and then takes the time an upload takes, so the ring has something to
   * spin for; `?fail` makes it refuse, for the retry.
   */
  const service = useMemo(() => new Proxy({}, {
    get: (_, key) => {
      if (key === 'post') {
        return async (draft: StoryDraft) => {
          await new Promise((r) => setTimeout(r, 1400));
          if (location.search.includes('fail')) throw new Error('lab: refused');
          const now = Date.now();
          const story: Story = {
            id: `lab-${now}`, authorId: 'lab', authorName: 'Story Lab', authorUsername: 'storylab', kind: draft.kind,
            mediaUrl: URL.createObjectURL(draft.media), audience: draft.audience, createdAt: now, expiresAt: now + 864e5, seen: false, likedByMe: false,
            ...(draft.caption ? { caption: draft.caption } : {}), ...(draft.decor ? { decor: draft.decor } : {}),
          };
          add.current((list) => [...list, story]);
          return story;
        };
      }
      // Anything else needs a session, as it would signed out; the screens keep what they already show.
      return async () => { throw new Error('Not signed in (this is the lab)'); };
    },
  }) as StoryService, []);

  return (
    <StoryProvider service={service}>
      <Lab stories={stories} />
    </StoryProvider>
  );
}

function Lab({ stories }: { stories: Story[] }) {
  const { upload, uploading } = useStories();
  const [editing, setEditing] = useState<{ src: string; kind: 'photo' | 'video'; media: Blob; stickers?: StorySticker[] }>();
  const [watching, setWatching] = useState(false);
  const [post, setPost] = useState(false);
  const [toStory, setToStory] = useState<'friends' | 'close'>();

  const openEditor = async (withStickers: boolean) => {
    const blob = await (await fetch(SAMPLE)).blob();
    setEditing({ src: URL.createObjectURL(blob), kind: 'photo', media: blob, ...(withStickers ? { stickers: DEMO } : {}) });
  };
  const posted = async (draft: StoryDraft, from?: StoryFrom) => {
    upload(draft, from);
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
      <div className="bg-page pt-3">
        <StoriesRow
          groups={[...(group ? [group] : []), friend]}
          currentUserId="lab"
          currentUserName="Story Lab"
          onOpen={() => setWatching(true)}
          onCreate={() => void openEditor(false)}
          onManageMine={() => undefined}
          uploading={uploading > 0}
        />
      </div>
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-6">
        <h1 className="text-h2 text-ink">Story lab</h1>
        <button type="button" data-lab="edit" onClick={() => void openEditor(false)} className="rounded-xl bg-page p-4 text-left font-semibold shadow-sm">Open the editor</button>
        <button type="button" data-lab="edit-stickers" onClick={() => void openEditor(true)} className="rounded-xl bg-page p-4 text-left font-semibold shadow-sm">Open the editor with a poll, place and text</button>
        <button type="button" data-lab="post" onClick={() => setPost(true)} className="rounded-xl bg-page p-4 text-left font-semibold shadow-sm">Open Baani's post (Share → Add to story)</button>
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
      {post && (
        <PostViewer post={POST} author={BAANI} isMine={false} onClose={() => setPost(false)} onChange={() => undefined}
          onEditCaption={() => undefined} onReplace={() => undefined} onDelete={() => undefined} onReport={() => undefined}
          onAddToStory={setToStory} />
      )}
      {toStory && (
        <PostToStory post={POST} author={BAANI} audience={toStory} onClose={() => setToStory(undefined)}
          onPost={(draft, from) => { setToStory(undefined); setPost(false); upload(draft, from); }} />
      )}
      {watching && group && <StoryViewer groups={[group, friend]} startGroupIndex={0} currentUserId="someone-else" onClose={() => setWatching(false)} />}
    </div>
  );
}
