/**
 * The Supabase client.
 *
 * Configuration comes **only** from environment variables. Nothing is hard-coded,
 * and there is no fallback to a default project — a missing variable is an error
 * with a clear message, not a silent connection to somewhere unexpected.
 *
 * ---
 *
 * ## Architectural boundary — read before using this
 *
 * `packages/core`'s `ChatService` is the only data boundary in PINGO, and no
 * screen imports a concrete implementation
 * ([docs/01 § 20.2](../../../../../docs/01-onboarding-auth.md#202-architectural-seams-in-packagescore)).
 *
 * So when Supabase starts carrying real data, it goes behind a
 * `SupabaseChatService implements ChatService` in `packages/core`, and screens
 * keep talking to `useChat()`. **This module must not be imported from a screen
 * or a component.** That rule is what keeps the future E2EE upgrade a backend
 * change rather than a rewrite, and it is enforced by lint
 * ([docs/12 § 6.1](../../../../../docs/12-design-governance.md#61-lint-rules)).
 *
 * Legitimate consumers: `packages/core` service implementations, and this
 * directory.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './types.js';

/** A Supabase client typed against our schema. */
export type PingoSupabaseClient = SupabaseClient<Database>;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/**
 * Whether both variables are present.
 *
 * Lets a caller degrade gracefully instead of throwing — useful while the
 * project is only partly wired up, and for tests that should run without a
 * Supabase project.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function assertConfigured(): { url: string; anonKey: string } {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured. Missing ${missing.join(' and ')}.\n` +
        'Copy apps/web/.env.example to apps/web/.env and fill in the values ' +
        'from your Supabase project (Project Settings → API), then restart the ' +
        'dev server — Vite only reads .env at startup.',
    );
  }

  // The checks above narrow these, but TypeScript cannot see it across a helper.
  return { url: SUPABASE_URL as string, anonKey: SUPABASE_ANON_KEY as string };
}

/**
 * Created lazily and cached.
 *
 * Deliberately not a module-scope `createClient(...)`: that would throw on import
 * for anyone who has not set up `.env` yet, breaking the whole app because one
 * unrelated module was pulled into the bundle. Lazy creation means the error
 * surfaces at the point of use, where it can be understood and handled.
 *
 * A single instance matters — more than one client on a page means duplicate
 * realtime sockets and competing auth-token refreshes.
 */
let cached: PingoSupabaseClient | undefined;

/**
 * The shared Supabase client.
 *
 * @throws if either environment variable is missing. Guard with
 * {@link isSupabaseConfigured} where a missing config should not be fatal.
 */
export function getSupabaseClient(): PingoSupabaseClient {
  if (cached) return cached;

  const { url, anonKey } = assertConfigured();

  cached = createClient<Database>(url, anonKey, {
    auth: {
      // Keep the session across reloads and restore it on launch.
      persistSession: true,
      // Refresh before expiry so a long-lived session never 401s mid-use.
      autoRefreshToken: true,
      /*
       * Required for the OAuth redirect flow. Google sign-in returns to the app
       * with credentials in the URL, and this consumes and clears them
       * (docs/01 § 5).
       */
      detectSessionInUrl: true,
      /*
       * PKCE, not implicit flow. The implicit flow puts tokens in the URL
       * fragment where they can leak via history, referrers and logs. PKCE is
       * the correct choice for a browser client and is required by some
       * providers — setting it now avoids a migration when auth lands.
       */
      flowType: 'pkce',
      // Namespaced so it cannot collide with anything else on the origin.
      storageKey: 'pingo.auth.session',
    },

    realtime: {
      /*
       * Cap inbound events. PINGO is push-driven with no polling
       * (docs/11 § 6.1), but a busy community channel could still flood a
       * mobile client; this bounds the work per second.
       */
      params: { eventsPerSecond: 10 },
    },

    global: {
      // Identifies our traffic in Supabase logs without carrying user data.
      headers: { 'x-pingo-client': 'web' },
    },
  });

  return cached;
}

/**
 * Drops the cached instance.
 *
 * For tests and for a full sign-out that should abandon realtime subscriptions.
 * Production code should not need this — the client is meant to be long-lived.
 */
export function resetSupabaseClient(): void {
  cached = undefined;
}
