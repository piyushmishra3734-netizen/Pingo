/// <reference types="vite/client" />

/**
 * Typed environment variables.
 *
 * Declared optional on purpose. These come from a `.env` file that is not in the
 * repository, so at compile time we genuinely do not know whether they are set —
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
   * Supabase anonymous key. Public by design — it grants only what Row Level
   * Security allows. The `service_role` key must never be used here.
   */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
