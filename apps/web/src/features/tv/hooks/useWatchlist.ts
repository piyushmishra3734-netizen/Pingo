import { useCallback, useEffect, useState } from 'react';
import type { MediaType, TmdbMedia, WatchlistItem } from '../types.js';
import { getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase/client.js';

const LOCAL_STORAGE_KEY = 'pingo:tv:watchlist';
const SYNC_EVENT = 'pingo:tv:watchlist:sync';

function readLocalStorage(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WatchlistItem[];
  } catch {
    return [];
  }
}

function writeLocalStorage(items: WatchlistItem[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  } catch {
    // quota exceeded or private browsing
  }
}

/** How long the list fetched from the server is trusted before it is asked for again. */
const SYNC_TTL_MS = 5 * 60 * 1000;
let inflight: Promise<void> | undefined;
let syncedAt = 0;
let syncedFor: string | undefined;

/**
 * Loads the signed-in person's saved list from Supabase into local storage.
 *
 * This used to run inside the hook, and the hook is used by every poster card on
 * the TV screen: twenty cards were twenty identical requests, on every screen
 * that kept the TV tab alive - 17 to 19 `pingo_tv_watchlist` calls per tap,
 * which on a slow connection queue in front of what the person asked for. One
 * request at a time is shared by everybody who asks, and its answer is trusted
 * for five minutes (and for another account, not at all).
 */
export function syncWatchlistFromServer(): Promise<void> {
  if (!isSupabaseConfigured()) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const client = getSupabaseClient();
      const { data } = await client.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) return;
      if (syncedFor === userId && Date.now() - syncedAt < SYNC_TTL_MS) return;
      const { data: dbRows, error } = await client
        .from('pingo_tv_watchlist' as any)
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) return;
      syncedFor = userId;
      syncedAt = Date.now();
      if (Array.isArray(dbRows) && dbRows.length > 0) {
        const mapped: WatchlistItem[] = dbRows.map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          media_id: String(r.media_id),
          media_type: r.media_type as MediaType,
          title: r.title,
          poster_path: r.poster_path,
          backdrop_path: r.backdrop_path,
          overview: r.overview,
          rating: r.rating ? Number(r.rating) : undefined,
          release_year: r.release_year,
          created_at: r.created_at,
        }));
        // Every mounted copy of the hook hears this and reads the list again.
        writeLocalStorage(mapped);
      }
    } catch {
      // Supabase not yet configured or table not yet migrated
    }
  })().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => readLocalStorage());

  const sync = useCallback(() => {
    setWatchlist(readLocalStorage());
  }, []);

  useEffect(() => {
    window.addEventListener(SYNC_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SYNC_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [sync]);

  // Pull the saved list from Supabase once for everybody, not once per card.
  useEffect(() => {
    void syncWatchlistFromServer();
  }, []);

  const isSaved = useCallback(
    (mediaId: string | number, mediaType: MediaType = 'movie'): boolean => {
      const idStr = String(mediaId);
      return watchlist.some((item) => item.media_id === idStr && item.media_type === mediaType);
    },
    [watchlist],
  );

  const addToWatchlist = useCallback(
    (media: TmdbMedia) => {
      const idStr = String(media.id);
      const mediaType: MediaType = media.media_type || (media.title ? 'movie' : 'tv');
      const title = media.title || media.name || 'Untitled';
      const year = (media.release_date || media.first_air_date || '').slice(0, 4);

      const newItem: WatchlistItem = {
        media_id: idStr,
        media_type: mediaType,
        title,
        poster_path: media.poster_path,
        backdrop_path: media.backdrop_path,
        overview: media.overview,
        rating: media.vote_average,
        release_year: year || undefined,
        created_at: new Date().toISOString(),
      };

      const updated = [newItem, ...watchlist.filter((i) => !(i.media_id === idStr && i.media_type === mediaType))];
      writeLocalStorage(updated);
      setWatchlist(updated);

      // Async write to Supabase if authenticated
      if (isSupabaseConfigured()) {
        try {
          const client = getSupabaseClient();
          void client.auth.getSession().then(({ data }) => {
            if (!data.session?.user) return;
            void client.from('pingo_tv_watchlist' as any).upsert({
              user_id: data.session.user.id,
              media_id: idStr,
              media_type: mediaType,
              title,
              poster_path: media.poster_path,
              backdrop_path: media.backdrop_path,
              overview: media.overview,
              rating: media.vote_average,
              release_year: year || null,
            });
          });
        } catch {
          // ignore
        }
      }
    },
    [watchlist],
  );

  const removeFromWatchlist = useCallback(
    (mediaId: string | number, mediaType: MediaType = 'movie') => {
      const idStr = String(mediaId);
      const updated = watchlist.filter((i) => !(i.media_id === idStr && i.media_type === mediaType));
      writeLocalStorage(updated);
      setWatchlist(updated);

      if (isSupabaseConfigured()) {
        try {
          const client = getSupabaseClient();
          void client.auth.getSession().then(({ data }) => {
            if (!data.session?.user) return;
            void client
              .from('pingo_tv_watchlist' as any)
              .delete()
              .eq('user_id', data.session.user.id)
              .eq('media_id', idStr)
              .eq('media_type', mediaType);
          });
        } catch {
          // ignore
        }
      }
    },
    [watchlist],
  );

  const toggleWatchlist = useCallback(
    (media: TmdbMedia) => {
      const mediaType: MediaType = media.media_type || (media.title ? 'movie' : 'tv');
      if (isSaved(media.id, mediaType)) {
        removeFromWatchlist(media.id, mediaType);
      } else {
        addToWatchlist(media);
      }
    },
    [isSaved, addToWatchlist, removeFromWatchlist],
  );

  return {
    watchlist,
    isSaved,
    addToWatchlist,
    removeFromWatchlist,
    toggleWatchlist,
  };
}
