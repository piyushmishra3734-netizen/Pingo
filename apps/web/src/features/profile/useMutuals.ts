import { useProfile } from '@pingo/core';
import { useEffect, useState } from 'react';

/**
 * The set of people the signed-in user is mutual with.
 *
 * ## Undefined means "not known yet", and callers must respect it
 *
 * An empty set and an unloaded set look the same if you only check `.has()`,
 * and the difference matters: gating on an unloaded set disables every call
 * button for a moment on each render, which reads as the feature being broken
 * rather than as loading. So this returns `undefined` until the answer is real.
 *
 * ## This is convenience, not enforcement
 *
 * The actual gate is in the database - stories are RLS-filtered and snaps go
 * through policies. Hiding a button the server would refuse anyway is the point
 * here: telling someone *why* they cannot call, instead of letting them try and
 * fail.
 */
export function useMutuals(): Set<string> | undefined {
  const { service } = useProfile();
  const [ids, setIds] = useState<Set<string>>();

  useEffect(() => {
    let active = true;
    void service
      .listMutualIds()
      .then((list) => {
        if (active) setIds(new Set(list));
      })
      .catch(() => {
        // An empty set on failure, not `undefined` forever - otherwise a
        // transient error leaves every gated control stuck in loading.
        if (active) setIds(new Set());
      });
    return () => {
      active = false;
    };
  }, [service]);

  return ids;
}
