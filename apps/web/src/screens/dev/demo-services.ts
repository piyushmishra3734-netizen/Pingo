import { MockChatService, type Profile, type Story, type StoryGroup } from '@pingo/core';

/**
 * A signed-in PINGO with nobody behind it, for looking at the app in a browser
 * that has no backend - dev builds only, switched on by opening any page with
 * `?demo` (and off with `?demo=off`).
 *
 * Chats come from `MockChatService`, the in-memory service the core package
 * keeps for exactly this; stories are the story lab's people. Everything else
 * answers as a new, empty account would: no follow requests, no posts, nothing
 * to find. Nothing here is ever sent anywhere.
 */

const KEY = 'pingo:demo';

export function demoOn(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(location.search).get('demo');
    if (q === 'off') localStorage.removeItem(KEY);
    else if (q !== null) localStorage.setItem(KEY, '1');
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

const face = (n: number) => `https://i.pravatar.cc/120?img=${n}`;
const pic = (id: number) => `https://picsum.photos/id/${id}/540/960`;
const ME_ID = 'u-me';

const ME: Profile = {
  id: ME_ID,
  username: 'piyush',
  displayName: 'Piyush Mishra',
  avatarUrl: face(12),
  bio: 'Building calm software.',
  bannerOffset: 50,
  isPremium: false,
  createdAt: Date.now() - 200 * 864e5,
} as Profile;

const PEOPLE = [
  ['baani', 'Baani', 47, 1062, 2],
  ['eddy.exe', 'Eddy', 15, 1015, 4],
  ['riya.k', 'Riya Kapoor', 45, 1039, 0.4],
  ['luffy', 'Luffy', 33, 1050, 5],
  ['kashish_', 'Kashish', 44, 1044, 8],
  ['aarav_', 'Aarav', 53, 1018, 9],
] as const;

function storyGroups(): StoryGroup[] {
  const now = Date.now();
  return PEOPLE.map(([id, full, f, p, ago], i) => {
    const story: Story = {
      id: `${id}-0`, authorId: id, authorName: full, authorUsername: id, authorAvatarUrl: face(f), kind: 'photo',
      mediaUrl: pic(p), audience: i === 1 ? 'close' : 'friends', createdAt: now - ago * 36e5, expiresAt: now + 864e5,
      seen: i === 5, likedByMe: false,
    };
    return { authorId: id, authorName: full, authorUsername: id, authorAvatarUrl: face(f), stories: [story],
      allSeen: i === 5, latestAt: story.createdAt, isFriend: true, closeFriends: i === 1 };
  });
}

/** A method nobody implemented answers the way an empty account would. */
function empty(name: string): unknown {
  if (/^(on|subscribe|watch|listen)[A-Z]/.test(name)) return () => () => undefined;
  if (/^(list|search|suggest)/.test(name)) return async () => [];
  return async () => null;
}

function stub<T extends object>(own: Record<string, unknown>): T {
  return new Proxy(own, {
    get: (target, key) => (typeof key !== 'string' ? undefined : key in target ? target[key] : empty(key)),
  }) as T;
}

/** People from the story tray, as profiles, so their pages open. */
function personProfile(handle: string): Profile | null {
  const row = PEOPLE.find(([id]) => id === handle);
  if (!row) return null;
  const [id, full, f] = row;
  return { id, username: id, displayName: full, avatarUrl: face(f), bio: 'Coffee, films and long walks.', work: 'Designer', location: 'Mumbai', bannerOffset: 50, isPremium: false, createdAt: Date.now() - 90 * 864e5 } as Profile;
}

export function demoServices() {
  // Privacy rules kept in memory; Baani's account is private, to show that page.
  let privacy = { whoCanCall: 'everyone', whoCanAdd: 'everyone', profileVisibility: 'everyone', onlineStatus: true, privateAccount: false };
  const session = { user: { id: ME_ID, email: 'demo@pingo.local', methods: ['email'], createdAt: ME.createdAt } };
  const chat = new MockChatService();
  const chatProxy = new Proxy(chat, {
    get: (target, key) => {
      // A story mention from Rohit, so the card can be seen from the receiving side.
      if (key === 'listMessages') {
        return async (id: string, options?: unknown) => {
          const list = await target.listMessages(id, options as never);
          const like = list.find((m) => m.authorId !== ME_ID);
          if (id !== 'c-rohit' || !like || (options as { before?: string } | undefined)?.before) return list;
          return [...list, { ...like, id: 'demo-mention', body: '@baani mentioned you in their story\nhttps://pingochat.pages.dev/story?m=baani-0&a=baani', createdAt: Date.now() - 60_000, reactions: [] }];
        };
      }
      if (typeof key === 'string' && !(key in target)) return empty(key);
      const value: unknown = Reflect.get(target, key);
      // Bound, because the service keeps private fields a proxy cannot reach.
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return {
    auth: stub({
      supportedMethods: [],
      getSession: async () => session,
      onSessionChange: (listener: (s: typeof session) => void) => { setTimeout(() => listener(session), 0); return () => undefined; },
      listSavedAccounts: async () => [],
    }),
    profile: stub({
      getMine: async () => ME,
      find: async (h: string) => (h === ME.username || h === ME_ID ? ME : personProfile(h)),
      peek: (h: string) => (h === ME.username || h === ME_ID ? ME : personProfile(h) ?? undefined),
      followState: async () => 'none',
      privacySettings: async () => privacy,
      updatePrivacySettings: async (changes: object) => { privacy = { ...privacy, ...changes }; },
      isPrivateAccount: async (id: string) => id === 'baani',
      stats: async () => ({ posts: 3, friends: 12, groups: 2 }),
    }),
    chat: chatProxy,
    story: stub({ listStoryGroups: async () => storyGroups(), listFriends: async () => [...PEOPLE.map((p) => p[0]), ...(await chat.listContacts()).map((u) => u.id)] }),
    call: demoCalls(),
  };
}

/**
 * A call to look at, for `?demo&call=incoming|outgoing|connected` (`&kind=video`).
 *
 * No media and no network: just the states the call screen draws, so its
 * design can be worked on without two phones.
 */
function demoCalls() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('call');
  const kind = params.get('kind') === 'video' ? 'video' : 'voice';
  const listeners = new Set<(event: unknown) => void>();
  let call: Record<string, unknown> | undefined;
  const emit = (event: unknown) => listeners.forEach((fn) => fn(event));
  const update = (changes: Record<string, unknown>) => {
    if (!call) return;
    call = { ...call, ...changes };
    emit({ type: 'call:updated', call });
  };
  const end = () => {
    if (!call) return;
    const ended = { ...call, state: 'ended', endReason: 'hung-up' };
    call = undefined;
    emit({ type: 'call:ended', call: ended });
  };
  let started = false;
  const start = () => {
    if (!mode || started) return;
    started = true;
    setTimeout(() => {
      call = {
        id: 'demo-call',
        peer: { userId: 'u-rohit', name: 'Rohit Verma' },
        conversationId: 'c-rohit',
        direction: mode === 'incoming' ? 'incoming' : 'outgoing',
        kind,
        state: mode === 'connected' ? 'connected' : mode === 'incoming' ? 'ringing' : 'dialling',
        muted: false,
        cameraOff: kind === 'voice',
        ...(mode === 'connected' ? { connectedAt: Date.now() - 83_000 } : {}),
      };
      emit({ type: mode === 'incoming' ? 'call:incoming' : 'call:updated', call });
    }, 600);
  };
  return stub({
    get current() { return call; },
    connect: async () => undefined,
    disconnect: () => undefined,
    // Rings once somebody is listening, so the screen never misses it.
    subscribe: (fn: (event: unknown) => void) => { listeners.add(fn); start(); return () => listeners.delete(fn); },
    answer: async () => update({ state: 'connected', connectedAt: Date.now() }),
    decline: async () => end(),
    hangUp: async () => end(),
    setMuted: (_id: string, muted: boolean) => update({ muted }),
    setCameraOff: (_id: string, cameraOff: boolean) => update({ cameraOff }),
    quality: async () => undefined,
  });
}
