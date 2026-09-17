import { publicAppUrl } from '../../lib/public-origin.js';

/**
 * PINGO Arcade, as PINGO sees it: where the game is hosted, and the invite a
 * friend receives.
 *
 * ## An invite is an ordinary message
 *
 * It goes out as text with a `/arcade?room=…` link in it, so it rides the
 * message path that already exists - delivery, unread counts, the push
 * notification - with nothing new on the server. `MessageBubble` recognises the
 * link and draws a Join card in place of the text; an older app that does not
 * know the card still shows a working link.
 */

/** The arcade itself, a separate static site loaded in a frame. */
export const ARCADE_URL = ((typeof import.meta.env === 'undefined' ? undefined : import.meta.env.VITE_ARCADE_URL) as string | undefined) ?? 'https://pingo-arcade.pages.dev/';

/** The arcade's origin, the only one whose messages the frame host believes. */
export const ARCADE_ORIGIN = new URL(ARCADE_URL).origin;

/** Must match the arcade's own rule (apps/arcade/src/net/room-id.js). */
const ROOM_ID = /^[a-z0-9]{6,32}$/;

export interface ArcadeInvite {
  room: string;
  /** The seat the friend should take. */
  seat: 'A' | 'B';
  /** Who invited them. */
  from: string;
}

export function arcadeInviteLink({ room, seat, from }: ArcadeInvite): string {
  const params = new URLSearchParams({ room, seat, from: from.slice(0, 18) });
  return publicAppUrl(`/arcade?${params.toString()}`);
}

export function arcadeInviteBody(invite: ArcadeInvite): string {
  return `${invite.from} invited you to play in PINGO Arcade!\n${arcadeInviteLink(invite)}`;
}

/** The invite in a message body, if that is what it is. */
export function parseArcadeInvite(body: string): ArcadeInvite | undefined {
  const match = /https?:\/\/\S+\/arcade\?\S+/.exec(body);
  if (!match) return undefined;
  try {
    return inviteFromSearch(new URL(match[0]).search);
  } catch {
    return undefined;
  }
}

export function inviteFromSearch(search: string): ArcadeInvite | undefined {
  const params = new URLSearchParams(search);
  const room = params.get('room') ?? '';
  if (!ROOM_ID.test(room)) return undefined;
  return { room, seat: params.get('seat') === 'A' ? 'A' : 'B', from: (params.get('from') ?? '').slice(0, 18) };
}
