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
 * If a type here is wrong, the migration is the source of truth - fix the
 * schema, not the type.
 *
 * ## Everything here is a `type`, never an `interface`
 *
 * postgrest-js constrains the schema to `Record<string, GenericTable>`, and an
 * `interface` does not satisfy an index-signature constraint - only a type alias
 * gets an implicit one. Declare any of these as an interface and the constraint
 * silently fails, every table resolves to `never`, and `insert()` starts
 * reporting "'id' does not exist in type 'never[]'" from deep inside the
 * library. Supabase's own generator emits type aliases for exactly this reason.
 */

/** One row of `public.profiles`. */
export type ProfileRow = {
  id: string;
  /** Always lowercase, 3-20 of `[a-z0-9_]`. Enforced by a check constraint. */
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
  /**
   * Display-only offset added to the real `post_likes` count. Operators set it
   * in SQL; clients cannot raise it. Product logic never reads this.
   */
  likes_display_seed?: number;
};

/** One row of `public.stories`. */
export type StoryRow = {
  id: string;
  author_id: string;
  /**
   * The public URL rows were written with before the bucket became private.
   *
   * Still read as a fallback: a handful of stories predate `media_path`, and a
   * branch that disappears on its own within a day is cheaper than a data
   * migration that has to be right the first time.
   */
  media_url: string;
  /** A path in the private `stories` bucket. Signed on read. */
  media_path: string | null;
  kind: string;
  caption: string | null;
  audience: string;
  location: string | null;
  link_url: string | null;
  created_at: string;
  expires_at: string;
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
  kind: 'direct' | 'group' | 'community' | 'ai';
  /** Groups only. A direct chat's title is resolved per viewer. */
  title: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
  /** Groups only. A direct chat wears whoever else is in it. */
  avatar_url: string | null;
  /** Group/community bio. */
  description?: string | null;
  /** Wide cover on group info. */
  cover_url?: string | null;
  /** Shared wallpaper preset for group/community chats. Optional until migration. */
  wallpaper_id?: string | null;
  /** Public URL of a shared custom wallpaper photo (groups only). */
  wallpaper_photo_url?: string | null;
  /** Seconds a new message lives here. Null is off. See the disappearing migration. */
  disappear_seconds?: number | null;
};

/** One row of `public.conversation_members`. Per-person state lives here. */
export type ConversationMemberRow = {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  /** Everything after this instant is unread. */
  last_read_at: string;
  /** Groups only. Members are plain everywhere else. */
  role: 'member' | 'admin';
  pinned: boolean;
  favorite: boolean;
  /** Null is unmuted; a timestamp is until then; Postgres infinity is always. */
  muted_until: string | null;
  /** Out of the main list. Per member - the other side's copy does not move. */
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
    | 'document' | 'location' | 'contact' | 'event' | 'call'
    | 'system';
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
  /**
   * When the server's copy of this message's media was deleted.
   *
   * The path columns are nulled at the same moment, so this is the only thing
   * left saying the row ever carried a photo, a document or a voice note. The
   * bubble needs to know: the copy on this device is still there, and it is
   * the one the whole lifecycle exists to leave behind.
   */
  media_purged_at: string | null;
  /** Storage path of a snap's image. Nulled out when the snap is destroyed. */
  snap_path: string | null;
  snap_expires_at: string | null;
  /** When this message empties itself. Null when the conversation has no timer. */
  expires_at?: string | null;
  /** Set when the media is gone for good; the row itself stays in the thread. */
  snap_consumed_at: string | null;
  /** Soft delete. The row stays so replies that quote it keep their anchor. */
  deleted_at: string | null;
  reply_to_id: string | null;
  /**
   * Moved by a trigger on every update, so one cursor can find both new
   * messages and edited old ones. See the delta sync in chat-service.
   */
  updated_at: string;
  /**
   * Null on every message that existed before E2EE, and `'v1'` after.
   *
   * A column rather than a guess at the content. "Does this body look like
   * base64?" misfires on a message that happens to, and the failure is
   * somebody's chat rendering as garbage.
   */
  encryption: string | null;
  /** Ephemeral public key and one wrapped content key per device. */
  envelope: {
    epk: string;
    iv: string;
    keys: Record<string, { iv: string; key: string }>;
  } | null;
};

