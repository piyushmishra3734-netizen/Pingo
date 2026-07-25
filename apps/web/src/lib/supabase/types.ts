/**
 * Generated database types — placeholder.
 *
 * No tables exist yet, so this is an empty-but-valid schema shape. It satisfies
 * `createClient<Database>` today, which means adding real types later is a
 * file replacement rather than a change to every call site.
 *
 * When the schema lands, replace this entire file with generated output:
 *
 *   pnpm dlx supabase gen types typescript \
 *     --project-id <project-id> \
 *     --schema public \
 *     > apps/web/src/lib/supabase/types.ts
 *
 * Do not hand-edit the generated file. If a type is wrong, the schema is wrong.
 */

/** The `public` schema. Empty until the first migration. */
export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/**
 * Convenience aliases, ready for when tables exist.
 *
 * With generated types these resolve to real row shapes:
 *   type Profile = Tables<'profiles'>
 */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T] extends { Row: infer R } ? R : never;

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];
