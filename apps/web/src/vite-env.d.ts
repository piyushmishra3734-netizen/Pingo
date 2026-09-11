/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite/client" />

/**
 * Typed environment variables.
 *
 * Declared optional on purpose. These come from a `.env` file that is not in the
 * repository, so at compile time we genuinely do not know whether they are set  - 
 * and typing them as `string` would let code assume a value that may be missing
 * at runtime. The optional type forces the validation in
 * `lib/supabase/client.ts` to exist.
 *
 * Only `VITE_`-prefixed variables are exposed to the browser bundle by Vite. Any
 * secret must therefore never carry that prefix.
 */
interface ImportMetaEnv {
  /** Supabase project URL, e.g. `https://xxxx.supabase.co`. */
  readonly VITE_SUPABASE_URL?: string;
  /**
   * Supabase anonymous key. Public by design - it grants only what Row Level
   * Security allows. The `service_role` key must never be used here.
   */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /**
   * Canonical public site origin for shareable links (group invites, profiles).
   * When unset, non-public hosts (localhost / Capacitor) fall back to
   * https://pingochat.xyz.
   */
  readonly VITE_PUBLIC_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** `gifenc` ships no types. Only the three calls `cover-gif.ts` makes. */
declare module 'gifenc' {
  export type Palette = number[][];
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: Record<string, unknown>,
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: string,
  ): Uint8Array;
  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: Palette; delay?: number; repeat?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): Encoder;
}
