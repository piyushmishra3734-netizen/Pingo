import type { PresenceState } from '@pingo/core';
import { useEffect, useState } from 'react';

import { getSupabaseClient } from '../../lib/supabase/client.js';
import {
  cachePresenceStatus,
  cachePrivacyRules,
  presenceStatus,
  type PresenceStatus,
} from '../settings/privacy-flags.js';

/**
 * Reading and writing online / invisible / do not disturb.
 *
 * One status everybody sees, and two columns that follow it for enforcement -
 * see `PresenceStatus`.
 */

async function signedInUserId(): Promise<string | undefined> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.user.id;
}

/**
 * Asks the server which one this account is on, and caches the answer.
 *
 * Called at start-up and whenever this account's privacy row changes - which
 * every save touches, so another of this person's devices hears about it.
 */
export async function refreshPresenceStatus(): Promise<PresenceStatus | undefined> {
  const userId = await signedInUserId();
  if (!userId) return undefined;

  const { data, error } = await getSupabaseClient()
    .from('privacy_settings')
    .select('online_status,presence_status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return undefined;

  // No row means the default, online. `online_status` decides whether there is
  // a status at all and `presence_status` only which - see `shownStatus` in the
  // chat service for why that order.
  const status: PresenceStatus =
    data?.online_status === false
      ? data.presence_status === 'dnd'
        ? 'dnd'
        : 'invisible'
      : 'online';
  cachePresenceStatus(status);
  return status;
}

/**
 * Saves a status. Throws if either half did not land.
 *
 * Do not disturb goes first. The privacy row is the half other devices of this
 * account hear about, live, and they re-read both halves when it arrives - so
 * the half they cannot hear about has to be in place before it. The privacy row
 * is written even when `online_status` does not change (invisible to do not
 * disturb and back), because writing it is the announcement.
 */
export async function savePresenceStatus(status: PresenceStatus): Promise<void> {
  const userId = await signedInUserId();
  if (!userId) throw new Error('Not signed in.');

  const client = getSupabaseClient();

  const prefs = await client
    .from('notification_prefs')
    .upsert({ user_id: userId, dnd: status === 'dnd' }, { onConflict: 'user_id' });
  if (prefs.error) throw prefs.error;

  const privacy = await client
    .from('privacy_settings')
    .upsert(
      { user_id: userId, online_status: status === 'online', presence_status: status },
      { onConflict: 'user_id' },
    );
  if (privacy.error) throw privacy.error;

  // Presence channel and heartbeat stop or start on this, within the tap.
  cachePrivacyRules({ onlineStatus: status === 'online' });
  cachePresenceStatus(status);
}

/** The cached status, kept current for anything drawing it. */
export function usePresenceStatus(): PresenceStatus {
  const [status, setStatus] = useState(presenceStatus);

  useEffect(() => {
    const onChange = () => setStatus(presenceStatus());
    window.addEventListener('pingo:presence-status', onChange);
    return () => window.removeEventListener('pingo:presence-status', onChange);
  }, []);

  return status;
}

/**
 * The mark to draw on somebody's avatar. The breathing dot only while they are
 * actually here; the moon and the bar whenever they have chosen them.
 */
export function presenceMark(state: PresenceState | undefined): PresenceStatus | undefined {
  return state === 'online' || state === 'invisible' || state === 'dnd' ? state : undefined;
}

/**
 * The operator's own last-seen line.
 *
 * On: everybody reads "last seen <text>" for this account, and underneath it
 * is invisible - no dot, no read receipts (they follow the status), and no
 * typing (presence.ts checks `customLastSeen`). Off: back to the status that
 * was on before. Only the operator's id is allowed a value by the database.
 */
const CUSTOM_KEY = 'pingo:custom-last-seen';
const CUSTOM_BEFORE_KEY = 'pingo:custom-last-seen-before';

export function customLastSeen(): string | null {
  try {
    return localStorage.getItem(CUSTOM_KEY);
  } catch {
    return null;
  }
}

export async function saveCustomLastSeen(text: string | null): Promise<void> {
  const userId = await signedInUserId();
  if (!userId) throw new Error('Not signed in.');
  const value = text?.trim().slice(0, 48) || null;

  if (value) {
    try {
      if (!customLastSeen()) localStorage.setItem(CUSTOM_BEFORE_KEY, presenceStatus());
    } catch {
      // Nothing to restore to later but online.
    }
    await savePresenceStatus('invisible');
  }

  const { error } = await getSupabaseClient()
    .from('privacy_settings')
    .upsert({ user_id: userId, custom_last_seen: value }, { onConflict: 'user_id' });
  if (error) throw error;

  try {
    if (value) {
      localStorage.setItem(CUSTOM_KEY, value);
    } else {
      localStorage.removeItem(CUSTOM_KEY);
      const before = localStorage.getItem(CUSTOM_BEFORE_KEY);
      localStorage.removeItem(CUSTOM_BEFORE_KEY);
      await savePresenceStatus(before === 'invisible' || before === 'dnd' ? before : 'online');
    }
  } catch (cause) {
    if (!value) throw cause;
  }
}
