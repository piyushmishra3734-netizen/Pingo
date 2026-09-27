import type { Post, Profile, Story, StoryDraft, StoryGroup, StoryService, StorySticker, StoryViewer as Watcher } from '@pingo/core';
import { useMemo, useRef, useState } from 'react';

import { PostToStory } from '../../features/profile/PostToStory.js';
import { PostViewer } from '../../features/profile/PostViewer.js';
import { StoriesRow } from '../../features/stories/StoriesRow.js';
import { StoryComposer } from '../../features/stories/StoryComposer.js';
import { StoryEditor } from '../../features/stories/StoryEditor.js';
import { StoryProvider, useStories } from '../../features/stories/StoryContext.js';
import type { StoryFrom } from '../../features/stories/StoryUpload.js';
import { StoryViewer } from '../../features/stories/StoryViewer.js';

/**
 * The stories sample (`docs/handoff/stories-camera/sample/story.html`), in the
 * app, at `/dev/story-lab`, without a session: the same people, stories,
 * stickers and song, so the two can be put side by side.
 *
 * Posting goes through the real upload path - the flight into your ring, the
 * spinning ring, the toast - against a stand-in service that keeps the story
 * here. Anything else that needs a session refuses, as it would signed out.
 */
const pic = (id: number) => `https://picsum.photos/id/${id}/540/960`;
const face = (n: number) => `https://i.pravatar.cc/120?img=${n}`;
const KESARIYA = {
  name: 'Kesariya', artist: 'Pritam, Arijit Singh', start: 62,
  url: 'https://aac.saavncdn.com/871/c2febd353f3a076a406fa37510f31f9f_160.mp4',
  img: 'https://c.saavncdn.com/871/Brahmastra-Original-Motion-Picture-Soundtrack-Hindi-2022-20221006155213-150x150.jpg',
};
const H = 36e5;
type LabSticker = Pick<StorySticker, 'type' | 'x' | 'y' | 'd'> & { r?: number };
interface Item { pic: number; ago: number; close?: boolean; song?: boolean; stickers: LabSticker[] }
const PEOPLE: { id: string; name: string; full: string; avatar: string; items: Item[]; seen?: boolean }[] = [
  { id: 'baani', name: 'baani', full: 'Baani', avatar: face(47), items: [
    { pic: 1062, ago: 2, stickers: [
      { type: 'poll', x: 0.5, y: 0.6, d: { q: 'Chai ya coffee?', opts: ['CHAI', 'COFFEE'] } },
      { type: 'loc', x: 0.5, y: 0.8, r: -4, d: { text: 'Indore' } }] },
    { pic: 1043, ago: 1, song: true, stickers: [
      { type: 'countdown', x: 0.5, y: 0.34, d: { q: "Baani's birthday", to: new Date(Date.now() + 2.4 * 864e5).toISOString() } },
      { type: 'music', x: 0.5, y: 0.72, r: 3, d: KESARIYA }] }] },
  { id: 'eddy', name: 'eddy.exe', full: 'Eddy', avatar: face(15), items: [
    { pic: 1015, ago: 4, close: true, stickers: [
      { type: 'text', x: 0.5, y: 0.2, d: { text: 'late night drive', font: 'neon', color: '#ff7eb6', bg: 'none', align: 'center', size: 40, anim: 'flicker' } },
      { type: 'question', x: 0.5, y: 0.62, d: { q: 'Ask me anything' } }] },
    { pic: 1016, ago: 3, close: true, stickers: [
      { type: 'slider', x: 0.5, y: 0.55, d: { q: 'How hyped for the trip?', emoji: '😍' } }] }] },
  { id: 'riya', name: 'riya.k', full: 'Riya Kapoor', avatar: face(45), items: [
    { pic: 1039, ago: 0.33, stickers: [
      { type: 'quiz', x: 0.5, y: 0.55, d: { q: 'Where was this?', opts: ['Goa', 'Manali', 'Kerala'], right: 2 } }] }] },
  { id: 'luffy', name: 'luffy', full: 'Luffy', avatar: face(33), items: [
    { pic: 1050, ago: 5, stickers: [
      { type: 'clock', x: 0.5, y: 0.22, d: { at: Date.now() - 5 * H } },
      { type: 'men', x: 0.35, y: 0.7, r: -6, d: { text: 'baani' } },
      { type: 'link', x: 0.62, y: 0.8, d: { text: 'pingochat.xyz' } }] }] },
  { id: 'kashish', name: 'kashish_', full: 'Kashish', avatar: face(44), items: [
    { pic: 1044, ago: 8, stickers: [
      { type: 'text', x: 0.5, y: 0.5, d: { text: 'new blog\nout now', font: 'type', color: '#ffffff', size: 30, bg: 'none', align: 'center', anim: 'type' } },
      { type: 'tag', x: 0.5, y: 0.66, r: 4, d: { text: 'weekendread' } }] }] },
  { id: 'aarav', name: 'aarav_', full: 'Aarav', avatar: face(53), seen: true, items: [{ pic: 1018, ago: 9, stickers: [] }] },
];
const ME = { id: 'me', name: 'piuxxh', avatar: face(12) };
const WATCHERS: Watcher[] = [...PEOPLE, { id: 'harsh', name: 'harsh.dev', full: 'Harsh', avatar: face(60) }].slice(0, 7)
  .map((p, i) => ({ userId: p.id, username: p.name, displayName: p.full, avatarUrl: p.avatar, viewedAt: Date.now() - i * 6e5, liked: i === 0 || i === 3 }));

