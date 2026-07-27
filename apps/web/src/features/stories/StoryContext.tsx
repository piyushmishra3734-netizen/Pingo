import type { Story, StoryGroup, StoryService } from '@pingo/core';
import { useAuth } from '@pingo/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Story state, shared by the rail, the viewer and the creator.
 *
 * Deliberately app-level rather than a fourth provider in `@pingo/core`:
 * stories are one screen's data plus a handful of actions, and everything that
 * touches them lives here. If a mobile client ever needs the same state this
 * moves — until then, a provider in core would be architecture bought on
 * speculation.
 *
 * ## Ordering is decided here, once
 *
 * You, then friends, then everybody else. The service returns groups in no
 * particular order on purpose: sorting is a product rule about what a person
 * wants to see first, not a fact about the data, and keeping it in one place is
 * what stops the rail and the viewer's "who comes next" from disagreeing.
 */

interface StoryContextValue {
  service: StoryService;
  /** Ordered: you, then friends, then the rest. */
  groups: StoryGroup[];
  /** The signed-in user's own group, if they have a live story. */
  mine: StoryGroup | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Marks a story seen and updates the rail without a refetch. */
  markSeen: (storyId: string) => Promise<void>;
  /** Likes or unlikes, applied locally first so the heart fills at once. */
  setLiked: (storyId: string, liked: boolean) => Promise<void>;
  /** Ids the signed-in user has muted. The rail already excludes them. */
  mutedAuthors: string[];
  setAuthorMuted: (userId: string, muted: boolean) => Promise<void>;
}

const StoryContext = createContext<StoryContextValue | undefined>(undefined);

/**
 * You, then friends, then the rest — and within each band, unseen first.
 *
 * The bands are the product rule. Unseen-first *inside* a band is what makes
 * the rail answer "what is new" without anybody counting: watched circles sink,
 * but never past somebody you are not friends with, because a friend's old
 * story is still more interesting than a stranger's new one.
 */
function order(groups: StoryGroup[], meId: string | undefined): StoryGroup[] {
  const band = (group: StoryGroup) => {
    if (group.authorId === meId) return 0;
    return group.isFriend ? 1 : 2;
  };

  return [...groups].sort((a, b) => {
    const bands = band(a) - band(b);
    if (bands !== 0) return bands;
    if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
    return b.latestAt - a.latestAt;
  });
}

export function StoryProvider({
  children,
  service,
}: {
  children: ReactNode;
  service: StoryService;
}) {
  const { signedIn, session } = useAuth();
  const meId = session?.user.id;

  const [raw, setRaw] = useState<StoryGroup[]>([]);
  const [mutedAuthors, setMutedAuthors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setRaw([]);
      setMutedAuthors([]);
      setLoading(false);
      return;
    }
    try {
      const [groups, muted] = await Promise.all([
        service.listStoryGroups(),
        service.listMutedAuthors(),
      ]);
      setRaw(groups);
      setMutedAuthors(muted);
    } catch {
      // An empty rail is the right failure: the screen below it still works,
      // and stories are not what the user came to Home for.
      setRaw([]);
    } finally {
      setLoading(false);
    }
  }, [service, signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = useMemo(() => order(raw, meId), [raw, meId]);
  const mine = useMemo(() => groups.find((group) => group.authorId === meId), [groups, meId]);

  /** Rewrites one story wherever it appears, leaving everything else alone. */
  const patchStory = useCallback((storyId: string, change: (story: Story) => Story) => {
    setRaw((previous) =>
      previous.map((group) => {
        if (!group.stories.some((story) => story.id === storyId)) return group;
        const stories = group.stories.map((story) =>
          story.id === storyId ? change(story) : story,
        );
        return { ...group, stories, allSeen: stories.every((story) => story.seen) };
      }),
    );
  }, []);

  const markSeen = useCallback(
    async (storyId: string) => {
      // Applied locally too. Waiting for a refetch would leave the ring bright
      // behind a story the user is currently looking at.
      patchStory(storyId, (story) => ({ ...story, seen: true }));
      await service.markSeen(storyId);
    },
    [service, patchStory],
  );

  const setLiked = useCallback(
    async (storyId: string, liked: boolean) => {
      patchStory(storyId, (story) => ({ ...story, likedByMe: liked }));
      try {
        await service.setLiked(storyId, liked);
      } catch {
        patchStory(storyId, (story) => ({ ...story, likedByMe: !liked }));
      }
    },
    [service, patchStory],
  );

  const setAuthorMuted = useCallback(
    async (userId: string, muted: boolean) => {
      await service.setAuthorMuted(userId, muted);
      setMutedAuthors((previous) =>
        muted ? [...new Set([...previous, userId])] : previous.filter((id) => id !== userId),
      );
      // A muted author leaves the rail entirely, and only a refetch knows that.
      await refresh();
    },
    [service, refresh],
  );

  const value = useMemo<StoryContextValue>(
    () => ({
      service,
      groups,
      mine,
      loading,
      refresh,
      markSeen,
      setLiked,
      mutedAuthors,
      setAuthorMuted,
    }),
    [service, groups, mine, loading, refresh, markSeen, setLiked, mutedAuthors, setAuthorMuted],
  );

  return <StoryContext.Provider value={value}>{children}</StoryContext.Provider>;
}

export function useStories(): StoryContextValue {
  const context = useContext(StoryContext);
  if (!context) throw new Error('useStories must be used inside a <StoryProvider>');
  return context;
}
