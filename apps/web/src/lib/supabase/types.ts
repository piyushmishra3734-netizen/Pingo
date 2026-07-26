/**
 * Database types.
 *
 * Hand-written to match `supabase/migrations/20260725190000_profiles.sql`. When
 * the schema grows past one table, replace this file wholesale with generated
 * output rather than extending it by hand:
 *
 *   pnpm dlx supabase gen types typescript \
 *     --project-id lppzoqgvshhmxqsvggug \
 *     --schema public \
 *     > apps/web/src/lib/supabase/types.ts
 *
 * If a type here is wrong, the migration is the source of truth — fix the
 * schema, not the type.
 *
 * ## Everything here is a `type`, never an `interface`
 *
 * postgrest-js constrains the schema to `Record<string, GenericTable>`, and an
 * `interface` does not satisfy an index-signature constraint — only a type alias
 * gets an implicit one. Declare any of these as an interface and the constraint
 * silently fails, every table resolves to `never`, and `insert()` starts
 * reporting "'id' does not exist in type 'never[]'" from deep inside the
 * library. Supabase's own generator emits type aliases for exactly this reason.
 */

/** One row of `public.profiles`. */
export type ProfileRow = {
  id: string;
  /** Always lowercase, 3–20 of `[a-z0-9_]`. Enforced by a check constraint. */
  username: string;
  display_name: string;
  /** Null means the monogram, which is a real default rather than a gap. */
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

/** One row of `public.conversations`. */
export type ConversationRow = {
  id: string;
  kind: 'direct' | 'group' | 'community';
  /** Groups only. A direct chat's title is resolved per viewer. */
  title: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
};

/** One row of `public.conversation_members`. Per-person state lives here. */
export type ConversationMemberRow = {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  /** Everything after this instant is unread. */
  last_read_at: string;
  pinned: boolean;
  muted: boolean;
  favorite: boolean;
};

/** One row of `public.messages`. */
export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  kind: 'text' | 'sticker' | 'snap';
  /** The sticker image. Null for text messages. */
  media_url: string | null;
  /** Storage path of a snap's image. Nulled out when the snap is destroyed. */
  snap_path: string | null;
  snap_expires_at: string | null;
  /** Set when the media is gone for good; the row itself stays in the thread. */
  snap_consumed_at: string | null;
};

/** The `public` schema. */
export type Database = {
  public: {
    Tables: {
      conversations: {
        Row: ConversationRow;
        Insert: {
          id?: string;
          kind?: 'direct' | 'group' | 'community';
          title?: string | null;
          created_by?: string | null;
        };
        Update: {
          title?: string | null;
          last_message_at?: string;
        };
        Relationships: [];
      };
      conversation_members: {
        Row: ConversationMemberRow;
        Insert: {
          conversation_id: string;
          user_id: string;
          last_read_at?: string;
          pinned?: boolean;
          muted?: boolean;
          favorite?: boolean;
        };
        Update: {
          last_read_at?: string;
          pinned?: boolean;
          muted?: boolean;
          favorite?: boolean;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          actor_id: string | null;
          kind: 'follow_request' | 'follow_accepted' | 'message' | 'snap' | 'story';
          subject_id: string | null;
          created_at: string;
          read_at: string | null;
        };
        Insert: { user_id: string; kind: string };
        Update: { read_at?: string | null };
        Relationships: [];
      };
      follows: {
        Row: {
          follower_id: string;
          followee_id: string;
          status: 'pending' | 'accepted';
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          follower_id: string;
          followee_id: string;
          status?: 'pending' | 'accepted';
        };
        Update: {
          status?: 'pending' | 'accepted';
          responded_at?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          kind?: 'text' | 'sticker' | 'snap';
          media_url?: string | null;
          snap_path?: string | null;
          snap_expires_at?: string | null;
        };
        Update: {
          body?: string;
          edited_at?: string | null;
        };
        Relationships: [];
      };
      stories: {
        Row: {
          id: string;
          author_id: string;
          media_url: string;
          created_at: string;
          expires_at: string;
        };
        Insert: { author_id: string; media_url: string };
        Update: { media_url?: string };
        Relationships: [];
      };
      story_views: {
        Row: { story_id: string; viewer_id: string; viewed_at: string };
        Insert: { story_id: string; viewer_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        // `created_at` / `updated_at` are defaulted, so an insert omits them.
        Insert: {
          id: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
        };
        Update: {
          username?: string;
          display_name?: string;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
    };
    /* Empty groups, in the shape the generator emits. */
    Views: { [_ in never]: never };
    Functions: {
      /** Idempotent: returns the existing direct conversation, or makes one. */
      start_direct_conversation: {
        Args: { other_user: string };
        Returns: string;
      };
      /** Streak days per direct conversation, for the signed-in user only. */
      unread_notifications: { Args: Record<string, never>; Returns: number };
      mark_notifications_read: { Args: Record<string, never>; Returns: undefined };
      my_streaks: {
        Args: Record<string, never>;
        Returns: { conversation_id: string; streak: number }[];
      };
      /**
       * Spends one of the viewer's two views. Returns nothing once they are
       * used up, the snap was downloaded, or it expired.
       */
      open_snap: {
        Args: { snap_id: string };
        Returns: { path: string; views_left: number }[];
      };
      /** Records the download and destroys the server copy. */
      download_snap: {
        Args: { snap_id: string };
        Returns: undefined;
      };
      /** Deletes every expired snap. Returns how many went. */
      purge_expired_snaps: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

/**
 * Convenience aliases.
 *
 *   type Profile = Tables<'profiles'>
 */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T] extends { Row: infer R } ? R : never;

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];
