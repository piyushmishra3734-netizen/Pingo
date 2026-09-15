/**
 * Where the signalling Worker lives (apps/arcade/worker).
 *
 * The deployed Worker by default - dev included - so two phones on any
 * network can find each other without anyone running a server. Point
 * `VITE_SIGNAL_URL` at `ws://localhost:8787` to test against `wrangler dev`.
 */
export const SIGNAL_URL =
  import.meta.env.VITE_SIGNAL_URL ?? 'wss://pingo-arcade-signal.dubesminecraft.workers.dev';
