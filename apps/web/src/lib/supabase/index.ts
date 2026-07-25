/**
 * Supabase integration — public surface.
 *
 * Import from `@/lib/supabase`, never from the files inside it, so the internal
 * layout can change without touching consumers.
 *
 * ## Status: wired, not used
 *
 * The client is configured and ready. Nothing calls it yet, and no screen or
 * component may import it — Supabase belongs behind a `ChatService`
 * implementation in `packages/core`. See the boundary note in `client.ts`.
 *
 * Not implemented yet, by design:
 *
 * | Area | Where it will live |
 * | --- | --- |
 * | Auth (Google · Email · Phone) | `packages/core` session service, per docs/01 |
 * | Database access | `SupabaseChatService implements ChatService` |
 * | Storage (media) | Behind the attachment pipeline, per docs/10 |
 * | Realtime | Mapped onto `ChatEvent`, per docs/07 § 5 |
 *
 * The client's auth and realtime options are already set up for all four
 * (PKCE, URL session detection, session persistence, an events-per-second cap),
 * so enabling each is new code rather than reconfiguration.
 */

export {
  getSupabaseClient,
  isSupabaseConfigured,
  resetSupabaseClient,
  type PingoSupabaseClient,
} from './client.js';

export type { Database, Enums, Tables } from './types.js';
