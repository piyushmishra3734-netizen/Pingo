/**
 * PINGO Music's backend, for the screens: the JioSaavn catalogue (`api`), the
 * queue and playback (`playback`), and the person's own library (`library`).
 * The UI is built on these and nothing below them.
 */
export * as music from './api.js';
export * as playback from './playback.js';
export * as library from './library.js';
export type * from './types.js';
