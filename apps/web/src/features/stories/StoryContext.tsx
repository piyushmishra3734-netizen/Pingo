import type { Story, StoryDraft, StoryGroup, StoryService } from '@pingo/core';
import { useAuth } from '@pingo/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getRealtimeHub } from '../../lib/supabase/realtime-hub.js';
import { isBlocked, onBlocksChange } from '../safety/blocks.js';
import { announceStoryPosted } from './story-mentions.js';
import { UploadToast, flyToRing, type StoryFrom, type UploadNote } from './StoryUpload.js';
import { deleteStoryDraft, saveStoryDraft } from './story-drafts.js';

/**
 * Story state, shared by the rail, the viewer and the creator.
 *
 * Deliberately app-level rather than a fourth provider in `@pingo/core`:
 * stories are one screen's data plus a handful of actions, and everything that
 * touches them lives here. If a mobile client ever needs the same state this
 * moves, until then, a provider in core would be architecture bought on
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
  /** Stories on their way up. Your ring spins while this is above zero. */
  uploading: number;
  /**
   * Posts in the background, the way Instagram does: the caller closes its
   * editor straight away, the picture flies into your ring from `from`, the
   * ring spins until it is up, and a toast says it went (or offers a retry).
   *
   * One that fails is kept under Drafts - see story-drafts.ts. `draftId` is
   * that draft being posted again: it goes when the story is up.
   */
  upload: (draft: StoryDraft, from?: StoryFrom, draftId?: string) => void;
  /** The sample's toast: one line and an icon, for a moment. */
  notify: (text: string, icon?: ReactNode) => void;
}

const StoryContext = createContext<StoryContextValue | undefined>(undefined);

/**
 * You, then friends, then the rest, and within each band, unseen first.
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
      // Nobody this account has blocked (features/safety/blocks.ts).
      setRaw(groups.filter((g) => !isBlocked(g.authorId)));
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
  // A block or an unblock takes effect in the tray at once.
  useEffect(() => onBlocksChange(() => void refresh()), [refresh]);

  /*
   * Somebody's story going up or coming down, without a reload.
   *
   * The rail is the one surface where being stale is most obvious - stories
   * expire in a day, so a rail that only updates when the app is reopened is
   * describing a window that has already moved.
   *
   * A whole re-read rather than patching the row in: a story arriving changes
   * ordering (unseen first, inside bands), the author's ring state and whether
   * they appear at all, and getting one of those wrong is worse than the extra
   * fetch. `refresh` already coalesces into a single pair of requests.
   */
  useEffect(() => {
    if (!signedIn) return;
    return getRealtimeHub().on('stories', () => {
      void refresh();
    });
  }, [signedIn, refresh]);

  const groups = useMemo(() => order(raw, meId), [raw, meId]);
  const mine = useMemo(() => groups.find((group) => group.authorId === meId), [groups, meId]);

  /**
   * Rewrites one story wherever it appears, leaving everything else alone.
   *
   * ## Why this bails out when nothing actually changed
   *
   * It used to rebuild the array unconditionally, and that was an infinite
   * loop. The viewer marks a story seen in an effect keyed on the story; the
   * patch made a new story object; the new object re-fired the effect; which
   * marked it seen again. The symptom was not an error - it was a progress bar
   * that never moved and a tab that eventually stopped responding, because
   * React was re-rendering as fast as it could.
   *
   * Returning the identical array when the change is a no-op is what stops it,
   * and it is also just true: nothing changed, so nothing downstream should
   * believe it did.
   */
  const patchStory = useCallback((storyId: string, change: (story: Story) => Story) => {
    setRaw((previous) => {
      let touched = false;

      const next = previous.map((group) => {
        if (!group.stories.some((story) => story.id === storyId)) return group;

        let groupTouched = false;
        const stories = group.stories.map((story) => {
          if (story.id !== storyId) return story;
          const updated = change(story);
          // Compared field by field rather than by identity: `change` always
          // returns a fresh object, so identity would always differ.
          if (updated.seen === story.seen && updated.likedByMe === story.likedByMe) return story;
          groupTouched = true;
          return updated;
        });

        if (!groupTouched) return group;
        touched = true;
        return { ...group, stories, allSeen: stories.every((story) => story.seen) };
      });

      return touched ? next : previous;
    });
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

  const [uploading, setUploading] = useState(0);
  const [note, setNote] = useState<UploadNote>();
  const noteTimer = useRef<number | undefined>(undefined);
  const say = useCallback((next: UploadNote | undefined) => {
    window.clearTimeout(noteTimer.current);
    setNote(next);
    if (next) noteTimer.current = window.setTimeout(() => setNote(undefined), next.ok ? 1900 : 6000);
  }, []);

  const upload = useCallback(
    (draft: StoryDraft, from?: StoryFrom, draftId?: string) => {
      let savedAs = draftId;
      const go = async (fly: boolean) => {
        // The ring only starts to spin once the picture has landed in it.
        if (fly && from) await flyToRing(from, draft.kind === 'photo' ? draft.media : undefined);
        setUploading((n) => n + 1);
        try {
          const posted = await service.post(draft);
          if (savedAs && meId) void deleteStoryDraft(meId, savedAs);
          // Anybody mentioned in it hears about it in chat - see story-mentions.ts.
          announceStoryPosted(posted);
          await refresh();
          say({ at: Date.now(), ok: true, text: draft.audience === 'close' ? 'Shared with close friends' : 'Shared to your story' });
        } catch {
          // Kept, so a bad signal never costs the story itself.
          if (meId) savedAs = (await saveStoryDraft(meId, draft, savedAs)) ?? savedAs;
          say({ at: Date.now(), ok: false, text: savedAs ? 'Did not post · saved to drafts' : 'Your story did not post', retry: () => void go(false) });
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      };
      void go(true);
    },
    [service, refresh, say, meId],
  );

  const notify = useCallback((text: string, icon?: ReactNode) => say({ at: Date.now(), ok: true, text, ...(icon ? { icon } : {}) }), [say]);

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
      uploading,
      upload,
      notify,
    }),
    [service, groups, mine, loading, refresh, markSeen, setLiked, mutedAuthors, setAuthorMuted, uploading, upload, notify],
  );

  return (
    <StoryContext.Provider value={value}>
      {children}
      {note && <UploadToast key={note.at} note={note} onDone={() => say(undefined)} />}
    </StoryContext.Provider>
  );
}

export function useStories(): StoryContextValue {
  const context = useContext(StoryContext);
  if (!context) throw new Error('useStories must be used inside a <StoryProvider>');
  return context;
}