function groupsOf(): StoryGroup[] {
  const now = Date.now();
  return PEOPLE.map((p) => {
    const stories: Story[] = p.items.map((it, k) => ({
      id: `${p.id}-${k}`, authorId: p.id, authorName: p.name, authorUsername: p.name, authorAvatarUrl: p.avatar, kind: 'photo',
      mediaUrl: pic(it.pic), audience: it.close ? 'close' : 'friends', createdAt: now - it.ago * H, expiresAt: now + 864e5,
      seen: !!p.seen, likedByMe: false,
      decor: { v: 1, stickers: it.stickers.map((s, i) => ({ id: `${p.id}-${k}-${i}`, s: 1, r: 0, ...s })) },
      ...(it.song ? { audio: [{ url: KESARIYA.url, at: 0, duration: 15, volume: 1 }] } : {}),
    }));
    return { authorId: p.id, authorName: p.name, authorUsername: p.name, authorAvatarUrl: p.avatar, stories,
      allSeen: !!p.seen, latestAt: stories.at(-1)!.createdAt, isFriend: true, closeFriends: stories.every((s) => s.audience === 'close') };
  });
}

const BAANI: Profile = { id: 'baani', username: 'baani', displayName: 'Baani', avatarUrl: face(47), bannerOffset: 50, isPremium: false, createdAt: 0 } as Profile;
const POST: Post = { id: 'post-1', authorId: 'baani', imageUrl: 'https://picsum.photos/id/1025/900/1125', caption: 'sunday naps are a personality now', createdAt: Date.now() - 864e5, likeCount: 29, likedByMe: false, savedByMe: false, commentCount: 3, hideLikeCount: false, hideCommentCount: false };

export function StoryLab() {
  const [mine, setMine] = useState<Story[]>([]);
  const add = useRef(setMine); add.current = setMine;
  const service = useMemo(() => new Proxy({}, {
    get: (_, key) => {
      if (key === 'post') {
        // Takes the time an upload takes, so the ring has something to spin for; `?fail` refuses.
        return async (draft: StoryDraft) => {
          await new Promise((r) => setTimeout(r, 1400));
          if (location.search.includes('fail')) throw new Error('lab: refused');
          const now = Date.now();
          const story: Story = {
            id: `mine-${now}`, authorId: ME.id, authorName: ME.name, authorUsername: ME.name, authorAvatarUrl: ME.avatar, kind: draft.kind,
            mediaUrl: URL.createObjectURL(draft.media), audience: draft.audience, createdAt: now, expiresAt: now + 864e5, seen: false, likedByMe: false,
            ...(draft.caption ? { caption: draft.caption } : {}), ...(draft.decor ? { decor: draft.decor } : {}),
          };
          add.current((list) => [...list, story]);
          return story;
        };
      }
      if (key === 'listViewers') return async () => WATCHERS;
      if (key === 'insights') return async () => ({ views: WATCHERS.length, likes: 2, replies: 0 });
      return async () => { throw new Error('Not signed in (this is the lab)'); };
    },
  }) as StoryService, []);

  return (
    <StoryProvider service={service}>
      <Lab mine={mine} />
    </StoryProvider>
  );
}

