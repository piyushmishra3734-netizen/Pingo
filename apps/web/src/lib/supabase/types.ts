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
  /** Free text, up to 200 characters. Null and empty both mean "not set". */
  bio: string | null;
  created_at: string;
  updated_at: string;
};

/** One row of `public.posts`. Three per author, enforced by a trigger. */
export type PostRow = {
  id: string;
  author_id: string;
  /** A path in the private `posts` bucket, never a URL. */
  image_path: string;
  caption: string | null;
  created_at: string;
  updated_at: string;
};

/** One row of `public.post_comments`. */
export type PostCommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
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
  favorite: boolean;
  /** Null is unmuted; a timestamp is until then; Postgres infinity is always. */
  muted_until: string | null;
  /** Out of the main list. Per member — the other side's copy does not move. */
  archived_at: string | null;
  /** Deliberately unread, which no read cursor can express. */
  marked_unread: boolean;
  /** Messages at or before this are hidden from this member. */
  cleared_at: string | null;
  /** The row is hidden until something newer than this arrives. */
  deleted_at: string | null;
};

/** One row of `public.messages`. */
export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  kind:
    | 'text' | 'sticker' | 'snap' | 'photo' | 'voice'
    | 'document' | 'location' | 'contact' | 'event' | 'call';
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime: string | null;
  /** Shape depends on kind. See the attachments migration. */
  meta: Record<string, unknown> | null;
  voice_path: string | null;
  voice_duration: number | null;
  voice_waveform: number[] | null;
  /** Storage path of a photo. Null for every other kind. */
  photo_path: string | null;
  /** Opens allowed per recipient. Null is unlimited. */
  view_limit: number | null;
  /** The sticker image. Null for text messages. */
  media_url: string | null;
  /** Storage path of a snap's image. Nulled out when the snap is destroyed. */
  snap_path: string | null;
  snap_expires_at: string | null;
  /** Set when the media is gone for good; the row itself stays in the thread. */
  snap_consumed_at: string | null;
  /** Soft delete. The row stays so replies that quote it keep their anchor. */
  deleted_at: string | null;
  reply_to_id: string | null;
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
          favorite?: boolean;
        };
        Update: {
          last_read_at?: string;
          pinned?: boolean;
          favorite?: boolean;
          muted_until?: string | null;
          archived_at?: string | null;
          marked_unread?: boolean;
          cleared_at?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      chat_lists: {
        Row: { id: string; owner_id: string; name: string; created_at: string };
        Insert: { owner_id: string; name: string };
        Update: { name?: string };
        Relationships: [];
      };
      chat_list_members: {
        Row: { list_id: string; conversation_id: string };
        Insert: { list_id: string; conversation_id: string };
        Update: Record<string, never>;
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
      message_reactions: {
        Row: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: { message_id: string; user_id: string; emoji: string };
        Update: { emoji?: string };
        Relationships: [];
      };
      hidden_messages: {
        Row: { message_id: string; user_id: string };
        Insert: { message_id: string; user_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      starred_messages: {
        Row: { message_id: string; user_id: string; created_at: string };
        Insert: { message_id: string; user_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      pinned_messages: {
        Row: {
          message_id: string;
          conversation_id: string;
          pinned_by: string;
          created_at: string;
        };
        Insert: { message_id: string; conversation_id: string; pinned_by: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      message_reminders: {
        Row: {
          id: string;
          message_id: string;
          user_id: string;
          remind_at: string;
          delivered_at: string | null;
        };
        Insert: { message_id: string; user_id: string; remind_at: string };
        Update: { delivered_at?: string | null };
        Relationships: [];
      };
      message_reports: {
        Row: {
          id: string;
          message_id: string;
          reporter_id: string;
          created_at: string;
        };
        Insert: { message_id: string; reporter_id: string };
        Update: Record<string, never>;
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
          kind?:
            | 'text' | 'sticker' | 'snap' | 'photo' | 'voice'
            | 'document' | 'location' | 'contact' | 'event' | 'call';
          file_path?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          file_mime?: string | null;
          meta?: Record<string, unknown> | null;
          voice_path?: string | null;
          voice_duration?: number | null;
          voice_waveform?: number[] | null;
          photo_path?: string | null;
          view_limit?: number | null;
          media_url?: string | null;
          snap_path?: string | null;
          snap_expires_at?: string | null;
          reply_to_id?: string | null;
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
          bio?: string | null;
        };
        Update: {
          username?: string;
          display_name?: string;
          avatar_url?: string | null;
          bio?: string | null;
        };
        Relationships: [];
      };
      posts: {
        Row: PostRow;
        Insert: { author_id: string; image_path: string; caption?: string | null };
        Update: { image_path?: string; caption?: string | null };
        Relationships: [];
      };
      post_likes: {
        Row: { post_id: string; user_id: string; created_at: string };
        Insert: { post_id: string; user_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      post_saves: {
        Row: { post_id: string; user_id: string; created_at: string };
        Insert: { post_id: string; user_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      post_comments: {
        Row: PostCommentRow;
        Insert: { post_id: string; author_id: string; body: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      blocks: {
        Row: { blocker_id: string; blocked_id: string; created_at: string };
        Insert: { blocker_id: string; blocked_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          subject_user_id: string | null;
          subject_post_id: string | null;
          reason: string;
          details: string | null;
          created_at: string;
        };
        Insert: {
          reporter_id: string;
          subject_user_id?: string | null;
          subject_post_id?: string | null;
          reason: string;
          details?: string | null;
        };
        Update: Record<string, never>;
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
      /** Newest message and unread count per conversation, for this user only. */
      conversation_previews: {
        Args: Record<string, never>;
        Returns: {
          conversation_id: string;
          last_message_id: string | null;
          unread_count: number;
          archived_at: string | null;
          deleted: boolean;
          muted: boolean;
          muted_until: string | null;
        }[];
      };
      /** Streak days per direct conversation, for the signed-in user only. */
      unread_notifications: { Args: Record<string, never>; Returns: number };
      mark_notifications_read: { Args: Record<string, never>; Returns: undefined };
      /** Add, swap or remove in one statement — see the reactions migration. */
      toggle_reaction: { Args: { target: string; symbol: string }; Returns: undefined };
      /** Both enforce the 15-minute window server-side. */
      edit_message: { Args: { target: string; new_body: string }; Returns: undefined };
      delete_message: { Args: { target: string; for_everyone: boolean }; Returns: undefined };
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
      /** Spends one view of a limited photo; unlimited ones never reach here. */
      open_photo: {
        Args: { target: string };
        Returns: { path: string; views_left: number | null }[];
      };
      /** Records the download and destroys the server copy. */
      download_snap: {
        Args: { snap_id: string };
        Returns: undefined;
      };
      /** Posts, friends and groups for one person. Works for anyone. */
      profile_stats: {
        Args: { target: string };
        Returns: { posts: number; friends: number; groups: number }[];
      };
      /** History between the caller and one other person. Never about two others. */
      shared_with: {
        Args: { other: string };
        Returns: {
          friends_since: string | null;
          mutual_groups: number;
          photos_shared: number;
        }[];
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