/** One row per device, holding the public half only. World-readable by design. */
export type DeviceKeyRow = {
  device_id: string;
  user_id: string;
  /** SPKI, base64. */
  public_key: string;
  created_at: string;
  last_seen_at: string;
  /** What the device calls itself. Null on rows published before labels existed. */
  label?: string | null;
  /** Commit hash of the bundle it last ran. Rollout measurement only. */
  build?: string | null;
};

/** A device thrown off this account. Its id can never publish a key again. */
export type RevokedDeviceRow = {
  device_id: string;
  user_id: string;
  revoked_at: string;
};

/** Per-user prefs for the AI person in Chats. */
export type AiProfileRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  /** Full-bleed cover behind the face on the AI profile card. */
  banner_url: string | null;
  /** How they appear to this user; falls back to the global public bio. */
  bio: string | null;
  personality: string;
  custom_personality: string | null;
  response_length: 'short' | 'balanced' | 'detailed';
  preferred_name: string | null;
  age: number | null;
  language: string | null;
  country: string | null;
  memory_enabled: boolean;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The `public` schema. */
export type Database = {
  public: {
    Tables: {
      onboarding_slides: {
        Row: {
          slide_index: number;
          variant: 'desktop' | 'mobile';
          storage_path: string;
          content_type: string | null;
          updated_at: string;
        };
        Insert: {
          slide_index: number;
          variant: 'desktop' | 'mobile';
          storage_path: string;
          content_type?: string | null;
          updated_at?: string;
        };
        Update: {
          storage_path?: string;
          content_type?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_splash: {
        Row: {
          variant: 'desktop' | 'mobile';
          storage_path: string;
          content_type: string | null;
          updated_at: string;
        };
        Insert: {
          variant: 'desktop' | 'mobile';
          storage_path: string;
          content_type?: string | null;
          updated_at?: string;
        };
        Update: {
          storage_path?: string;
          content_type?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_profiles: {
        Row: AiProfileRow;
        Insert: Partial<AiProfileRow> & { user_id: string };
        Update: Partial<AiProfileRow>;
        Relationships: [];
      };
      ai_memories: {
        Row: {
          id: string;
          user_id: string;
          key: string;
          value: string;
          created_at: string;
        };
        Insert: { user_id: string; key: string; value: string };
        Update: { key?: string; value?: string };
        Relationships: [];
      };
      conversations: {
        Row: ConversationRow;
        Insert: {
          id?: string;
          kind?: 'direct' | 'group' | 'community' | 'ai';
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
          /**
           * Every kind the check constraint allows, not only the first five.
           *
           * This union was written when there were five and never widened, so
           * `voice`, `call`, `mention` and the rest arrived as rows the type
           * said could not exist - which the mapping code got away with only
           * because it looks its copy up in a `Record<string, …>`.
           */
          kind:
            | 'follow_request'
            | 'follow_accepted'
            | 'message'
            | 'voice'
            | 'snap'
            | 'ping_opened'
            | 'ping_replayed'
            | 'story'
            | 'story_reply'
            | 'call'
            | 'mention'
            | 'like'
            | 'comment'
            | 'ai'
            | 'journey'
            | 'marketing'
            | 'new_device';
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
          encryption?: string | null;
          envelope?: MessageRow['envelope'];
        };
        Update: {
          body?: string;
          edited_at?: string | null;
          /* An edit replaces the ciphertext; the recipients have not changed,
           * so it may replace the envelope too. */
          encryption?: string | null;
          envelope?: MessageRow['envelope'];
          /**
           * A live group-call entry becoming history.
           *
           * `meta` is plaintext structured data the sending client wrote, so
           * rewriting it is not an edit to anybody's message text - see
           * `endCallLog`.
           */
          meta?: Record<string, unknown> | null;
        };
        Relationships: [];
      };
      device_keys: {
        Row: DeviceKeyRow;
        Insert: {
          device_id: string;
          user_id: string;
          public_key: string;
          last_seen_at?: string;
          label?: string | null;
          build?: string | null;
        };
        Update: { last_seen_at?: string; label?: string | null; build?: string | null };
        Relationships: [];
      };
      /** Read-only to the client; rows are written by `revoke_device`. */
      revoked_devices: {
        Row: RevokedDeviceRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * The account recovery package, and the public half senders wrap to.
       *
       * Only three columns are selectable - the migration revokes `select` on
       * the table and grants it back for `user_id`, `public_key` and `version`
       * individually. `package` is deliberately absent from `Row` here: it is
       * not readable through this client at all, and typing it as though it
       * were would invite code that cannot work.
       */
      recovery_packages: {
        Row: { user_id: string; public_key: string; version: number };
        Insert: {
          user_id: string;
          kdf: string;
          salt: string;
          iv: string;
          package: string;
          public_key: string;
          version?: number;
        };
        Update: {
          kdf?: string;
          salt?: string;
          iv?: string;
          package?: string;
          public_key?: string;
          version?: number;
        };
        Relationships: [];
      };
      stories: {
        Row: StoryRow;
        Insert: {
          author_id: string;
          /** Kept for rows written before the bucket went private. */
          media_url: string;
          media_path?: string | null;
          kind?: string;
          caption?: string | null;
          audience?: string;
          location?: string | null;
          link_url?: string | null;
        };
        Update: { caption?: string | null; audience?: string };
        Relationships: [];
      };
      story_views: {
        Row: { story_id: string; viewer_id: string; viewed_at: string };
        Insert: { story_id: string; viewer_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      story_likes: {
        Row: { story_id: string; user_id: string; created_at: string };
        Insert: { story_id: string; user_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      story_audience: {
        Row: { story_id: string; user_id: string };
        Insert: { story_id: string; user_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      close_friends: {
        Row: { owner_id: string; friend_id: string; created_at: string };
        Insert: { owner_id: string; friend_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      story_hidden_from: {
        Row: { owner_id: string; user_id: string; created_at: string };
        Insert: { owner_id: string; user_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      story_muted_authors: {
        Row: { muter_id: string; author_id: string; created_at: string };
        Insert: { muter_id: string; author_id: string };
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
      /**
       * The four privacy rules, enforced by policy rather than by the client.
       *
       * Readable by everyone signed in, on purpose: a policy that refuses a
       * call has to read the *callee's* preference. What is exposed is a rule,
       * not a fact about them.
       */
      privacy_settings: {
        Row: {
          user_id: string;
          who_can_call: string;
          who_can_add: string;
          profile_visibility: string;
          online_status: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          who_can_call?: string;
          who_can_add?: string;
          profile_visibility?: string;
          online_status?: boolean;
        };
        Update: {
          who_can_call?: string;
          who_can_add?: string;
          profile_visibility?: string;
          online_status?: boolean;
        };
        Relationships: [];
      };
      /**
       * The public half of Journey — level and badges, published by the owner.
       *
       * No moments and no metrics, by design: see the migration and
       * docs/journey-philosophy.md § 5.
       */
      journey_public: {
        Row: {
          user_id: string;
          level: number;
          badge_ids: string[];
          updated_at: string;
        };
        Insert: { user_id: string; level?: number; badge_ids?: string[] };
        Update: { level?: number; badge_ids?: string[] };
        Relationships: [];
      };
      /**
       * What a person is willing to be interrupted for.
       *
       * On the server rather than the device because the thing that acts on
       * them is a Postgres trigger, which cannot read a browser's localStorage.
       * Left local, "turn off notifications" changed nothing at all.
       */
      notification_prefs: {
        Row: {
          user_id: string;
          muted: boolean;
          messages: boolean;
          groups: boolean;
          calls: boolean;
          friend_requests: boolean;
          stories: boolean;
          ai: boolean;
          journey: boolean;
          marketing: boolean;
          preview: 'sender_only' | 'sender_and_text' | 'hidden';
          quiet_enabled: boolean;
          quiet_start_minute: number;
          quiet_end_minute: number;
          utc_offset_minutes: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          muted?: boolean;
          messages?: boolean;
          groups?: boolean;
          calls?: boolean;
          friend_requests?: boolean;
          stories?: boolean;
          ai?: boolean;
          journey?: boolean;
          marketing?: boolean;
          preview?: 'sender_only' | 'sender_and_text' | 'hidden';
          quiet_enabled?: boolean;
          quiet_start_minute?: number;
          quiet_end_minute?: number;
          utc_offset_minutes?: number;
        };
        Update: {
          muted?: boolean;
          messages?: boolean;
          groups?: boolean;
          calls?: boolean;
          friend_requests?: boolean;
          stories?: boolean;
          ai?: boolean;
          journey?: boolean;
          marketing?: boolean;
          preview?: 'sender_only' | 'sender_and_text' | 'hidden';
          quiet_enabled?: boolean;
          quiet_start_minute?: number;
          quiet_end_minute?: number;
          utc_offset_minutes?: number;
        };
        Relationships: [];
      };
      /** What the pipeline delivered. Own rows readable; never writable here. */
      push_deliveries: {
        Row: {
          notification_id: string;
          user_id: string;
          device_count: number;
          attempts: number;
          latency_ms: number | null;
          sent_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Deliveries waiting on the retry worker. Own rows readable. */
      push_failures: {
        Row: {
          id: string;
          notification_id: string | null;
          user_id: string;
          reason: string;
          last_error: string | null;
          attempts: number;
          next_attempt_at: string;
          created_at: string;
          last_attempt_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * One row per install that can receive a push, keyed on the FCM token.
       *
       * Keyed on the token rather than the user because a device changes hands:
       * FCM hands the same token back to whoever signs in next on that handset,
       * and an upsert on the token is what moves the row instead of duplicating
       * it. See the migration for the full reasoning.
       */
      device_tokens: {
        Row: {
          token: string;
          user_id: string;
          platform: 'android' | 'ios' | 'web';
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          token: string;
          user_id: string;
          platform: 'android' | 'ios' | 'web';
          last_seen_at?: string;
        };
        Update: { user_id?: string; platform?: 'android' | 'ios' | 'web'; last_seen_at?: string };
        Relationships: [];
      };
      /**
       * Mission definitions, edited from Controlling rather than shipped in a
       * build. `required_count` is the only place the target number lives.
       */
      missions: {
        Row: {
          id: string;
          title: string;
          description: string;
          badge_id: string;
          kind: 'referral';
          required_count: number;
          enabled: boolean;
          counts_from: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          title: string;
          description: string;
          badge_id: string;
          kind: 'referral';
          required_count: number;
          enabled?: boolean;
          counts_from?: string;
        };
        Update: {
          title?: string;
          description?: string;
          badge_id?: string;
          required_count?: number;
          enabled?: boolean;
          counts_from?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * Who brought whom. No `Insert` or `Update`: every write goes through
       * `redeem_referral`, and a client that could insert here directly would
       * make every rule in that function decorative.
       */
      referrals: {
        Row: {
          referred_id: string;
          referrer_id: string;
          mission_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Badges the server itself vouches for - readable by anybody signed in,
       * writable by nobody. Distinct from `journey_public.badge_ids`, which the
       * owner publishes about their own device. See the migration header.
       */
      user_badges: {
        Row: {
          user_id: string;
          badge_id: string;
          mission_id: string | null;
          unlocked_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Which backup generation is current, and the hash of its manifest. The
       * one fact about a Drive backup that the owner of the Drive folder cannot
       * rewrite. Readable by its owner; no `Insert` or `Update`, because a
       * direct write would be a way around the monotonic rule that is the
       * entire defence - see `set_backup_anchor`.
       */
      backup_anchor: {
        Row: {
          user_id: string;
          generation: number;
          manifest_hash: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    /* Empty groups, in the shape the generator emits. */
    Views: { [_ in never]: never };
    Functions: {
      /**
       * Records who invited the caller, once they have a real account. Returns
       * `{ ok, reason }` rather than raising: opening your own link, or a
       * second link after already being attributed, are ordinary events.
       */
      redeem_referral: {
        Args: { code: string };
        Returns: { ok: boolean; reason: string };
      };
      /**
       * Advances the backup anchor. Raises when the generation is not strictly
       * newer than the one recorded, which is what makes a rollback impossible
       * for somebody who holds the Drive folder but not the account.
       */
      set_backup_anchor: {
        Args: { p_generation: number; p_manifest_hash: string };
        Returns: number;
      };
      /** Ends the current backup lineage, for a disconnect that starts over. */
      clear_backup_anchor: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      /**
       * The mission screen in one call - the link, the count, the requirement
       * and whether it is unlocked, all derived server-side.
       */
      referral_progress: {
        Args: Record<string, never>;
        Returns: {
          ok: boolean;
          reason?: string;
          missionId?: string;
          title?: string;
          description?: string;
          badgeId?: string;
          referralCode?: string;
          count?: number;
          required?: number;
          /** The people behind the count, oldest first, capped server-side. */
          friends?: Array<{
            id: string;
            username: string;
            displayName: string;
            avatarUrl: string | null;
            joinedAt: string;
          }>;
          unlocked?: boolean;
        };
      };
      /**
       * Product-wide push health. Raises for anybody not on the operator
       * allowlist, so the caller must tolerate a rejection rather than assume
       * a row.
       */
      push_health: {
        Args: Record<string, never>;
        Returns: {
          delivered: number;
          dead_letters: number;
          queued: number;
          pruned_tokens: number;
          retries_before_success: number;
          avg_latency_ms: number | null;
          success_rate_percent: number | null;
        }[];
      };
      /** Sets opened_at and read_at together - see the migration. */
      notification_opened: { Args: { target: string }; Returns: undefined };
      /** Hides a notification from history without destroying the row. */
      notification_dismissed: { Args: { target: string }; Returns: undefined };
      /** Open rates per kind. Operator only; raises for everybody else. */
      notification_engagement: {
        Args: Record<string, never>;
        Returns: { kind: string; delivered: number; opened: number; ignored: number; open_rate_percent: number | null }[];
      };
      /** Idempotent: returns the existing direct conversation, or makes one. */
      start_direct_conversation: {
        Args: { other_user: string };
        Returns: string;
      };
      /**
       * Adds or removes PINGO AI from one group. Admin only.
       *
       * Membership is the switch: the assistant answers because it is a member,
       * and a message only leaves this device unencrypted when it mentions an
       * assistant that is in the room. Replaces `add_pingo_ai_to_group`, which
       * could only ever go one way.
       */
      set_group_ai: {
        Args: { conv: string; enabled: boolean };
        Returns: undefined;
      };
      ensure_ai_conversation: {
        Args: Record<string, never>;
        Returns: string;
      };
      post_ai_reply: {
        Args: { target_conversation: string; reply_body: string };
        Returns: string;
      };
      log_ai_user_turn: {
        Args: { target_conversation: string; turn_body: string };
        Returns: undefined;
      };
      get_ai_public_identity: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
        };
      };
      update_ai_public_identity: {
        Args: {
          new_display_name?: string | null;
          new_bio?: string | null;
          new_avatar_url?: string | null;
        };
        Returns: undefined;
      };
      is_ai_owner: {
        Args: Record<string, never>;
        Returns: boolean;
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
      /** Add, swap or remove in one statement - see the reactions migration. */
      toggle_reaction: { Args: { target: string; symbol: string }; Returns: undefined };
      /**
       * Ownership is enforced server-side; the edit window was removed.
       *
       * The body is re-sealed by the caller, so the envelope travels with it  - 
       * the server holds no keys and cannot encrypt on anyone's behalf. The
       * two-argument form still exists for tabs loaded before that change, but
       * refuses encrypted rows rather than writing plaintext into one.
       */
      /*
       * Two signatures, because client and database ship separately.
       *
       * The sealed form is what callers should use: the body is re-encrypted on
       * the device and the envelope travels with it, since the server holds no
       * keys and cannot re-seal on anyone's behalf. The two-argument form is
       * what a database that has not run the migration still answers, and it is
       * safe only for a body that carries no envelope.
       */
      edit_message: {
        Args: {
          target: string;
          new_body: string;
          new_encryption?: string | null;
          new_envelope?: MessageRow['envelope'];
        };
        Returns: undefined;
      };
      delete_message: { Args: { target: string; for_everyone: boolean }; Returns: undefined };
      /**
       * The recovery package is written through functions, not the table.
       *
       * `package` is not selectable by any client role, and the column-level
       * grants that achieve that also deny the table privileges an upsert
       * needs. Granting them back would expose the blob that opens an
       * account's history, so these definer functions re-state the checks the
       * policies would have made.
       */
      upsert_recovery_package: {
        Args: {
          new_kdf: string;
          new_salt: string;
          new_iv: string;
          new_package: string;
          new_public_key: string;
          new_version: number;
        };
        Returns: undefined;
      };
      delete_recovery_package: { Args: Record<string, never>; Returns: undefined };
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
      /** Who watched one story, with whether they liked it. Author only. */
      story_viewers: {
        Args: { target: string };
        Returns: {
          viewer_id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          viewed_at: string;
          liked: boolean;
        }[];
      };
      /** Views, likes and replies for one story. Author only. */
      story_insights: {
        Args: { target: string };
        Returns: { views: number; likes: number; replies: number }[];
      };
      /** Posts, friends and groups for one person. Works for anyone. */
      profile_stats: {
        Args: { target: string };
        Returns: { posts: number; friends: number; groups: number }[];
      };
      /**
       * Like totals for posts: real `post_likes` rows + `likes_display_seed`.
       * Used so display seeds always show on profile posts.
       */
      post_like_display_counts: {
        Args: { ids: string[] };
        Returns: { post_id: string; like_count: number; liked_by_me: boolean }[];
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
      /**
       * Accept an incoming friend request and write the reverse accepted follow
       * so both people are friends in one step.
       */
      accept_friend_request: {
        Args: { from_user: string };
        Returns: undefined;
      };
      /** Deletes every expired snap. Returns how many went. */
      purge_expired_snaps: {
        Args: Record<string, never>;
        Returns: number;
      };
      /**
       * Moves my read cursor to now, and records the advance.
       *
       * Replaces a bare update of `last_read_at`: the cursor alone is a
       * watermark, and once it has passed a message the moment it passed is
       * unrecoverable. The history row is what lets message info say *when*.
       */
      mark_conversation_read: {
        Args: { conv: string };
        Returns: undefined;
      };
      /**
       * Who has read one message. One row per other member, `read_at` null for
       * the ones who have not - "still waiting on Priya" is half the answer.
       */
      message_receipts: {
        Args: { msg: string };
        Returns: {
          user_id: string;
          read_at: string | null;
        }[];
      };

      /*
       * Groups.
       *
       * Every mutation is a function because every one has a condition on it,
       * and a condition about `conversation_members` written as a policy *on*
       * `conversation_members` is the recursion this schema hit in its first
       * migration. The rules live in `security definer`; the table is readable
       * and, apart from your own personal state, not writable.
       */
      create_group: {
        Args: { title: string; member_ids: string[]; avatar_url: string | null };
        Returns: string;
      };
      add_group_members: {
        Args: { conv: string; member_ids: string[] };
        Returns: undefined;
      };
      remove_group_member: {
        Args: { conv: string; target: string };
        Returns: undefined;
      };
      leave_group: {
        Args: { conv: string };
        Returns: undefined;
      };
      set_group_admin: {
        Args: { conv: string; target: string; make_admin: boolean };
        Returns: undefined;
      };
      update_group: {
        Args: {
          conv: string;
          title: string;
          avatar_url?: string | null;
          description?: string | null;
          cover_url?: string | null;
          clear_avatar?: boolean;
          clear_cover?: boolean;
        };
        Returns: undefined;
      };
      /**
       * A page of a conversation, each envelope trimmed to the caller's own key.
       *
       * Returns whole message rows as jsonb - the same shape `select('*')`
       * produced, minus the fourteen-odd wrapped keys addressed to other
       * people's devices. See the envelope-trim migration.
       */
      messages_page: {
        Args: {
          /** Null when asking by `ids`, which span conversations. */
          conv: string | null;
          device: string;
          page_limit?: number;
          before_at?: string | null;
          since?: string | null;
          /** The conversation list's previews. Ignores every other argument. */
          ids?: string[];
        };
        Returns: MessageRow[];
      };
      /** Own devices only. Deletes the key row and remembers the id for ever. */
      revoke_device: {
        Args: { device: string };
        Returns: undefined;
      };
      /** Any member. Null seconds turns the timer off; both post a system notice. */
      set_disappearing: {
        Args: { conv: string; seconds: number | null };
        Returns: undefined;
      };
      /** Any group member. Shared backdrop for the whole room. */
      set_group_wallpaper: {
        Args: {
          conv: string;
          wallpaper_id: string;
          wallpaper_photo_url?: string | null;
        };
        Returns: undefined;
      };
      /** Idempotent - returns the live code rather than minting a second. */
      group_invite_code: {
        Args: { conv: string };
        Returns: string;
      };
      revoke_group_invite: {
        Args: { conv: string };
        Returns: undefined;
      };
      /** Name, picture and headcount. Deliberately not the roster. */
      preview_group_invite: {
        Args: { invite_code: string };
        Returns: {
          conversation_id: string;
          title: string | null;
          avatar_url: string | null;
          member_count: number;
        }[];
      };
      join_group_with_code: {
        Args: { invite_code: string };
        Returns: string;
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
