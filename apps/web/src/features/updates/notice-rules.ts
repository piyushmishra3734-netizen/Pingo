/*
 * Kept in its own file, with no imports.
 *
 * It used to live beside the component, and the component pulls in the
 * Supabase client - which reads `import.meta.env` the moment it is loaded.
 * That made the one piece of this worth testing untestable outside a browser:
 * `pnpm verify:update-notice` died on a missing VITE_SUPABASE_URL before it
 * reached a single assertion.
 */

/**
 * Whether a device is behind the published notice.
 *
 * Split out because it is the one piece of this that can be wrong in a way
 * nobody sees: too eager and every up-to-date device gets nagged forever, too
 * lax and the notice never appears at all. `build` is whatever
 * `App.getInfo().build` reported, which on a platform that cannot say is not a
 * number - and a device that cannot state its version is left alone rather
 * than nagged on a guess.
 */
export function isBehind(build: string | undefined, minBuild: number): boolean {
  const code = Number.parseInt(build ?? '', 10);
  return Number.isFinite(code) && code < minBuild;
}

/**
 * Whether the card is shown at all, given who is looking.
 *
 * Two different jobs wear the same card, and the difference is the whole
 * design:
 *
 * - Somebody on an old APK is being asked to *do* something, and nothing else
 *   will ever ask them - there is no store behind a sideloaded build. So the
 *   cross closes it for that launch and it returns on the next one, until the
 *   version on the device says they did it. That is not nagging for its own
 *   sake; it stops by itself, and only they can stop it.
 *
 * - Everybody else - the web, and anyone already on the new build - has
 *   nothing to do. For them it is an announcement, and an announcement that
 *   reappears after it has been read and closed is just a bug with a cross on
 *   it. Seen once, gone.
 *
 * `seen` is the `updated_at` of the last notice this browser dismissed, so
 * publishing a new card shows it again to people who closed the old one -
 * without a second key, and without anything to clean up when it is replaced.
 */
export function shouldShow(behind: boolean, seen: string | null, updatedAt: string): boolean {
  if (behind) return true;
  return seen !== updatedAt;
}
