import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { openMusicAt } from './app/sheet-store.js';
import { parseCollectionParams } from './music-share.js';

/**
 * A shared playlist, album or artist link opened as an address (from outside
 * the app, or pasted): PINGO Music comes up on that page, over the chats.
 */
export function MusicLinkRoute() {
  const { search } = useLocation();
  useEffect(() => {
    const item = parseCollectionParams(new URLSearchParams(search));
    if (item) openMusicAt(item);
  }, [search]);
  return <Navigate to="/chats" replace />;
}
