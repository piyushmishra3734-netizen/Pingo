import { useAuth, useProfile } from '@pingo/core';
import { useEffect } from 'react';

import { getRealtimeHub } from '../../lib/supabase/realtime-hub.js';

/**
 * Keeps the signed-in user's own profile current, everywhere at once.
 *
 * `ProfileProvider` lives in `@pingo/core`, which knows nothing about Supabase
 * and must not - a mobile client would bring its own transport. So the socket
 * cannot reach into it. This is the seam: a component that lives on the app
 * side, subscribes to the table, and calls the provider's own `refresh`.
 *
 * It renders nothing, and that is the point. Mounted once near the root, it
 * makes every avatar, name and bio in the app follow an edit made anywhere  - 
 * including on another device - without a single screen having to know.
 *
 * Filtered to this user's own row, because `profiles` is readable by everyone
 * and so its stream carries every edit on PINGO. Without the check this would
 * refetch on strangers changing their bio.
 */
export function LiveProfile() {
  const { profile, refresh } = useProfile();
  const { signedIn } = useAuth();
  const meId = profile?.id;

  useEffect(() => {
    if (!meId) return;
    return getRealtimeHub().on('profiles', (change) => {
      if (change.row.id !== meId) return;
      void refresh();
    });
  }, [meId, refresh]);

  /*
   * Signing out is the only thing that closes the socket.
   *
   * The hub deliberately keeps its channel when the last handler detaches,
   * because React unmounts and remounts constantly and rejoining on every empty
   * moment would leave gaps where changes are missed. Sign-out is the one
   * moment it is genuinely unwanted: the token behind it is gone, and holding
   * an authenticated channel open for a session that has ended is exactly the
   * thing nobody ever remembers to clean up.
   */
  useEffect(() => {
    if (signedIn) return;
    getRealtimeHub().close();
  }, [signedIn]);

  return null;
}
