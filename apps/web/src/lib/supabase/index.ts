/**
 * Supabase integration — public surface.
 *
 * Import from `@/lib/supabase`, never from the files inside it, so the internal
 * layout can change without touching consumers.
 *
 * ## Status: auth is live; data is not
 *
 * `SupabaseAuthService` implements `@pingo/core`'s `AuthService` and is injected
 * once in `App.tsx`. No screen or component may import from this directory —
 * see the boundary note in `client.ts`.
 *
 * | Area | Status |
 * | --- | --- |
 * | Auth — Email | **Implemented**, `auth-service.ts`, per docs/01 § 6 · § 8 · § 13 |
 * | Auth — Google · Phone | Not yet. A `google` / `phone` member beside `email` |
 * | Database access | Not yet. `SupabaseChatService implements ChatService` |
 * | Storage (media) | Not yet. Behind the attachment pipeline, per docs/10 |
 * | Realtime | Not yet. Mapped onto `ChatEvent`, per docs/07 § 5 |
 *
 * The client's options were already set up for all of these (PKCE, URL session
 * detection, session persistence, an events-per-second cap), so each remaining
 * row is new code rather than reconfiguration.
 */

export {
  getSupabaseClient,
  isSupabaseConfigured,
  resetSupabaseClient,
  type PingoSupabaseClient,
} from './client.js';

export { SupabaseAuthService } from './auth-service.js';
export { SupabaseProfileService } from './profile-service.js';
export { SupabaseChatService } from './chat-service.js';
export { SupabaseStoryService } from './story-service.js';
export { SupabaseCallService } from './call-service.js';

export type { Database, Enums, Tables } from './types.js';
