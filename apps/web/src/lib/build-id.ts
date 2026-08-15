/**
 * Which build this bundle is.
 *
 * Injected by Vite from `CF_PAGES_COMMIT_SHA` on a Pages deploy, from git on a
 * local build, and `dev` when neither is available - see `vite.config.ts`.
 *
 * It exists to answer one question that could not be answered when it mattered:
 * a deploy was live for fifteen hours while the fleet kept running the previous
 * bundle, and every measurement taken in that window was measuring old code.
 * A seven-character commit hash reported alongside a row that already exists
 * makes that visible; it says nothing about the person running it.
 */
declare const __BUILD_ID__: string;

export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : 'dev';
