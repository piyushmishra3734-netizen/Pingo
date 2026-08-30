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
