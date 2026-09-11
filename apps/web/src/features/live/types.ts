/**
 * Live domain model (web-side).
 *
 * Transport-agnostic like everything in the product: the UI renders these,
 * `SupabaseLiveService` builds them from rows. Timestamps are epoch ms.
 */

export interface LiveStream {
  id: string;
  hostId: string;
  hostName: string;
  hostUsername: string;
  hostAvatarUrl?: string;
  status: 'live' | 'ended';
  title: string;
  viewerCount: number;
  peakViewers: number;
  totalJoins: number;
  likesCount: number;
  startedAt: number;
  endedAt?: number;
  /** Shared hearts goal. Absent target means the host set none. */
  goalTarget?: number;
  goalTitle?: string;
}

export interface LiveComment {
  id: string;
  liveId: string;
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  body: string;
  createdAt: number;
}

/** A heart burst travelling over the broadcast channel. Ephemeral, like IG. */
export interface LiveHeart {
  id: string;
  userId: string;
  userName: string;
  at: number;
  /** Viewport-relative tap point, 0-1. The burst blooms where the finger fell. */
  x?: number;
  y?: number;
}

/** A seat on the broadcast: requested, invited, on air, or gone. */
export interface LiveGuest {
  liveId: string;
  userId: string;
  userName: string;
  userAvatarUrl?: string;
  status: 'requested' | 'invited' | 'joined' | 'declined' | 'left' | 'removed';
}

/** Someone walked in. Faint system line over the picture, like IG. */
export interface LivePresenceEvent {
  id: string;
  userName: string;
  at: number;
}
