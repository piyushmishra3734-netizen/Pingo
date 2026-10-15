import { Capacitor, registerPlugin } from '@capacitor/core';

import { getSupabaseClient } from '../../lib/supabase/client.js';

/**
 * The phone's notification tray, for chats.
 *
 * On Android the app draws chat notifications itself (`ChatNotifier.java`):
 * WhatsApp-style, one per chat, with Reply and Mark as read that work with the
 * app closed. This file is the page's half of that:
 *
 * - `armPushActions` gives the phone what those buttons need: the server's
 *   address and a random per-device action key. Only the key's SHA-256 goes
 *   to the server (`set_push_action_key`); `push-action` checks it.
 * - `setOpenChat` tells the phone which chat is on screen.
 * - `clearChatTray` takes a chat's notification down once it has been read,
 *   on Android and in the browser alike.
 */

interface PushActionsPlugin {
  configure(options: { url: string; anonKey: string; key: string }): Promise<void>;
  setOpenChat(options: { conversationId: string }): Promise<void>;
  clearChat(options: { conversationId: string }): Promise<void>;
}

const plugin = registerPlugin<PushActionsPlugin>('PushActions');

const KEY_STORE = 'pingo:push-action-key';

const nativeTray = (): boolean => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('PushActions');

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** After a token is registered: arm this device's notification buttons. Android only; quiet on failure. */
export async function armPushActions(token: string): Promise<void> {
  if (!nativeTray()) return;
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return;
  try {
    let key: string | null = null;
    try {
      key = localStorage.getItem(KEY_STORE);
    } catch {
      /* private storage unavailable: a fresh key each launch still works */
    }
    if (!key || key.length < 64) {
      key = randomKey();
      try {
        localStorage.setItem(KEY_STORE, key);
      } catch {
        /* see above */
      }
    }
    const { error } = await getSupabaseClient().rpc('set_push_action_key', { p_token: token, p_hash: await sha256Hex(key) });
    // Before the migration the call does not exist; the phone then keeps the plain notifications.
    if (error) return;
    await plugin.configure({ url, anonKey, key });
  } catch (cause) {
    console.warn('[pingo/push] could not arm notification actions', cause);
  }
}

/** The chat on screen, or none. Its notification is taken down as it opens. */
export function setOpenChat(conversationId: string | undefined): void {
  if (!nativeTray()) return;
  void plugin.setOpenChat({ conversationId: conversationId ?? '' }).catch(() => undefined);
}

/** A chat was read here: its tray entry goes, whatever drew it. */
export function clearChatTray(conversationId: string): void {
  if (nativeTray()) void plugin.clearChat({ conversationId }).catch(() => undefined);
  void clearWebTray(conversationId);
  void clearCapacitorTray(conversationId);
}

/** The browser's: the Firebase worker tags a chat's notification `chat:<id>`. */
async function clearWebTray(conversationId: string): Promise<void> {
  if (Capacitor.isNativePlatform() || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const shown = await registration.getNotifications({ tag: `chat:${conversationId}` });
      shown.forEach((n) => n.close());
    }
  } catch {
    /* nothing showing, or not allowed to look */
  }
}

/** The plain notifications an older server sent (tagged per chat, or per sender before that). */
async function clearCapacitorTray(conversationId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { notifications } = await PushNotifications.getDeliveredNotifications();
    const stale = notifications.filter((n) => {
      const data = (n.data ?? {}) as Record<string, unknown>;
      return n.tag === `chat:${conversationId}` || data.subjectId === conversationId;
    });
    if (stale.length) await PushNotifications.removeDeliveredNotifications({ notifications: stale });
  } catch {
    /* nothing to clear */
  }
}