function Lab({ mine }: { mine: Story[] }) {
  const { upload, uploading } = useStories();
  const [editing, setEditing] = useState<{ src: string; kind: 'photo' | 'video'; media: Blob; stickers?: StorySticker[] }>();
  const [watching, setWatching] = useState<{ index: number; origin?: DOMRect }>();
  const [post, setPost] = useState(false);
  const [toStory, setToStory] = useState<'friends' | 'close'>();
  const [adding, setAdding] = useState(false);
  const others = useMemo(groupsOf, []);

  const myGroup: StoryGroup | undefined = mine.length ? {
    authorId: ME.id, authorName: ME.name, authorUsername: ME.name, authorAvatarUrl: ME.avatar, stories: mine, allSeen: false,
    latestAt: Date.now(), isFriend: true, closeFriends: mine.every((s) => s.audience === 'close'),
  } : undefined;
  const groups = [...(myGroup ? [myGroup] : []), ...others];

  const openEditor = async (withStickers: boolean) => {
    const blob = await (await fetch('https://picsum.photos/id/1011/1080/1920')).blob();
    const demo: StorySticker[] = [
      { id: 'p1', type: 'poll', x: 0.5, y: 0.55, s: 1, r: 0, d: { q: 'Chai ya coffee?', opts: ['CHAI', 'COFFEE'] } },
      { id: 'l1', type: 'loc', x: 0.5, y: 0.78, s: 1, r: -4, d: { text: 'Indore' } },
      { id: 't1', type: 'text', x: 0.5, y: 0.2, s: 1, r: 0, d: { text: 'late night drive', font: 'neon', color: '#ff7eb6', bg: 'none', align: 'center', size: 40, anim: 'flicker' } },
    ];
    setEditing({ src: URL.createObjectURL(blob), kind: 'photo', media: blob, ...(withStickers ? { stickers: demo } : {}) });
  };
  const posted = async (draft: StoryDraft, from?: StoryFrom) => {
    upload(draft, from);
    setEditing(undefined);
  };

  return (
    <div className="h-full overflow-y-auto bg-page">
      <StoriesRow
        groups={groups}
        currentUserId={ME.id}
        currentUserName={ME.name}
        currentUserAvatarUrl={ME.avatar}
        onOpen={(group, origin) => setWatching({ index: groups.indexOf(group), origin })}
        onCreate={() => setAdding(true)}
        onManageMine={() => undefined}
        uploading={uploading > 0}
      />
      <div className="mx-auto flex w-full max-w-md flex-col gap-2 px-4 py-4">
        <button type="button" data-lab="edit" onClick={() => void openEditor(false)} className="rounded-xl bg-sunken p-3 text-left font-semibold">Open the editor</button>
        <button type="button" data-lab="edit-stickers" onClick={() => void openEditor(true)} className="rounded-xl bg-sunken p-3 text-left font-semibold">Open the editor with a poll, place and text</button>
        <button type="button" data-lab="post" onClick={() => setPost(true)} className="rounded-xl bg-sunken p-3 text-left font-semibold">Open Baani's post (Share → Add to story)</button>
        <label className="rounded-xl bg-sunken p-3 font-semibold">
          Open the editor with a file
          <input type="file" accept="image/*,video/*" className="mt-2 block text-caption" onChange={(e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setEditing({ src: URL.createObjectURL(f), kind: f.type.startsWith('video/') ? 'video' : 'photo', media: f });
          }} />
        </label>
        <button type="button" data-lab="watch" disabled={!myGroup} onClick={() => setWatching({ index: 0 })} className="rounded-xl bg-sunken p-3 text-left font-semibold disabled:opacity-50">
          Watch what was shared ({mine.length})
        </button>
      </div>

      {adding && <StoryComposer onClose={() => setAdding(false)} onPosted={() => setAdding(false)} onLive={() => undefined} />}
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
      {watching && (
        <StoryViewer groups={groups} startGroupIndex={watching.index} currentUserId={ME.id} onClose={() => setWatching(undefined)}
          {...(watching.origin ? { origin: watching.origin } : {})} />
      )}
    </div>
  );
}
