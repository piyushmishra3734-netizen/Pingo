import type { StoryGroup, StoryService } from '@pingo/core';
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
 * Story state, shared by the home rail and the camera.
 *
 * Deliberately small and app-level rather than a fourth provider in
 * `@pingo/core`: stories are one screen's data plus one action, and the two
 * places that touch them both live here. If a mobile client ever needs the same
 * state, this moves — until then, a provider in core would be architecture
 * bought on speculation.
 */

interface StoryContextValue {
  service: StoryService;
  groups: StoryGroup[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Marks a story seen and updates the rail without a refetch. */
  markSeen: (storyId: string) => Promise<void>;
}

const StoryContext = createContext<StoryContextValue | undefined>(undefined);

export function StoryProvider({
  children,
  service,
}: {
  children: ReactNode;
  service: StoryService;
}) {
  const { signedIn } = useAuth();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setGroups([]);
      setLoading(false);
      return;
    }
    try {
      setGroups(await service.listStoryGroups());
    } catch {
      // An empty rail is the right failure: the screen below it still works,
      // and stories are not what the user came to Home for.
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [service, signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markSeen = useCallback(
    async (storyId: string) => {
      await service.markSeen(storyId);

      // Applied locally too. Waiting for a refetch would leave the ring bright
      // behind a story the user is currently looking at.
      setGroups((previous) =>
        previous.map((group) => {
          if (!group.stories.some((story) => story.id === storyId)) return group;
          const stories = group.stories.map((story) =>
            story.id === storyId ? { ...story, seen: true } : story,
          );
          return { ...group, stories, allSeen: stories.every((story) => story.seen) };
        }),
      );
    },
    [service],
  );

  const value = useMemo<StoryContextValue>(
    () => ({ service, groups, loading, refresh, markSeen }),
    [service, groups, loading, refresh, markSeen],
  );

  return <StoryContext.Provider value={value}>{children}</StoryContext.Provider>;
}

export function useStories(): StoryContextValue {
  const context = useContext(StoryContext);
  if (!context) throw new Error('useStories must be used inside a <StoryProvider>');
  return context;
}
